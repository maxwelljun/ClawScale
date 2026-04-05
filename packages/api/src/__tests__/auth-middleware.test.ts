import { describe, it, expect, vi } from 'vitest';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { signToken } from '../lib/jwt.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(headers: Record<string, string> = {}, auth?: any): Request {
  return { headers, auth } as unknown as Request;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('requireAuth middleware', () => {
  it('sets req.auth and calls next for valid token', async () => {
    const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual({ userId: 'u1', tenantId: 't1', role: 'admin' });
  });

  it('returns 401 when no Authorization header', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', async () => {
    const req = mockReq({ authorization: 'Bearer bad-token' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Invalid or expired token' });
  });

  it('returns 401 for non-Bearer scheme', async () => {
    const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
    const req = mockReq({ authorization: `Basic ${token}` });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireAdmin middleware', () => {
  it('calls next when role is admin', async () => {
    const req = mockReq({}, { userId: 'u1', tenantId: 't1', role: 'admin' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when role is not admin', async () => {
    const req = mockReq({}, { userId: 'u1', tenantId: 't1', role: 'member' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 401 when auth is missing', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
