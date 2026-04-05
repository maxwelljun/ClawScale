import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { signToken } from '../lib/jwt.js';

vi.mock('../db/index.js', () => ({
  db: {
    endUser: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { endUsersRouter } from '../routes/end-users.js';

const m = vi.mocked(db, true);
const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/end-users', endUsersRouter);
  return app;
}

async function request(app: express.Express, method: string, path: string, opts: { token?: string } = {}) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address() as any;
      try {
        const headers: Record<string, string> = {};
        if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method, headers });
        const json = await res.json();
        resolve({ status: res.status, body: json });
      } finally {
        server.close();
      }
    });
  });
}

describe('GET /api/end-users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns end users with total', async () => {
    m.endUser.findMany.mockResolvedValue([{ id: 'eu1' }] as any);
    m.endUser.count.mockResolvedValue(1 as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/end-users', { token });
    expect(status).toBe(200);
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.total).toBe(1);
  });
});

describe('GET /api/end-users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown', async () => {
    m.endUser.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'GET', '/api/end-users/x', { token });
    expect(status).toBe(404);
  });

  it('returns an end user', async () => {
    m.endUser.findFirst.mockResolvedValue({ id: 'eu1', name: 'John' } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/end-users/eu1', { token });
    expect(status).toBe(200);
    expect(body.data.name).toBe('John');
  });
});
