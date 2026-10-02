import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET_PROFILE, TokenBudgetManager } from '../tokenBudget';

describe('TokenBudgetManager (AI-SPEC.md 3.1)', () => {
  it('uses a known profile for a listed model', () => {
    const manager = new TokenBudgetManager('gpt-4o');
    expect(manager.getConfig().contextWindow).toBe(128000);
  });

  it('falls back to the default profile for an unknown model', () => {
    const manager = new TokenBudgetManager('some-unlisted-model');
    expect(manager.getConfig()).toEqual(DEFAULT_BUDGET_PROFILE);
  });

  it('estimates tokens with the documented heuristic', () => {
    const manager = new TokenBudgetManager('default');
    expect(manager.estimateTokenCount('')).toBe(0);
    expect(manager.estimateTokenCount('abcd')).toBe(Math.ceil(4 / 3.8));
  });

  it('reserves completion + safety margin from the usable input budget', () => {
    const manager = new TokenBudgetManager('default');
    expect(manager.getUsableInputBudget()).toBe(8192 - 2048 - 512);
  });

  it('fitsInContext is true within budget and false when exceeded', () => {
    const manager = new TokenBudgetManager('default');
    const budget = manager.getUsableInputBudget();
    expect(manager.fitsInContext('system', 'x'.repeat(budget * 3))).toBe(true);
    expect(manager.fitsInContext('system', 'x'.repeat((budget + 100) * 4))).toBe(false);
  });
});
