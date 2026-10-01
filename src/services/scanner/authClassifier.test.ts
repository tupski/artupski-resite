import { describe, expect, it } from 'vitest';
import { classifyPageAuth, hasAuthWall, type AuthClassifyInput } from './authClassifier';

function input(overrides: Partial<AuthClassifyInput> = {}): AuthClassifyInput {
  return {
    sessionInjected: false,
    httpStatus: 200,
    signals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false },
    extractionStatus: 'completed',
    ...overrides
  };
}

describe('classifyPageAuth', () => {
  it('classifies a no-wall page without a session as public', () => {
    expect(classifyPageAuth(input())).toBe('public');
  });

  it('classifies a login redirect as auth_required without a session', () => {
    expect(
      classifyPageAuth(
        input({ signals: { redirectedToLogin: true, hasPasswordField: false, hasCaptcha: false } })
      )
    ).toBe('auth_required');
  });

  it('classifies a password form as auth_required without a session', () => {
    expect(
      classifyPageAuth(
        input({ signals: { redirectedToLogin: false, hasPasswordField: true, hasCaptcha: false } })
      )
    ).toBe('auth_required');
  });

  it('classifies a no-wall page reached with a session as authenticated', () => {
    expect(classifyPageAuth(input({ sessionInjected: true }))).toBe('authenticated');
  });

  it('still classifies a wall as auth_required even when a session was injected', () => {
    // A wall is proof the session did not hold; it must never read authenticated.
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          signals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: false }
        })
      )
    ).toBe('auth_required');
  });

  it('classifies 401/403 without a session as auth_required', () => {
    expect(classifyPageAuth(input({ httpStatus: 401 }))).toBe('auth_required');
    expect(classifyPageAuth(input({ httpStatus: 403 }))).toBe('auth_required');
  });

  it('classifies a CAPTCHA / rate-limit challenge as blocked (never authenticated)', () => {
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          signals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: true }
        })
      )
    ).toBe('blocked');
    expect(classifyPageAuth(input({ sessionInjected: true, httpStatus: 429 }))).toBe('blocked');
  });

  it('classifies a failed/timed-out fetch as unknown', () => {
    expect(classifyPageAuth(input({ extractionStatus: 'failed' }))).toBe('unknown');
    expect(classifyPageAuth(input({ extractionStatus: 'timeout' }))).toBe('unknown');
  });

  it('never returns authenticated without a session', () => {
    const statuses = [
      input(),
      input({ httpStatus: 401 }),
      input({ signals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: false } }),
      input({ httpStatus: 429 })
    ].map((i) => classifyPageAuth(i));
    expect(statuses).not.toContain('authenticated');
  });
});

describe('hasAuthWall', () => {
  it('is true for a login redirect or a password field', () => {
    expect(
      hasAuthWall({ redirectedToLogin: true, hasPasswordField: false, hasCaptcha: false })
    ).toBe(true);
    expect(
      hasAuthWall({ redirectedToLogin: false, hasPasswordField: true, hasCaptcha: false })
    ).toBe(true);
    expect(
      hasAuthWall({ redirectedToLogin: false, hasPasswordField: false, hasCaptcha: true })
    ).toBe(false);
  });
});
