import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { signToken } from '../lib/jwt.js';

vi.mock('../db/index.js', () => ({
  db: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    member: { count: vi.fn() },
    conversation: { count: vi.fn() },
    channel: { count: vi.fn() },
    aiBackend: { count: vi.fn() },
    endUser: { count: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { tenantRouter } from '../routes/tenant.js';

const m = vi.mocked(db, true);
const adminToken = signToken({ sub: 'u1', tid: 't1', role: 'admin' });
const memberToken = signToken({ sub: 'u2', tid: 't1', role: 'member' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tenant', tenantRouter);
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

describe('GET /api/tenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tenant data', async () => {
    m.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme', settings: {} } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/tenant', { token: memberToken });
    expect(status).toBe(200);
    expect(body.data.name).toBe('Acme');
  });

  it('returns 404 for missing tenant', async () => {
    m.tenant.findUnique.mockResolvedValue(null as any);
    const { status } = await request(buildApp(), 'GET', '/api/tenant', { token: memberToken });
    expect(status).toBe(404);
  });

  it('masks clawscale LLM API key', async () => {
    m.tenant.findUnique.mockResolvedValue({
      id: 't1', name: 'Acme',
      settings: { clawscale: { llm: { model: 'gpt-4', apiKey: 'sk-secret-key' } } },
    } as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/tenant', { token: memberToken });
    expect(status).toBe(200);
    expect(body.data.settings.clawscale.llm.apiKey).toBe('••••••••');
  });
});

describe('PATCH /api/tenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-admin', async () => {
    const { status } = await request(buildApp(), 'PATCH', '/api/tenant', {
      token: memberToken, body: { name: 'New' },
    });
    expect(status).toBe(403);
  });

  it('updates tenant name', async () => {
    m.tenant.findUnique
      .mockResolvedValueOnce({ id: 't1', settings: {} } as any)
      .mockResolvedValueOnce({ id: 't1', name: 'Updated', settings: {} } as any);
    m.tenant.update.mockResolvedValue({} as any);
    m.auditLog.create.mockResolvedValue({} as any);

    const { status, body } = await request(buildApp(), 'PATCH', '/api/tenant', {
      token: adminToken, body: { name: 'Updated' },
    });
    expect(status).toBe(200);
    expect(body.data.name).toBe('Updated');
  });

  it('deep-merges clawscale LLM settings', async () => {
    m.tenant.findUnique
      .mockResolvedValueOnce({
        id: 't1',
        settings: { clawscale: { name: 'Bot', llm: { model: 'gpt-4', apiKey: 'sk-123' } } },
      } as any)
      .mockResolvedValueOnce({ id: 't1', settings: {} } as any);
    m.tenant.update.mockResolvedValue({} as any);
    m.auditLog.create.mockResolvedValue({} as any);

    await request(buildApp(), 'PATCH', '/api/tenant', {
      token: adminToken,
      body: { settings: { clawscale: { llm: { model: 'gpt-5' } } } },
    });

    const updateData = m.tenant.update.mock.calls[0]![0].data as any;
    expect(updateData.settings.clawscale.llm.model).toBe('gpt-5');
    expect(updateData.settings.clawscale.llm.apiKey).toBe('sk-123');
  });

  it('removes null clawscale keys', async () => {
    m.tenant.findUnique
      .mockResolvedValueOnce({
        id: 't1', settings: { clawscale: { name: 'Bot', llm: { model: 'gpt-4' } } },
      } as any)
      .mockResolvedValueOnce({ id: 't1', settings: {} } as any);
    m.tenant.update.mockResolvedValue({} as any);
    m.auditLog.create.mockResolvedValue({} as any);

    await request(buildApp(), 'PATCH', '/api/tenant', {
      token: adminToken, body: { settings: { clawscale: { llm: null } } },
    });

    const settings = (m.tenant.update.mock.calls[0]![0].data as any).settings;
    expect(settings.clawscale.llm).toBeUndefined();
  });
});

describe('GET /api/tenant/audit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-admin', async () => {
    const { status } = await request(buildApp(), 'GET', '/api/tenant/audit', { token: memberToken });
    expect(status).toBe(403);
  });

  it('returns audit logs with member name', async () => {
    m.auditLog.findMany.mockResolvedValue([
      { id: 'a1', memberId: 'u1', member: { name: 'Alice' }, action: 'login', resource: 'session', resourceId: null, meta: null, createdAt: new Date() },
    ] as any);
    const { status, body } = await request(buildApp(), 'GET', '/api/tenant/audit', { token: adminToken });
    expect(status).toBe(200);
    expect(body.data[0].memberName).toBe('Alice');
  });
});

describe('GET /api/tenant/stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns aggregate stats', async () => {
    m.tenant.findUnique.mockResolvedValue({ id: 't1', settings: {} } as any);
    m.member.count.mockResolvedValue(5 as any);
    m.conversation.count.mockResolvedValue(10 as any);
    m.channel.count.mockResolvedValue(3 as any);
    m.aiBackend.count.mockResolvedValue(2 as any);
    m.endUser.count.mockResolvedValue(100 as any);

    const { status, body } = await request(buildApp(), 'GET', '/api/tenant/stats', { token: memberToken });
    expect(status).toBe(200);
    expect(body.data.totalMembers).toBe(5);
    expect(body.data.totalEndUsers).toBe(100);
  });
});
