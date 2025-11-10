import { getFirestore } from '../firebase';
import { ApiError } from '../errors';
import { ChatMessageRecord, SessionStateRecord } from '../types/models';

const SESSION_COLLECTION = 'SessionState';
const CHAT_COLLECTION = 'Chat';
const CHAT_MESSAGE_COLLECTION = 'ChatMessage';

function mapSession(doc: FirebaseFirestore.DocumentSnapshot): SessionStateRecord {
    const data = doc.data();
    if (!data) {
        throw new ApiError(500, 'Malformed session record.');
    }
    const stateValue = (data.state as SessionStateRecord['state'] | undefined) ?? 'plan_generated';
    return {
        id: doc.id,
        userId: data.userId as string,
        chatId: data.chatId as string,
        state: stateValue,
        iteration: (data.iteration as number | undefined) ?? 0,
        goalPreviewId: (data.goalPreviewId as string | null | undefined) ?? null,
        sessionActive: Boolean(data.sessionActive ?? true),
        context: (data.context as Record<string, unknown> | undefined) ?? {},
        createdAt: (data.createdAt as string | undefined) ?? new Date().toISOString(),
        updatedAt: (data.updatedAt as string | undefined) ?? new Date().toISOString(),
    };
}

export async function findSessionById(id: string): Promise<SessionStateRecord | null> {
    const db = getFirestore();
    const doc = await db.collection(SESSION_COLLECTION).doc(id).get();
    if (!doc.exists) {
        return null;
    }
    return mapSession(doc);
}

export async function findLatestActiveSession(userId: string): Promise<SessionStateRecord | null> {
    const db = getFirestore();
    const snapshot = await db
        .collection(SESSION_COLLECTION)
        .where('userId', '==', userId)
        .where('sessionActive', '==', true)
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get();
    if (snapshot.empty) {
        return null;
    }
    return mapSession(snapshot.docs[0]);
}

export interface CreateSessionInput {
    userId: string;
    context: Record<string, unknown>;
}

export async function createSession(input: CreateSessionInput): Promise<SessionStateRecord> {
    const now = new Date().toISOString();
    const db = getFirestore();
    const chatRef = db.collection(CHAT_COLLECTION).doc();
    await chatRef.set({
        id: chatRef.id,
        userId: input.userId,
        createdAt: now,
        updatedAt: now,
    });

    const sessionRef = db.collection(SESSION_COLLECTION).doc();
    const record: Omit<SessionStateRecord, 'id'> = {
        userId: input.userId,
        chatId: chatRef.id,
        state: 'plan_generated',
        iteration: 0,
        goalPreviewId: null,
        sessionActive: true,
        context: input.context,
        createdAt: now,
        updatedAt: now,
    };
    await sessionRef.set({ ...record, id: sessionRef.id });
    return { id: sessionRef.id, ...record };
}

export interface UpdateSessionInput {
    state?: SessionStateRecord['state'];
    iteration?: number;
    goalPreviewId?: string | null;
    sessionActive?: boolean;
    context?: Record<string, unknown>;
}

export async function updateSession(id: string, updates: UpdateSessionInput): Promise<SessionStateRecord> {
    const db = getFirestore();
    const docRef = db.collection(SESSION_COLLECTION).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
        throw new ApiError(404, 'Session not found.');
    }
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.state !== undefined) {
        payload.state = updates.state;
    }
    if (updates.iteration !== undefined) {
        payload.iteration = updates.iteration;
    }
    if (updates.goalPreviewId !== undefined) {
        payload.goalPreviewId = updates.goalPreviewId;
    }
    if (updates.sessionActive !== undefined) {
        payload.sessionActive = updates.sessionActive;
    }
    if (updates.context !== undefined) {
        payload.context = updates.context;
    }
    await docRef.update(payload);
    return mapSession(await docRef.get());
}

export interface ChatMessageInput {
    chatId: string;
    sessionId: string;
    sender: 'user' | 'agent';
    message: string;
}

export async function appendChatMessage(input: ChatMessageInput): Promise<void> {
    const now = new Date().toISOString();
    const db = getFirestore();
    const docRef = db.collection(CHAT_MESSAGE_COLLECTION).doc();
    await docRef.set({
        chatId: input.chatId,
        sessionId: input.sessionId,
        sender: input.sender,
        message: input.message,
        createdAt: now,
    });
    await db.collection(CHAT_COLLECTION).doc(input.chatId).update({ updatedAt: now });
    await db.collection(SESSION_COLLECTION).doc(input.sessionId).update({ updatedAt: now });
}

export async function listChatMessagesBySessionId(sessionId: string): Promise<ChatMessageRecord[]> {
    const db = getFirestore();
    const snapshot = await db
        .collection(CHAT_MESSAGE_COLLECTION)
        .where('sessionId', '==', sessionId)
        .orderBy('createdAt', 'asc')
        .get();
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            sessionId: data.sessionId as string,
            chatId: data.chatId as string,
            sender: data.sender as ChatMessageRecord['sender'],
            message: data.message as string,
            createdAt: (data.createdAt as string | undefined) ?? new Date().toISOString(),
        } satisfies ChatMessageRecord;
    });
}
