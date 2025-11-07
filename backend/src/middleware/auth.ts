import { NextFunction, Request, Response } from 'express';

import { ApiError } from '../errors';
import { verifyJwt } from '../services/tokenService';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        if (!token) {
            throw new ApiError(401, 'Unauthorized');
        }
        const claims = verifyJwt(token);
        req.user = { userId: claims.userId, email: claims.email };
        next();
    } catch (error) {
        const status = error instanceof ApiError ? error.status : 401;
        res.status(status).json({ error: { code: status, message: 'Unauthorized' } });
    }
}
