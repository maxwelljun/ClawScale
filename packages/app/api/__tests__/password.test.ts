import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password.js';

describe('Password utilities', () => {
  it('hashPassword returns a bcrypt hash', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toMatch(/^\$2[aby]?\$/);
    expect(hash).not.toBe('mypassword');
  });

  it('verifyPassword returns true for correct password', async () => {
    const hash = await hashPassword('secret123');
    const result = await verifyPassword('secret123', hash);
    expect(result).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('secret123');
    const result = await verifyPassword('wrongpassword', hash);
    expect(result).toBe(false);
  });

  it('produces different hashes for same input (salted)', async () => {
    const hash1 = await hashPassword('same');
    const hash2 = await hashPassword('same');
    expect(hash1).not.toBe(hash2);
  });
});
