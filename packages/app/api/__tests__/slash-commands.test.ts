import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  resolveTarget,
  resolveAddRemoveArg,
  formatCommandHelp,
} from '../lib/slash-commands.js';
import { buildSelectionMenu } from '../lib/clawscale-agent.js';

// ── parseCommand ─────────────────────────────────────────────────────────────

describe('parseCommand', () => {
  it('returns null for plain text', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('how are you?')).toBeNull();
  });

  it('parses /help', () => {
    const result = parseCommand('/help');
    expect(result).toEqual({ kind: 'system', command: 'help', arg: '' });
  });

  it('parses /backends', () => {
    const result = parseCommand('/backends');
    expect(result).toEqual({ kind: 'system', command: 'backends', arg: '' });
  });

  it('parses /clear', () => {
    const result = parseCommand('/clear');
    expect(result).toEqual({ kind: 'system', command: 'clear', arg: '' });
  });

  it('parses /team with no arg', () => {
    const result = parseCommand('/team');
    expect(result).toEqual({ kind: 'system', command: 'team', arg: '' });
  });

  it('parses /team invite gpt', () => {
    const result = parseCommand('/team invite gpt');
    expect(result).toEqual({ kind: 'system', command: 'team', arg: 'invite gpt' });
  });

  it('parses /team kick 2', () => {
    const result = parseCommand('/team kick 2');
    expect(result).toEqual({ kind: 'system', command: 'team', arg: 'kick 2' });
  });

  it('parses /link with code', () => {
    const result = parseCommand('/link 123456');
    expect(result).toEqual({ kind: 'system', command: 'link', arg: '123456' });
  });

  it('parses /deleteaccount confirm', () => {
    const result = parseCommand('/deleteaccount confirm');
    expect(result).toEqual({ kind: 'system', command: 'deleteaccount', arg: 'confirm' });
  });

  it('returns null for unknown slash commands', () => {
    expect(parseCommand('/unknown')).toBeNull();
    expect(parseCommand('/foo bar')).toBeNull();
  });

  it('is case-insensitive for slash commands', () => {
    const result = parseCommand('/HELP');
    expect(result).toEqual({ kind: 'system', command: 'help', arg: '' });
  });

  it('trims whitespace', () => {
    const result = parseCommand('  /help  ');
    expect(result).toEqual({ kind: 'system', command: 'help', arg: '' });
  });

  // Direct messages
  it('parses "gpt> hello" as direct message', () => {
    const result = parseCommand('gpt> hello');
    expect(result).toEqual({ kind: 'direct', target: 'gpt', message: 'hello' });
  });

  it('parses "> message" as direct to clawscale', () => {
    const result = parseCommand('> help me');
    expect(result).toEqual({ kind: 'direct', target: 'clawscale', message: 'help me' });
  });

  it('parses "agent name> multi word message"', () => {
    const result = parseCommand('basic llm> explain this');
    expect(result).toEqual({ kind: 'direct', target: 'basic llm', message: 'explain this' });
  });

  it('lowercases the target', () => {
    const result = parseCommand('GPT> hello');
    expect(result).toEqual({ kind: 'direct', target: 'gpt', message: 'hello' });
  });

  it('rejects targets longer than 50 chars (false positive protection)', () => {
    const longTarget = 'a'.repeat(51);
    const result = parseCommand(`${longTarget}> hello`);
    expect(result).toBeNull();
  });

  it('handles empty message after >', () => {
    const result = parseCommand('gpt>');
    expect(result).toEqual({ kind: 'direct', target: 'gpt', message: '' });
  });
});

// ── resolveTarget ────────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  const backends = [
    { id: 'b1', name: 'GPT-4', config: {} },
    { id: 'b2', name: 'Claude', config: { commandAlias: 'cl' } },
    { id: 'b3', name: 'Gemini', config: {} },
  ];

  it('resolves "clawscale" to clawscale type', () => {
    expect(resolveTarget('clawscale', backends)).toEqual({ type: 'clawscale' });
  });

  it('resolves exact name match (case-insensitive)', () => {
    expect(resolveTarget('gpt-4', backends)).toEqual({
      type: 'backend', backendId: 'b1', backendName: 'GPT-4',
    });
  });

  it('resolves by command alias', () => {
    expect(resolveTarget('cl', backends)).toEqual({
      type: 'backend', backendId: 'b2', backendName: 'Claude',
    });
  });

  it('resolves unambiguous prefix', () => {
    expect(resolveTarget('gem', backends)).toEqual({
      type: 'backend', backendId: 'b3', backendName: 'Gemini',
    });
  });

  it('returns not_found for ambiguous prefix', () => {
    // Both "GPT-4" and "Gemini" start with "g"
    expect(resolveTarget('g', backends)).toEqual({ type: 'not_found' });
  });

  it('returns not_found for unknown name', () => {
    expect(resolveTarget('unknown', backends)).toEqual({ type: 'not_found' });
  });
});

// ── resolveAddRemoveArg ──────────────────────────────────────────────────────

describe('resolveAddRemoveArg', () => {
  const backends = [
    { id: 'b1', name: 'GPT-4', config: {} },
    { id: 'b2', name: 'Claude', config: {} },
  ];

  it('resolves by 1-indexed number', () => {
    expect(resolveAddRemoveArg('1', backends)).toEqual({
      type: 'backend', backendId: 'b1', backendName: 'GPT-4',
    });
    expect(resolveAddRemoveArg('2', backends)).toEqual({
      type: 'backend', backendId: 'b2', backendName: 'Claude',
    });
  });

  it('resolves by name', () => {
    expect(resolveAddRemoveArg('claude', backends)).toEqual({
      type: 'backend', backendId: 'b2', backendName: 'Claude',
    });
  });

  it('returns not_found for out-of-range number', () => {
    expect(resolveAddRemoveArg('0', backends)).toEqual({ type: 'not_found' });
    expect(resolveAddRemoveArg('3', backends)).toEqual({ type: 'not_found' });
  });

  it('returns not_found for unknown name', () => {
    expect(resolveAddRemoveArg('nonexistent', backends)).toEqual({ type: 'not_found' });
  });
});

// ── formatCommandHelp ────────────────────────────────────────────────────────

describe('formatCommandHelp', () => {
  it('includes all commands', () => {
    const help = formatCommandHelp();
    expect(help).toContain('/backends');
    expect(help).toContain('/team');
    expect(help).toContain('/clear');
    expect(help).toContain('/help');
    expect(help).toContain('/link');
    expect(help).toContain('/unlink');
    expect(help).toContain('/deleteaccount');
  });
});
