import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, decodeToken } from '../lib/jwt.js';

describe('JWT utilities', () => {
  const payload = { sub: 'user_1', tid: 'tenant_1', role: 'admin' };

  it('signToken returns a string', () => {
    const token = signToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken decodes a valid token', () => {
    const token = signToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user_1');
    expect(decoded.tid).toBe('tenant_1');
    expect(decoded.role).toBe('admin');
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });

  it('verifyToken throws on invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('verifyToken throws on tampered token', () => {
    const token = signToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyToken(tampered)).toThrow();
  });

  it('decodeToken returns payload without verification', () => {
    const token = signToken(payload);
    const decoded = decodeToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('user_1');
  });

  it('decodeToken returns null for garbage input', () => {
    const result = decodeToken('not-a-jwt');
    // jwt.decode returns null for non-JWT strings (doesn't throw)
    expect(result).toBeNull();
  });
});
