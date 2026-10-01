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

  it('reports `authenticated` as session USE, not verified protection (public page in an auth run)', () => {
    // Known limitation: a genuinely public page reached during an authenticated
    // scan is labelled `authenticated` because no unauthenticated comparison is
    // permitted. The value means "session was in effect", nothing stronger.
    expect(classifyPageAuth(input({ sessionInjected: true, httpStatus: 200 }))).toBe(
      'authenticated'
    );
  });

  it('treats a confirmed protected page (wall) as auth_required with no session', () => {
    expect(
      classifyPageAuth(
        input({
          httpStatus: 403,
          signals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false }
        })
      )
    ).toBe('auth_required');
  });

  it('prefers blocked over auth_required when both a CAPTCHA and a status are present', () => {
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          httpStatus: 403,
          signals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: true }
        })
      )
    ).toBe('blocked');
  });

  it('classifies an access-denied 403 with a session as auth_required (not authenticated)', () => {
    expect(classifyPageAuth(input({ sessionInjected: true, httpStatus: 403 }))).toBe(
      'auth_required'
    );
  });

  it('classifies a skipped extraction as a non-completed, unknown signal', () => {
    expect(classifyPageAuth(input({ extractionStatus: 'skipped' }))).toBe('public');
  });

  it('resolves conflicting signals by precedence: failure > captcha > wall > session', () => {
    // Failure dominates even a CAPTCHA.
    expect(
      classifyPageAuth(
        input({
          extractionStatus: 'timeout',
          httpStatus: 429,
          signals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: true }
        })
      )
    ).toBe('unknown');
    // CAPTCHA dominates a login wall.
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          httpStatus: 200,
          signals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: true }
        })
      )
    ).toBe('blocked');
    // A wall dominates a session.
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          httpStatus: 200,
          signals: { redirectedToLogin: true, hasPasswordField: false, hasCaptcha: false }
        })
      )
    ).toBe('auth_required');
  });

  it('treats an expired session (redirect back to login) as auth_required, never authenticated', () => {
    expect(
      classifyPageAuth(
        input({
          sessionInjected: true,
          httpStatus: 200,
          signals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: false }
        })
      )
    ).toBe('auth_required');
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
