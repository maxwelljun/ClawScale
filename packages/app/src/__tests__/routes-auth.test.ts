import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

// vi.mock factories must not reference outer variables — use inline object
vi.mock('../db/index.js', () => ({
  db: {
    tenant: { findUnique: vi.fn(), create: vi.fn() },
    member: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      await fn({ tenant: { create: vi.fn() }, member: { create: vi.fn() } });
    }),
  },
}));

import { db } from '../db/index.js';
import { authRouter } from '../routes/auth.js';

const mockDb = vi.mocked(db, true);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

async function req(app: express.Express, method: string, path: string, opts: { token?: string; body?: any } = {}) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address() as any;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method, headers,
          ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        });
        const json = await res.json();
        resolve({ status: res.status, body: json });
      } finally {
        server.close();
      }
    });
  });
}

describe('POST /auth/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid body', async () => {
    const { status, body } = await req(buildApp(), 'POST', '/auth/register', { body: { email: 'bad' } });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns 409 when slug already taken', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: 'existing' } as any);
    const { status, body } = await req(buildApp(), 'POST', '/auth/register', {
      body: { tenantSlug: 'taken', tenantName: 'Taken Corp', name: 'Admin', email: 'admin@example.com', password: 'password123' },
    });
    expect(status).toBe(409);
    expect(body.error).toContain('already taken');
  });

  it('registers successfully', async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce(null as any); // slug check
    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: 'tnt_1', slug: 'acme', name: 'Acme' } as any);
    mockDb.member.findUnique.mockResolvedValue({ id: 'mbr_1', tenantId: 'tnt_1', email: 'a@b.com', name: 'A', role: 'admin', createdAt: new Date() } as any);
    mockDb.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await req(buildApp(), 'POST', '/auth/register', {
      body: { tenantSlug: 'acme', tenantName: 'Acme Corp', name: 'Admin', email: 'admin@acme.com', password: 'securepass1' },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tokens.accessToken).toBeDefined();
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for non-existent user', async () => {
    mockDb.member.findFirst.mockResolvedValue(null as any);
    const { status } = await req(buildApp(), 'POST', '/auth/login', {
      body: { email: 'nobody@x.com', password: 'pass1234' },
    });
    expect(status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const { hashPassword } = await import('../lib/password.js');
    const hash = await hashPassword('correctpass');
    mockDb.member.findFirst.mockResolvedValue({
      id: 'm1', tenantId: 't1', email: 'a@b.com', name: 'A', role: 'admin',
      passwordHash: hash, createdAt: new Date(), lastActiveAt: null, isActive: true,
    } as any);
    const { status } = await req(buildApp(), 'POST', '/auth/login', {
      body: { email: 'a@b.com', password: 'wrongpass' },
    });
    expect(status).toBe(401);
  });

  it('logs in successfully', async () => {
    const { hashPassword } = await import('../lib/password.js');
    const hash = await hashPassword('mypassword');
    mockDb.member.findFirst.mockResolvedValue({
      id: 'm1', tenantId: 't1', email: 'a@b.com', name: 'A', role: 'admin',
      passwordHash: hash, createdAt: new Date(), lastActiveAt: null, isActive: true,
    } as any);
    mockDb.member.update.mockResolvedValue({} as any);
    mockDb.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'T' } as any);
    mockDb.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await req(buildApp(), 'POST', '/auth/login', {
      body: { email: 'a@b.com', password: 'mypassword' },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tokens.accessToken).toBeDefined();
  });
});

describe('GET /auth/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const { status } = await req(buildApp(), 'GET', '/auth/me');
    expect(status).toBe(401);
  });

  it('returns user when authenticated', async () => {
    const { signToken } = await import('../lib/jwt.js');
    const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
    mockDb.member.findUnique.mockResolvedValue({ id: 'u1', tenantId: 't1', email: 'a@b.com', name: 'A', role: 'admin' } as any);
    mockDb.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'T' } as any);

    const { status, body } = await req(buildApp(), 'GET', '/auth/me', { token });
    expect(status).toBe(200);
    expect(body.data.user.id).toBe('u1');
  });

  it('returns 404 if member not found', async () => {
    const { signToken } = await import('../lib/jwt.js');
    const token = signToken({ sub: 'gone', tid: 't1', role: 'admin' });
    mockDb.member.findUnique.mockResolvedValue(null as any);

    const { status } = await req(buildApp(), 'GET', '/auth/me', { token });
    expect(status).toBe(404);
  });
});

describe('DELETE /auth/account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 422 if sole admin', async () => {
    const { signToken } = await import('../lib/jwt.js');
    const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
    mockDb.member.findUnique.mockResolvedValue({ id: 'u1', role: 'admin' } as any);
    mockDb.member.count.mockResolvedValue(1 as any);

    const { status, body } = await req(buildApp(), 'DELETE', '/auth/account', { token });
    expect(status).toBe(422);
    expect(body.error).toContain('only admin');
  });

  it('deletes account when not sole admin', async () => {
    const { signToken } = await import('../lib/jwt.js');
    const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
    mockDb.member.findUnique.mockResolvedValue({ id: 'u1', role: 'admin' } as any);
    mockDb.member.count.mockResolvedValue(2 as any);
    mockDb.member.delete.mockResolvedValue({} as any);
    mockDb.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await req(buildApp(), 'DELETE', '/auth/account', { token });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
