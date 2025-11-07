import { getFirestore } from '../firebase';
import { ApiError } from '../errors';
import { UserRecord } from '../types/models';

const COLLECTION = 'User';

function mapUser(doc: FirebaseFirestore.DocumentSnapshot): UserRecord {
    const data = doc.data();
    if (!data) {
        throw new ApiError(500, 'Malformed user record.');
    }
    return {
        id: doc.id,
        email: data.email as string,
        name: (data.name as string | undefined) ?? '',
        profileImageUrl: (data.profileImageUrl as string | null | undefined) ?? null,
        timezone: (data.timezone as string | undefined) ?? 'UTC',
        availableHoursPerWeek: (data.availableHoursPerWeek as number | undefined) ?? 20,
        createdAt: (data.createdAt as string | undefined) ?? new Date().toISOString(),
        updatedAt: (data.updatedAt as string | undefined) ?? new Date().toISOString(),
        googleSub: (data.googleSub as string | undefined) ?? '',
    };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
        return null;
    }
    return mapUser(doc);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTION).where('email', '==', email).limit(1).get();
    if (snapshot.empty) {
        return null;
    }
    return mapUser(snapshot.docs[0]);
}

export interface CreateUserInput {
    email: string;
    name: string | null;
    profileImageUrl: string | null;
    timezone?: string;
    availableHoursPerWeek?: number;
    googleSub: string;
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date().toISOString();
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc();
    const record = {
        email: input.email,
        name: input.name ?? '',
        profileImageUrl: input.profileImageUrl ?? null,
        timezone: input.timezone ?? 'UTC',
        availableHoursPerWeek: input.availableHoursPerWeek ?? 20,
        createdAt: now,
        updatedAt: now,
        googleSub: input.googleSub,
    };
    await docRef.set({ ...record, id: docRef.id });
    return { id: docRef.id, ...record };
}

export interface UpdateUserInput {
    name?: string;
    profileImageUrl?: string | null;
    timezone?: string;
    availableHoursPerWeek?: number;
    googleSub?: string;
}

export async function updateUser(id: string, updates: UpdateUserInput): Promise<UserRecord> {
    const now = new Date().toISOString();
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
        throw new ApiError(404, 'User not found.');
    }
    const payload: Record<string, unknown> = { updatedAt: now };
    if (updates.name !== undefined) {
        payload.name = updates.name;
    }
    if (updates.profileImageUrl !== undefined) {
        payload.profileImageUrl = updates.profileImageUrl;
    }
    if (updates.timezone !== undefined) {
        payload.timezone = updates.timezone;
    }
    if (updates.availableHoursPerWeek !== undefined) {
        payload.availableHoursPerWeek = updates.availableHoursPerWeek;
    }
    if (updates.googleSub !== undefined) {
        payload.googleSub = updates.googleSub;
    }
    await docRef.update(payload);
    return mapUser(await docRef.get());
}
