import { OAuth2Client } from 'google-auth-library';

import { ApiError } from '../errors';

const client = new OAuth2Client();

export interface GoogleProfile {
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string | null;
    picture?: string | null;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) {
        throw new ApiError(500, 'Google client ID not configured.');
    }

    try {
        const ticket = await client.verifyIdToken({ idToken, audience });
        const payload = ticket.getPayload();
        if (!payload) {
            throw new ApiError(401, 'Invalid or expired Google ID token.');
        }
        const { sub, email, email_verified: emailVerified, name, picture } = payload;
        if (!email || !sub) {
            throw new ApiError(401, 'Invalid or expired Google ID token.');
        }
        return {
            sub,
            email,
            emailVerified: Boolean(emailVerified),
            name: name ?? null,
            picture: picture ?? null,
        };
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(401, 'Invalid or expired Google ID token.');
    }
}
