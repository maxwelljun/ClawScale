import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const token = header.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    return;
  }

  req.auth = { userId: payload.sub, tenantId: payload.tid, role: payload.role };
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  if (auth.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Forbidden — admin role required' });
    return;
  }
  next();
}
