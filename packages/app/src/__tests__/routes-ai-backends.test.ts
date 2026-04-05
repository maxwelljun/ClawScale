import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { signToken } from '../lib/jwt.js';

vi.mock('../db/index.js', () => ({
  db: {
    aiBackend: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
    },
    endUserBackend: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { aiBackendsRouter } from '../routes/ai-backends.js';

const m = vi.mocked(db, true);
const adminToken = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
const memberToken = signToken({ sub: 'u2', tid: 't1', role: 'member' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-backends', aiBackendsRouter);
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

describe('GET /api/ai-backends', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without auth', async () => {
    const { status } = await request(buildApp(), 'GET', '/api/ai-backends');
    expect(status).toBe(401);
  });

  it('returns backends list', async () => {
    m.aiBackend.findMany.mockResolvedValue([{ id: 'b1', name: 'GPT', type: 'llm', isActive: true }] as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/ai-backends', { token: adminToken });
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /api/ai-backends', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-admin', async () => {
    const { status } = await request(buildApp(), 'POST', '/api/ai-backends', {
      token: memberToken, body: { name: 'GPT', type: 'llm', config: {} },
    });
    expect(status).toBe(403);
  });

  it('creates a backend', async () => {
    m.aiBackend.create.mockResolvedValue({} as any);
    m.aiBackend.findUnique.mockResolvedValue({ id: 'b1', name: 'GPT', type: 'llm' } as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'POST', '/api/ai-backends', {
      token: adminToken, body: { name: 'GPT', type: 'llm', config: { apiKey: 'sk-123' } },
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('unsets other defaults when isDefault is true', async () => {
    m.aiBackend.create.mockResolvedValue({} as any);
    m.aiBackend.updateMany.mockResolvedValue({} as any);
    m.aiBackend.findUnique.mockResolvedValue({ id: 'b1' } as any);
    m.auditLog.create.mockResolvedValue({} as any);

    await request(buildApp(), 'POST', '/api/ai-backends', {
      token: adminToken, body: { name: 'GPT', type: 'llm', config: {}, isDefault: true },
    });
    expect(m.aiBackend.updateMany).toHaveBeenCalled();
  });
});

describe('GET /api/ai-backends/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown', async () => {
    m.aiBackend.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'GET', '/api/ai-backends/x', { token: adminToken });
    expect(status).toBe(404);
  });

  it('returns a backend', async () => {
    m.aiBackend.findFirst.mockResolvedValue({ id: 'b1', name: 'GPT' } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/ai-backends/b1', { token: adminToken });
    expect(status).toBe(200);
    expect(body.data.id).toBe('b1');
  });
});

describe('PATCH /api/ai-backends/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for non-existent', async () => {
    m.aiBackend.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'PATCH', '/api/ai-backends/x', {
      token: adminToken, body: { name: 'New' },
    });
    expect(status).toBe(404);
  });

  it('updates a backend', async () => {
    m.aiBackend.findFirst.mockResolvedValue({ id: 'b1' } as any);
    m.aiBackend.update.mockResolvedValue({} as any);
    m.aiBackend.findUnique.mockResolvedValue({ id: 'b1', name: 'Updated' } as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'PATCH', '/api/ai-backends/b1', {
      token: adminToken, body: { name: 'Updated' },
    });
    expect(status).toBe(200);
    expect(body.data.name).toBe('Updated');
  });
});

describe('DELETE /api/ai-backends/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for non-existent', async () => {
    m.aiBackend.findFirst.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'DELETE', '/api/ai-backends/x', { token: adminToken });
    expect(status).toBe(404);
  });

  it('deletes backend and cleans up', async () => {
    m.aiBackend.findFirst.mockResolvedValue({ id: 'b1' } as any);
    m.endUserBackend.deleteMany.mockResolvedValue({} as any);
    m.aiBackend.delete.mockResolvedValue({} as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'DELETE', '/api/ai-backends/b1', { token: adminToken });
    expect(status).toBe(200);
    expect(m.endUserBackend.deleteMany).toHaveBeenCalledWith({ where: { backendId: 'b1' } });
  });
});
