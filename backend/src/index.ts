import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import morgan from 'morgan';

import { ApiError, assert } from './errors';
import { authMiddleware } from './middleware/auth';
import { verifyGoogleIdToken } from './services/googleAuthService';
import { signJwt } from './services/tokenService';
import {
    createUser,
    findUserByEmail,
    findUserById,
    updateUser,
} from './repositories/userRepository';
import {
    createGoal,
    getGoalById,
    listGoals,
    sumActiveGoalHours,
    updateGoal,
} from './repositories/goalRepository';
import {
    createMilestone,
    getMilestoneById,
    listMilestonesByGoal,
    updateMilestone,
} from './repositories/milestoneRepository';
import {
    createTask,
    getTaskById,
    listTasksByDateRange,
    listTasksByGoal,
    listTasksByMilestone,
    setTaskDone,
    updateTask,
} from './repositories/taskRepository';
import {
    appendChatMessage,
    createSession,
    findLatestActiveSession,
    findSessionById,
    updateSession,
} from './repositories/sessionRepository';
import { upsertGoalPreview } from './repositories/goalPreviewRepository';
import { buildUserContext } from './services/contextService';
import { invokeAgentService } from './services/agentService';
import type {
    GoalRecord,
    GoalStatus,
    MilestoneRecord,
    MilestoneStatus,
    SessionStateRecord,
    TaskRecord,
    UserRecord,
} from './types/models';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 8080;

const GOAL_STATUSES: GoalStatus[] = ['active', 'completed', 'paused', 'archived'];
const MILESTONE_STATUSES: MilestoneStatus[] = ['blocked', 'in_progress', 'finished'];
const MAX_AVAILABLE_HOURS = 168;

app.use(morgan('dev'));
app.use(express.json());

function serializeUser(user: UserRecord) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        timezone: user.timezone,
        availableHoursPerWeek: user.availableHoursPerWeek,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

function serializeGoal(goal: GoalRecord) {
    return {
        id: goal.id,
        userId: goal.userId,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status,
        color: goal.color ?? null,
        minHoursPerWeek: goal.minHoursPerWeek,
        priority: goal.priority,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
    };
}

function serializeMilestone(milestone: MilestoneRecord) {
    return {
        id: milestone.id,
        goalId: milestone.goalId,
        parentMilestoneId: milestone.parentMilestoneId ?? null,
        title: milestone.title,
        description: milestone.description ?? null,
        status: milestone.status,
        createdAt: milestone.createdAt,
        updatedAt: milestone.updatedAt,
    };
}

function serializeTask(task: TaskRecord) {
    return {
        id: task.id,
        goalId: task.goalId,
        milestoneId: task.milestoneId,
        title: task.title,
        description: task.description ?? null,
        date: task.date,
        estimatedHours: task.estimatedHours,
        done: task.done,
        status: task.done ? 'done' : 'not_yet_done',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    };
}

function summarizeTaskHours(tasks: TaskRecord[]): { totalTaskHours: number; doneTaskHours: number } {
    return tasks.reduce(
        (accumulator, task) => {
            const hours = Number(task.estimatedHours) || 0;
            accumulator.totalTaskHours += hours;
            if (task.done) {
                accumulator.doneTaskHours += hours;
            }
            return accumulator;
        },
        { totalTaskHours: 0, doneTaskHours: 0 }
    );
}

function isValidGoalStatus(value: unknown): value is GoalStatus {
    return typeof value === 'string' && (GOAL_STATUSES as ReadonlyArray<string>).includes(value);
}

function isValidMilestoneStatus(value: unknown): value is MilestoneStatus {
    return typeof value === 'string' && (MILESTONE_STATUSES as ReadonlyArray<string>).includes(value);
}

function isValidDay(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDayRange(day: string): { start: string; end: string } {
    return { start: day, end: day };
}

async function assertOwnedGoal(goalId: string, userId: string): Promise<GoalRecord> {
    const goal = await getGoalById(goalId);
    assert(goal, 404, 'Goal not found.');
    assert(goal.userId === userId, 403, 'Forbidden.');
    return goal;
}

async function assertOwnedMilestone(milestoneId: string, userId: string): Promise<MilestoneRecord> {
    const milestone = await getMilestoneById(milestoneId);
    assert(milestone, 404, 'Milestone not found.');
    await assertOwnedGoal(milestone.goalId, userId);
    return milestone;
}

async function assertOwnedTask(taskId: string, userId: string): Promise<{ task: TaskRecord; milestone: MilestoneRecord }> {
    const task = await getTaskById(taskId);
    assert(task, 404, 'Task not found.');
    const milestone = await assertOwnedMilestone(task.milestoneId, userId);
    return { task, milestone };
}

async function computeGoalMetrics(goalId: string): Promise<{ goalId: string; totalTaskHours: number; doneTaskHours: number }> {
    const tasks = await listTasksByGoal(goalId);
    const metrics = summarizeTaskHours(tasks);
    return { goalId, ...metrics };
}

async function computeMilestoneMetrics(
    milestoneId: string
): Promise<{ milestoneId: string; totalTaskHours: number; doneTaskHours: number }> {
    const tasks = await listTasksByMilestone(milestoneId);
    const metrics = summarizeTaskHours(tasks);
    return { milestoneId, ...metrics };
}

async function collectActiveGoalSummaries(
    userId: string,
    excludeGoalId?: string
): Promise<Array<{ goalId: string; title: string; weeklyHours: number }>> {
    const goals = await listGoals({ userId, status: 'active' });
    return goals
        .filter((goal) => goal.id !== excludeGoalId)
        .map((goal) => ({
            goalId: goal.id,
            title: goal.title,
            weeklyHours: goal.minHoursPerWeek,
        }));
}

async function ensureNoTaskConflict(
    milestoneId: string,
    userId: string,
    date: string,
    excludeTaskId?: string
): Promise<void> {
    const tasks = await listTasksByMilestone(milestoneId);
    const conflicting = tasks.filter(
        (task) => task.id !== excludeTaskId && task.userId === userId && task.date === date
    );
    if (conflicting.length > 0) {
        throw new ApiError(409, 'Task date conflicts with an existing scheduled task or calendar event.', {
            conflictingTaskIds: conflicting.map((task) => task.id),
        });
    }
}

function serializeSession(session: SessionStateRecord) {
    return {
        sessionId: session.id,
        chatId: session.chatId,
        state: session.state,
        iteration: session.iteration,
        goalPreviewId: session.goalPreviewId ?? null,
        context: session.context ?? {},
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    };
}

function validateEstimatedHours(value: unknown): number {
    assert(typeof value === 'number' && Number.isFinite(value), 400, 'estimatedHours must be a number.');
    assert(value >= 0, 400, 'estimatedHours must be zero or positive.');
    return value;
}

function validateIsoDate(value: unknown): string {
    assert(typeof value === 'string' && value.trim().length > 0, 400, 'date is required.');
    const parsed = new Date(value);
    assert(!Number.isNaN(parsed.valueOf()), 400, 'Invalid date format.');
    return parsed.toISOString().slice(0, 10);
}

app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/v1/auth/google', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { idToken } = req.body ?? {};
        assert(typeof idToken === 'string' && idToken.trim().length > 0, 400, 'idToken is required.');
        const profile = await verifyGoogleIdToken(idToken);
        assert(profile.emailVerified, 403, 'Google account email not verified.');
        
        let user = await findUserByEmail(profile.email);
        let statusCode = 200;
        if (!user) {
            const derivedName = profile.name?.trim() ?? profile.email.split('@')[0];
            user = await createUser({
                email: profile.email,
                name: derivedName,
                profileImageUrl: profile.picture ?? null,
                timezone: 'UTC',
                availableHoursPerWeek: 20,
                googleSub: profile.sub,
            });
            statusCode = 201;
        } else {
            const updates: Parameters<typeof updateUser>[1] = { googleSub: profile.sub };
            if (profile.name && profile.name.trim().length > 0) {
                updates.name = profile.name;
            }
            if (profile.picture) {
                updates.profileImageUrl = profile.picture;
            }
            await updateUser(user.id, updates);
            user = (await findUserById(user.id)) as UserRecord;
        }
        
        const token = signJwt({ userId: user.id, email: user.email });
        console.log(token);
        res.status(statusCode).json({
            data: {
                token,
                user: serializeUser(user),
            },
        });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const user = await findUserById(userId);
        assert(user, 404, 'User not found.');
        res.json({ data: serializeUser(user) });
    } catch (error) {
        next(error);
    }
});

app.patch('/v1/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const user = await findUserById(userId);
        assert(user, 404, 'User not found.');

        const { name, timezone, availableHoursPerWeek, profileImageUrl } = req.body ?? {};
        const updates: Parameters<typeof updateUser>[1] = {};
        let hasUpdate = false;

        if (name !== undefined) {
            assert(typeof name === 'string' && name.trim().length > 0, 400, 'Invalid name.');
            updates.name = name;
            hasUpdate = true;
        }
        if (timezone !== undefined) {
            assert(typeof timezone === 'string' && timezone.trim().length > 0, 400, 'Invalid timezone format.');
            updates.timezone = timezone;
            hasUpdate = true;
        }
        if (profileImageUrl !== undefined) {
            assert(
                profileImageUrl === null || typeof profileImageUrl === 'string',
                400,
                'profileImageUrl must be a string or null.'
            );
            updates.profileImageUrl = profileImageUrl;
            hasUpdate = true;
        }
        if (availableHoursPerWeek !== undefined) {
            assert(
                typeof availableHoursPerWeek === 'number' && Number.isFinite(availableHoursPerWeek),
                400,
                'availableHoursPerWeek must be a number.'
            );
            assert(
                availableHoursPerWeek >= 0 && availableHoursPerWeek <= MAX_AVAILABLE_HOURS,
                400,
                `availableHoursPerWeek must be between 0 and ${MAX_AVAILABLE_HOURS}.`
            );
            const activeHours = await sumActiveGoalHours(userId);
            if (availableHoursPerWeek < activeHours) {
                const conflicts = await collectActiveGoalSummaries(userId);
                throw new ApiError(
                    409,
                    `Available hours (${availableHoursPerWeek}h/week) are insufficient for current active goals (${activeHours}h/week required).`,
                    {
                        availableHoursPerWeek,
                        requiredHoursPerWeek: activeHours,
                        conflictingGoals: conflicts,
                    }
                );
            }
            updates.availableHoursPerWeek = availableHoursPerWeek;
            hasUpdate = true;
        }

        assert(hasUpdate, 400, 'No updatable fields provided.');
        const updatedUser = await updateUser(userId, updates);
        res.json({ data: serializeUser(updatedUser) });
    } catch (error) {
        next(error);
    }
});

app.post('/v1/goals', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const user = await findUserById(userId);
        assert(user, 404, 'User not found.');

        const { title, description, minHoursPerWeek, priority, color } = req.body ?? {};
        assert(typeof title === 'string' && title.trim().length > 0, 400, 'title is required.');
        assert(
            typeof minHoursPerWeek === 'number' && Number.isFinite(minHoursPerWeek) && minHoursPerWeek >= 0,
            400,
            'minHoursPerWeek must be a non-negative number.'
        );
        assert(typeof priority === 'number' && Number.isInteger(priority), 400, 'priority must be an integer.');
        if (color !== undefined) {
            assert(typeof color === 'number' && Number.isFinite(color), 400, 'color must be a number.');
        }

        const existingHours = await sumActiveGoalHours(userId);
        const totalHours = existingHours + minHoursPerWeek;
        if (totalHours > user.availableHoursPerWeek) {
            const conflicts = await collectActiveGoalSummaries(userId);
            throw new ApiError(
                409,
                `Available hours (${user.availableHoursPerWeek}h/week) are insufficient for current active goals (${totalHours}h/week with new goal).`,
                {
                    availableHoursPerWeek: user.availableHoursPerWeek,
                    requiredHoursPerWeek: totalHours,
                    conflictingGoals: conflicts,
                }
            );
        }

        const goal = await createGoal({
            userId,
            title: title.trim(),
            description: typeof description === 'string' ? description : null,
            minHoursPerWeek,
            priority,
            color: color ?? null,
        });
        res.status(201).json({ data: serializeGoal(goal) });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/goals', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
        let status: GoalStatus | 'all' = 'all';
        if (statusParam) {
            if (statusParam === 'all') {
                status = 'all';
            } else {
                assert(isValidGoalStatus(statusParam), 400, 'Invalid status filter.');
                status = statusParam as GoalStatus;
            }
        }

        const goals = await listGoals({ userId, status });
        const payload = await Promise.all(
            goals.map(async (goal) => {
                const metrics = summarizeTaskHours(await listTasksByGoal(goal.id));
                return {
                    ...serializeGoal(goal),
                    totalTaskHours: metrics.totalTaskHours,
                    doneTaskHours: metrics.doneTaskHours,
                };
            })
        );
        res.json({ data: payload });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/goals/:goalId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const goal = await assertOwnedGoal(req.params.goalId, userId);
        res.json({ data: serializeGoal(goal) });
    } catch (error) {
        next(error);
    }
});

app.patch('/v1/goals/:goalId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const goal = await assertOwnedGoal(req.params.goalId, userId);

        const { title, description, status, minHoursPerWeek, priority, color } = req.body ?? {};
        const updates: Parameters<typeof updateGoal>[1] = {};
        let hasUpdate = false;

        if (title !== undefined) {
            assert(typeof title === 'string' && title.trim().length > 0, 400, 'Invalid title.');
            updates.title = title.trim();
            hasUpdate = true;
        }
        if (description !== undefined) {
            assert(description === null || typeof description === 'string', 400, 'description must be a string or null.');
            updates.description = description;
            hasUpdate = true;
        }
        if (status !== undefined) {
            assert(isValidGoalStatus(status), 400, 'Invalid goal status.');
            updates.status = status;
            hasUpdate = true;
        }
        if (minHoursPerWeek !== undefined) {
            assert(
                typeof minHoursPerWeek === 'number' && Number.isFinite(minHoursPerWeek) && minHoursPerWeek >= 0,
                400,
                'minHoursPerWeek must be a non-negative number.'
            );
            updates.minHoursPerWeek = minHoursPerWeek;
            hasUpdate = true;
        }
        if (priority !== undefined) {
            assert(typeof priority === 'number' && Number.isInteger(priority), 400, 'priority must be an integer.');
            updates.priority = priority;
            hasUpdate = true;
        }
        if (color !== undefined) {
            assert(color === null || (typeof color === 'number' && Number.isFinite(color)), 400, 'color must be a number or null.');
            updates.color = color;
            hasUpdate = true;
        }

        assert(hasUpdate, 400, 'No updatable fields provided.');

        const user = await findUserById(userId);
        assert(user, 404, 'User not found.');

        const nextStatus = (updates.status ?? goal.status) as GoalStatus;
        const nextHours = updates.minHoursPerWeek ?? goal.minHoursPerWeek;
        if (nextStatus === 'active') {
            const otherHours = await sumActiveGoalHours(userId, goal.id);
            const totalHours = otherHours + nextHours;
            if (totalHours > user.availableHoursPerWeek) {
                const conflicts = await collectActiveGoalSummaries(userId, goal.id);
                conflicts.push({ goalId: goal.id, title: goal.title, weeklyHours: nextHours });
                throw new ApiError(
                    409,
                    `Available hours (${user.availableHoursPerWeek}h/week) are insufficient for current active goals (${totalHours}h/week required).`,
                    {
                        availableHoursPerWeek: user.availableHoursPerWeek,
                        requiredHoursPerWeek: totalHours,
                        conflictingGoals: conflicts,
                    }
                );
            }
        }

        const updatedGoal = await updateGoal(goal.id, updates);
        res.json({ data: serializeGoal(updatedGoal) });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/goals/:goalId/metrics', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        await assertOwnedGoal(req.params.goalId, userId);
        const metrics = await computeGoalMetrics(req.params.goalId);
        res.json({ data: metrics });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/goals/:goalId/milestones', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        await assertOwnedGoal(req.params.goalId, userId);
        const milestones = await listMilestonesByGoal(req.params.goalId);
        res.json({ data: milestones.map(serializeMilestone) });
    } catch (error) {
        next(error);
    }
});

app.post('/v1/goals/:goalId/milestones', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const goal = await assertOwnedGoal(req.params.goalId, userId);

        const { title, description, parentMilestoneId } = req.body ?? {};
        assert(typeof title === 'string' && title.trim().length > 0, 400, 'title is required.');
        if (description !== undefined) {
            assert(description === null || typeof description === 'string', 400, 'description must be a string or null.');
        }
        if (parentMilestoneId !== undefined) {
            assert(typeof parentMilestoneId === 'string' && parentMilestoneId.trim().length > 0, 400, 'parentMilestoneId must be a string.');
            const parentMilestone = await assertOwnedMilestone(parentMilestoneId, userId);
            assert(parentMilestone.goalId === goal.id, 400, 'parentMilestoneId must belong to the same goal.');
        }

        const milestone = await createMilestone({
            goalId: goal.id,
            title: title.trim(),
            description: description ?? null,
            parentMilestoneId: parentMilestoneId ?? null,
        });
        res.status(201).json({ data: serializeMilestone(milestone) });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/milestones/:milestoneId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const milestone = await assertOwnedMilestone(req.params.milestoneId, userId);
        res.json({ data: serializeMilestone(milestone) });
    } catch (error) {
        next(error);
    }
});

app.patch('/v1/milestones/:milestoneId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        await assertOwnedMilestone(req.params.milestoneId, userId);

        const { title, description, status } = req.body ?? {};
        const updates: Parameters<typeof updateMilestone>[1] = {};
        let hasUpdate = false;

        if (title !== undefined) {
            assert(typeof title === 'string' && title.trim().length > 0, 400, 'Invalid title.');
            updates.title = title.trim();
            hasUpdate = true;
        }
        if (description !== undefined) {
            assert(description === null || typeof description === 'string', 400, 'description must be a string or null.');
            updates.description = description;
            hasUpdate = true;
        }
        if (status !== undefined) {
            assert(isValidMilestoneStatus(status), 400, 'Invalid milestone status.');
            updates.status = status;
            hasUpdate = true;
        }

        assert(hasUpdate, 400, 'No updatable fields provided.');
        const updated = await updateMilestone(req.params.milestoneId, updates);
        res.json({ data: serializeMilestone(updated) });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/milestones/:milestoneId/metrics', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        await assertOwnedMilestone(req.params.milestoneId, userId);
        const metrics = await computeMilestoneMetrics(req.params.milestoneId);
        res.json({ data: metrics });
    } catch (error) {
        next(error);
    }
});

app.post(
    '/v1/milestones/:milestoneId/tasks',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.userId;
            assert(userId, 401, 'Unauthorized');
            const milestone = await assertOwnedMilestone(req.params.milestoneId, userId);

            const { title, description, date, estimatedHours } = req.body ?? {};
            assert(typeof title === 'string' && title.trim().length > 0, 400, 'title is required.');
            if (description !== undefined) {
                assert(
                    description === null || typeof description === 'string',
                    400,
                    'description must be a string or null.'
                );
            }
            const taskDate = validateIsoDate(date);
            const hours = validateEstimatedHours(estimatedHours);

            await ensureNoTaskConflict(milestone.id, userId, taskDate);

            const task = await createTask({
                goalId: milestone.goalId,
                milestoneId: milestone.id,
                userId,
                title: title.trim(),
                description: description ?? null,
                date: taskDate,
                estimatedHours: hours,
            });
            res.status(201).json({ data: serializeTask(task) });
        } catch (error) {
            next(error);
        }
    }
);

app.get('/v1/tasks/:taskId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const { task } = await assertOwnedTask(req.params.taskId, userId);
        res.json({ data: serializeTask(task) });
    } catch (error) {
        next(error);
    }
});

app.patch('/v1/tasks/:taskId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const { task, milestone } = await assertOwnedTask(req.params.taskId, userId);

        const { title, description, date, estimatedHours, done } = req.body ?? {};
        const updates: Parameters<typeof updateTask>[1] = {};
        let hasUpdate = false;

        if (title !== undefined) {
            assert(typeof title === 'string' && title.trim().length > 0, 400, 'Invalid title.');
            updates.title = title.trim();
            hasUpdate = true;
        }
        if (description !== undefined) {
            assert(description === null || typeof description === 'string', 400, 'description must be a string or null.');
            updates.description = description;
            hasUpdate = true;
        }
        if (date !== undefined) {
            const newDate = validateIsoDate(date);
            await ensureNoTaskConflict(milestone.id, userId, newDate, task.id);
            updates.date = newDate;
            hasUpdate = true;
        }
        if (estimatedHours !== undefined) {
            updates.estimatedHours = validateEstimatedHours(estimatedHours);
            hasUpdate = true;
        }
        if (done !== undefined) {
            assert(typeof done === 'boolean', 400, 'done must be a boolean.');
            updates.done = done;
            hasUpdate = true;
        }

        assert(hasUpdate, 400, 'No updatable fields provided.');
        const updatedTask = await updateTask(task.id, updates);
        res.json({ data: serializeTask(updatedTask) });
    } catch (error) {
        next(error);
    }
});

app.post('/v1/tasks/:taskId/done', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const { task } = await assertOwnedTask(req.params.taskId, userId);
        const updatedTask = await setTaskDone(task.id, true);
        res.json({
            data: {
                id: updatedTask.id,
                status: updatedTask.done ? 'done' : 'not_yet_done',
                updatedAt: updatedTask.updatedAt,
            },
        });
    } catch (error) {
        next(error);
    }
});

app.post('/v1/tasks/:taskId/undone', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const { task } = await assertOwnedTask(req.params.taskId, userId);
        const updatedTask = await setTaskDone(task.id, false);
        res.json({
            data: {
                id: updatedTask.id,
                status: updatedTask.done ? 'done' : 'not_yet_done',
                updatedAt: updatedTask.updatedAt,
            },
        });
    } catch (error) {
        next(error);
    }
});

app.get('/v1/tasks:query', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        assert(userId, 401, 'Unauthorized');
        const day = typeof req.query.day === 'string' ? req.query.day : '';
        assert(day, 400, 'day query parameter is required.');
        assert(isValidDay(day), 400, 'Invalid day format. Use YYYY-MM-DD.');
        const { start, end } = toDayRange(day);
        const tasks = await listTasksByDateRange(userId, start, end);
        const pending = tasks.filter((task) => !task.done);
        res.json({ data: pending.map(serializeTask) });
    } catch (error) {
        next(error);
    }
});

app.get(
    '/v1/agent/goal/session:latest',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.userId;
            assert(userId, 401, 'Unauthorized');
            let session = await findLatestActiveSession(userId);
            if (session) {
                res.json({ data: serializeSession(session) });
                return;
            }

            const user = await findUserById(userId);
            assert(user, 404, 'User not found.');
            const context = await buildUserContext(user);
            session = await createSession({ userId, context });
            res.status(201).json({ data: serializeSession(session) });
        } catch (error) {
            next(error);
        }
    }
);

app.post(
    '/v1/agent/goal/session:message',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.userId;
            assert(userId, 401, 'Unauthorized');

            const { sessionId, message, context: contextOverride, userId: payloadUserId } = req.body ?? {};
            assert(typeof sessionId === 'string' && sessionId.trim().length > 0, 400, 'sessionId is required.');
            assert(typeof message === 'string' && message.trim().length > 0, 400, 'message is required.');
            if (payloadUserId !== undefined) {
                assert(payloadUserId === userId, 401, 'Unauthorized.');
            }

            const session = await findSessionById(sessionId);
            assert(session, 400, `Session '${sessionId}' not found.`);
            assert(session.userId === userId, 401, 'Unauthorized.');
            assert(session.sessionActive, 409, `Session '${sessionId}' is finalized and cannot accept new messages.`);

            const context =
                contextOverride && typeof contextOverride === 'object' ? (contextOverride as Record<string, unknown>) : session.context ?? {};

            await appendChatMessage({
                chatId: session.chatId,
                sessionId: session.id,
                sender: 'user',
                message,
            });

            const agentPayload = {
                sessionId: session.id,
                userId,
                message,
                context,
                state: {
                    state: session.state,
                    iteration: session.iteration,
                    sessionActive: session.sessionActive,
                    goalPreviewId: session.goalPreviewId ?? null,
                },
            };

            const agentResponse = await invokeAgentService(agentPayload);

            await appendChatMessage({
                chatId: session.chatId,
                sessionId: session.id,
                sender: 'agent',
                message: agentResponse.reply,
            });

            let goalPreviewId = session.goalPreviewId ?? null;
            if (agentResponse.action?.type === 'save_preview') {
                const previewPayload =
                    (agentResponse.action.payload?.goalPreview as Record<string, unknown> | undefined) ??
                    (agentResponse.action.payload as Record<string, unknown> | undefined) ??
                    {};
                const previewRecord = await upsertGoalPreview({
                    id: typeof previewPayload?.id === 'string' ? (previewPayload.id as string) : undefined,
                    userId,
                    sessionId: session.id,
                    data: previewPayload,
                });
                goalPreviewId = previewRecord.id;
            }

            let sessionActive = agentResponse.state?.sessionActive ?? session.sessionActive;
            if (agentResponse.action?.type === 'finalize_goal') {
                sessionActive = false;
            }

            const updatedSession = await updateSession(session.id, {
                state: agentResponse.state?.state ?? session.state,
                iteration: agentResponse.state?.iteration ?? session.iteration + 1,
                goalPreviewId: agentResponse.state?.goalPreviewId ?? goalPreviewId,
                sessionActive,
                context: agentResponse.context ?? context,
            });

            res.json({
                sessionId: updatedSession.id,
                reply: agentResponse.reply,
                action: agentResponse.action,
                state: {
                    state: updatedSession.state,
                    iteration: updatedSession.iteration,
                    sessionActive: updatedSession.sessionActive,
                    goalPreviewId: updatedSession.goalPreviewId ?? null,
                },
                context: updatedSession.context,
            });
        } catch (error) {
            next(error);
        }
    }
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
        const errorBody: Record<string, unknown> = {
            error: {
                code: err.status,
                message: err.message,
            },
        };
        if (err.details !== undefined) {
            (errorBody.error as Record<string, unknown>).details = err.details;
        }
        res.status(err.status).json(errorBody);
        return;
    }

    console.error(err);
    res.status(500).json({ error: { code: 500, message: 'Internal server error.' } });
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
