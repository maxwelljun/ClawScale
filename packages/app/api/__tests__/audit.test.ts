import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  db: {
    auditLog: { create: vi.fn() },
  },
}));

import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';

const mockCreate = vi.mocked(db.auditLog.create);

describe('audit', () => {
  beforeEach(() => mockCreate.mockReset().mockResolvedValue({} as any));

  it('creates an audit log entry with all fields', async () => {
    await audit({
      tenantId: 't1',
      memberId: 'm1',
      action: 'create_channel',
      resource: 'channel',
      resourceId: 'ch1',
      meta: { foo: 'bar' },
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const data = mockCreate.mock.calls[0]![0].data;
    expect(data.tenantId).toBe('t1');
    expect(data.memberId).toBe('m1');
    expect(data.action).toBe('create_channel');
    expect(data.resource).toBe('channel');
    expect(data.resourceId).toBe('ch1');
    expect(data.meta).toEqual({ foo: 'bar' });
    expect(data.id).toMatch(/^aud_/);
  });

  it('defaults optional fields to null', async () => {
    await audit({
      tenantId: 't1',
      action: 'login',
      resource: 'session',
    });

    const data = mockCreate.mock.calls[0]![0].data;
    expect(data.memberId).toBeNull();
    expect(data.resourceId).toBeNull();
  });
});
