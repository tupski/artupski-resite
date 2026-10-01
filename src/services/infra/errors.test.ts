import { describe, expect, it } from 'vitest';
import { createStructuredError, isStructuredError, toStructuredError } from './errors';

describe('createStructuredError', () => {
  it('fills defaults for optional fields', () => {
    const error = createStructuredError({
      code: 'INVALID_URL',
      category: 'validation',
      message: 'bad url'
    });

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeTruthy();
    expect(error.timestamp).toBeTypeOf('string');
  });

  it('captures the stack trace from a cause', () => {
    const cause = new Error('root cause');
    const error = createStructuredError({
      code: 'UNKNOWN_ERROR',
      category: 'process',
      message: 'wrapped',
      cause
    });
    expect(error.stackTrace).toContain('root cause');
  });
});

describe('toStructuredError', () => {
  it('passes an existing StructuredError through unchanged', () => {
    const original = createStructuredError({
      code: 'DISK_FULL',
      category: 'io',
      message: 'no space'
    });
    expect(toStructuredError(original)).toBe(original);
  });

  it('wraps a native Error using the provided fallback metadata', () => {
    const result = toStructuredError(new Error('boom'), {
      code: 'IPC_ERROR',
      category: 'ipc'
    });
    expect(result.code).toBe('IPC_ERROR');
    expect(result.category).toBe('ipc');
    expect(result.message).toBe('boom');
  });

  it('handles non-error throwables', () => {
    const result = toStructuredError('a string was thrown');
    expect(result.code).toBe('UNKNOWN_ERROR');
    expect(result.message).toBe('a string was thrown');
  });
});

describe('isStructuredError', () => {
  it('recognizes a valid structured error', () => {
    expect(
      isStructuredError(
        createStructuredError({ code: 'INVALID_URL', category: 'validation', message: 'x' })
      )
    ).toBe(true);
  });

  it('rejects arbitrary objects', () => {
    expect(isStructuredError({ foo: 'bar' })).toBe(false);
    expect(isStructuredError(undefined)).toBe(false);
  });
});
