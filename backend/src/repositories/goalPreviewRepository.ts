import { getFirestore } from '../firebase';
import { ApiError } from '../errors';

const COLLECTION = 'GoalPreview';

export interface GoalPreviewRecord {
    id: string;
    userId: string;
    sessionId: string;
    data: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

function mapPreview(doc: FirebaseFirestore.DocumentSnapshot): GoalPreviewRecord {
    const data = doc.data();
    if (!data) {
        throw new ApiError(500, 'Malformed goal preview record.');
    }
    return {
        id: doc.id,
        userId: data.userId as string,
        sessionId: data.sessionId as string,
        data: (data.data as Record<string, unknown>) ?? {},
        createdAt: (data.createdAt as string | undefined) ?? new Date().toISOString(),
        updatedAt: (data.updatedAt as string | undefined) ?? new Date().toISOString(),
    };
}

export async function findGoalPreviewById(id: string): Promise<GoalPreviewRecord | null> {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
        return null;
    }
    return mapPreview(doc);
}

export interface UpsertGoalPreviewInput {
    id?: string;
    userId: string;
    sessionId: string;
    data: Record<string, unknown>;
}

export async function upsertGoalPreview(input: UpsertGoalPreviewInput): Promise<GoalPreviewRecord> {
    const db = getFirestore();
    const now = new Date().toISOString();
    if (input.id) {
        const docRef = db.collection(COLLECTION).doc(input.id);
        const doc = await docRef.get();
        if (!doc.exists) {
            await docRef.set({
                id: input.id,
                userId: input.userId,
                sessionId: input.sessionId,
                data: input.data,
                createdAt: now,
                updatedAt: now,
            });
        } else {
            await docRef.update({
                data: input.data,
                updatedAt: now,
            });
        }
        return mapPreview(await docRef.get());
    }

    const docRef = db.collection(COLLECTION).doc();
    await docRef.set({
        id: docRef.id,
        userId: input.userId,
        sessionId: input.sessionId,
        data: input.data,
        createdAt: now,
        updatedAt: now,
    });
    return mapPreview(await docRef.get());
}
