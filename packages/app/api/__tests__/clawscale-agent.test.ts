import { describe, it, expect } from 'vitest';
import { buildSelectionMenu } from '../lib/clawscale-agent.js';

describe('buildSelectionMenu', () => {
  it('shows welcome with no backends configured', () => {
    const menu = buildSelectionMenu('ClawScale', []);
    expect(menu).toContain('Welcome');
    expect(menu).toContain('No AI backends');
  });

  it('lists available backends', () => {
    const backends = [
      { id: 'b1', name: 'GPT-4' },
      { id: 'b2', name: 'Claude' },
    ];
    const menu = buildSelectionMenu('ClawScale', backends);
    expect(menu).toContain('1. GPT-4');
    expect(menu).toContain('2. Claude');
  });

  it('uses custom persona name', () => {
    const menu = buildSelectionMenu('My Bot', [{ id: 'b1', name: 'GPT' }]);
    expect(menu).toContain('My Bot');
  });
});
