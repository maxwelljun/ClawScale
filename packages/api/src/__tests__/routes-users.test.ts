import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { signToken } from '../lib/jwt.js';

vi.mock('../db/index.js', () => ({
  db: {
    member: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      create: vi.fn(), update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { usersRouter } from '../routes/users.js';

const m = vi.mocked(db, true);
const adminToken = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
const memberToken = signToken({ sub: 'u2', tid: 't1', role: 'member' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  return app;
}

async function request(app: express.Express, method: string, path: string, opts: { token?: string; body?: any } = {}) {
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

describe('GET /api/users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns users list', async () => {
    m.member.findMany.mockResolvedValue([{ id: 'u1', name: 'Alice' }] as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/users', { token: memberToken });
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /api/users (invite)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-admin', async () => {
    const { status } = await request(buildApp(), 'POST', '/api/users', {
      token: memberToken,
      body: { email: 'new@example.com', name: 'New', temporaryPassword: 'password123' },
    });
    expect(status).toBe(403);
  });

  it('returns 409 for duplicate email', async () => {
    m.member.findUnique.mockResolvedValue({ id: 'existing' } as any);
    const { status } = await request(buildApp(), 'POST', '/api/users', {
      token: adminToken,
      body: { email: 'dup@example.com', name: 'Dup', temporaryPassword: 'password123' },
    });
    expect(status).toBe(409);
  });

  it('creates a new member', async () => {
    m.member.findUnique.mockResolvedValueOnce(null as any);
    m.member.create.mockResolvedValue({} as any);
    m.member.findUnique.mockResolvedValueOnce({ id: 'm2', name: 'New' } as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'POST', '/api/users', {
      token: adminToken,
      body: { email: 'new@example.com', name: 'New', temporaryPassword: 'password123' },
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
  });
});

describe('GET /api/users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown', async () => {
    m.member.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'GET', '/api/users/unknown', { token: memberToken });
    expect(status).toBe(404);
  });

  it('returns a user', async () => {
    m.member.findFirst.mockResolvedValue({ id: 'u1', name: 'Alice' } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/users/u1', { token: memberToken });
    expect(status).toBe(200);
    expect(body.data.name).toBe('Alice');
  });
});

describe('PATCH /api/users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates a member', async () => {
    m.member.findFirst.mockResolvedValue({ id: 'u2' } as any);
    m.member.update.mockResolvedValue({} as any);
    m.member.findUnique.mockResolvedValue({ id: 'u2', name: 'Updated' } as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'PATCH', '/api/users/u2', {
      token: adminToken, body: { name: 'Updated' },
    });
    expect(status).toBe(200);
    expect(body.data.name).toBe('Updated');
  });
});

describe('DELETE /api/users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 422 when trying to deactivate self', async () => {
    const { status } = await request(buildApp(), 'DELETE', '/api/users/u1', { token: adminToken });
    expect(status).toBe(422);
  });

  it('deactivates a member', async () => {
    m.member.findFirst.mockResolvedValue({ id: 'u3' } as any);
    m.member.update.mockResolvedValue({} as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'DELETE', '/api/users/u3', { token: adminToken });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
