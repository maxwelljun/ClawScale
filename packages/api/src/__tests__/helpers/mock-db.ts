/**
 * Shared Prisma db mock factory for route tests.
 *
 * Usage:
 *   vi.mock('../../db/index.js', () => ({ db: createMockDb() }));
 *
 * Each model exposes the standard Prisma methods as vi.fn() stubs.
 */
import { vi } from 'vitest';

function mockModel() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  };
}

export function createMockDb() {
  return {
    tenant: mockModel(),
    member: mockModel(),
    session: mockModel(),
    channel: mockModel(),
    endUser: mockModel(),
    endUserBackend: mockModel(),
    conversation: mockModel(),
    message: mockModel(),
    aiBackend: mockModel(),
    auditLog: mockModel(),
    linkCode: mockModel(),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
      // Provide the same mock models inside the transaction
      const tx = {
        tenant: mockModel(),
        member: mockModel(),
      };
      await fn(tx);
      return tx;
    }),
  };
}

/** Build Express-like req/res/next mocks */
export function mockReq(overrides: Record<string, any> = {}) {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    auth: undefined,
    ...overrides,
  } as any;
}

export function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

export function mockNext() {
  return vi.fn();
}
