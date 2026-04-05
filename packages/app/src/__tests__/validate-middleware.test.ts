import { describe, it, expect, vi } from 'vitest';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  it('calls next and sets req.body on valid input', () => {
    const req = { body: { name: 'Alice', age: 30 } } as any;
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns 400 on invalid input', () => {
    const req = { body: { name: '', age: -1 } } as any;
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'Validation failed' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with issues array', () => {
    const req = { body: {} } as any;
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const call = res.json.mock.calls[0][0];
    expect(call.issues).toBeDefined();
    expect(Array.isArray(call.issues)).toBe(true);
  });
});
