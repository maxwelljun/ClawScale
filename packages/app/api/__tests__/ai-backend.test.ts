import { describe, it, expect } from 'vitest';
import { isBridgeConnected, generateReply } from '../lib/ai-backend.js';

describe('ai-backend utilities', () => {
  it('isBridgeConnected returns false for unknown backend', () => {
    expect(isBridgeConnected('nonexistent')).toBe(false);
  });
});

describe('generateReply', () => {
  it('throws for unknown backend type', async () => {
    await expect(
      generateReply({
        backend: { type: 'fake-type' as any, config: {} as any },
        history: [],
      }),
    ).rejects.toThrow('Unknown AI backend type');
  });

  it('throws when llm backend has no apiKey', async () => {
    await expect(
      generateReply({
        backend: { type: 'llm', config: {} as any },
        history: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('apiKey is required');
  });

  it('returns warning when pty-websocket bridge not connected', async () => {
    const result = await generateReply({
      backend: {
        type: 'cli-bridge',
        config: { __backendId: 'not-connected' } as any,
      },
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toContain('bridge is not connected');
  });
});
