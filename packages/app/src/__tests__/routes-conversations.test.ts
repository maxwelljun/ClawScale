import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { signToken } from '../lib/jwt.js';

vi.mock('../db/index.js', () => ({
  db: {
    conversation: { findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    message: { deleteMany: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { conversationsRouter } from '../routes/conversations.js';

const m = vi.mocked(db, true);
const token = signToken({ sub: 'u1', tid: 't1', role: 'admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
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

describe('GET /api/conversations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conversations', async () => {
    m.conversation.findMany.mockResolvedValue([{ id: 'c1' }] as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/conversations', { token });
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /api/conversations/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown', async () => {
    m.conversation.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'GET', '/api/conversations/x', { token });
    expect(status).toBe(404);
  });

  it('returns conversation with messages', async () => {
    m.conversation.findFirst.mockResolvedValue({ id: 'c1', messages: [{ id: 'm1' }] } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/conversations/c1', { token });
    expect(status).toBe(200);
    expect(body.data.id).toBe('c1');
  });
});

describe('DELETE /api/conversations/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown', async () => {
    m.conversation.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'DELETE', '/api/conversations/x', { token });
    expect(status).toBe(404);
  });

  it('deletes messages and conversation', async () => {
    m.conversation.findFirst.mockResolvedValue({ id: 'c1' } as any);
    m.message.deleteMany.mockResolvedValue({} as any);
    m.conversation.delete.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'DELETE', '/api/conversations/c1', { token });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(m.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
  });
});
