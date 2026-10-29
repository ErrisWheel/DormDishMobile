import jwt from 'jsonwebtoken';
import { db } from './database.js';

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 24) {
    throw new Error('JWT_SECRET must be set in .env and contain at least 24 characters.');
}

export function createToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            role: user.role
        },
        jwtSecret,
        { expiresIn: '12h' }
    );
}

export function requireAuth(req, res, next) {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';

    if (!token) {
        return res.status(401).json({ error: 'Sign in to continue.' });
    }

    try {
        const payload = jwt.verify(token, jwtSecret);
        const user = db.prepare(`
            SELECT id, name, email, role, store_id, is_active, is_online, profile_image_url, email_verified, created_at
            FROM users
            WHERE id = ?
        `).get(payload.sub);

        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'This account is unavailable.' });
        }

        req.user = user;
        next();
    } catch {
        return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    }
}

export function allowRoles(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'You do not have permission to perform this action.' });
        }

        next();
    };
}
