import jwt, { SignOptions } from 'jsonwebtoken';

import { ApiError } from '../errors';

export interface JwtClaims {
    userId: string;
    email: string;
}

const DEFAULT_EXPIRATION: number | string = '7d';

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new ApiError(500, 'JWT secret not configured.');
    }
    return secret;
}

export function signJwt(claims: JwtClaims, expiresIn: number | string = DEFAULT_EXPIRATION): string {
    const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
    return jwt.sign(claims, getJwtSecret(), options);
}

export function verifyJwt(token: string): JwtClaims {
    try {
        const payload = jwt.verify(token, getJwtSecret());
        if (typeof payload !== 'object' || !('userId' in payload) || !('email' in payload)) {
            throw new ApiError(401, 'Invalid session token.');
        }
        return { userId: payload.userId as string, email: payload.email as string };
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(401, 'Invalid or expired session token.');
    }
}
