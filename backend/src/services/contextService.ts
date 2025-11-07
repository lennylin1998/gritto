import { sumActiveGoalHours } from '../repositories/goalRepository';
import { listTasksByDateRange } from '../repositories/taskRepository';
import { UserRecord } from '../types/models';

const UPCOMING_DAYS = 7;

export async function buildUserContext(user: UserRecord): Promise<Record<string, unknown>> {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + UPCOMING_DAYS);

    const startDay = now.toISOString().slice(0, 10);
    const endDay = end.toISOString().slice(0, 10);
    const tasks = await listTasksByDateRange(user.id, startDay, endDay);
    const upcomingTasks = tasks
        .filter((task) => !task.done)
        .map((task) => ({
            id: task.id,
            title: task.title,
            goalId: task.goalId,
            milestoneId: task.milestoneId,
            date: task.date,
            estimatedHours: task.estimatedHours,
            done: task.done,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const activeGoalHours = await sumActiveGoalHours(user.id);
    const availableHoursLeft = Math.max(0, user.availableHoursPerWeek - activeGoalHours);

    return {
        availableHoursLeft,
        upcomingTasks,
    };
}
