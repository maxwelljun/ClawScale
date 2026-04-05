import { describe, it, expect } from 'vitest';
import { generateId } from '../lib/id.js';

describe('generateId', () => {
  it('returns a 21-char string without prefix', () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  it('prepends prefix with underscore separator', () => {
    const id = generateId('usr');
    expect(id).toMatch(/^usr_.{21}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
