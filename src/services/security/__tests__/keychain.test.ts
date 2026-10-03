import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The keychain service is tested against a mocked IPC boundary so no real OS
 * credential store is touched. `../../ipc` is the only boundary the service
 * uses; mocking it also keeps `@tauri-apps/api` out of the test.
 */
const mocks = vi.hoisted(() => ({
  secretAvailable: vi.fn(),
  secretGet: vi.fn(),
  secretSet: vi.fn(),
  secretDelete: vi.fn()
}));

vi.mock('../../ipc', () => ({
  secretAvailable: mocks.secretAvailable,
  secretGet: mocks.secretGet,
  secretSet: mocks.secretSet,
  secretDelete: mocks.secretDelete
}));

import { createStructuredError } from '../../infra/errors';
import { eventBus, type AppEvent } from '../../infra/eventBus';
import {
  deleteSecret,
  getSecret,
  isValidSecretAccount,
  secretAvailable,
  setSecret
} from '../keychain';

const SECRET_VALUE = 'sk-live-super-secret-value';

function structured(code: 'SECRET_STORAGE_UNAVAILABLE' | 'SECRET_READ_FAILED' | 'SECRET_WRITE_FAILED') {
  return createStructuredError({ code, category: 'io', message: `mapped ${code}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  eventBus.clear();
});

afterEach(() => {
  eventBus.clear();
});

describe('isValidSecretAccount', () => {
  it('accepts bounded lowercase slugs', () => {
    expect(isValidSecretAccount('openai')).toBe(true);
    expect(isValidSecretAccount('provider-1_x')).toBe(true);
    expect(isValidSecretAccount('a'.repeat(64))).toBe(true);
  });

  it('rejects empty, over-long, and disallowed characters', () => {
    expect(isValidSecretAccount('')).toBe(false);
    expect(isValidSecretAccount('a'.repeat(65))).toBe(false);
    expect(isValidSecretAccount('OpenAI')).toBe(false);
    expect(isValidSecretAccount('has space')).toBe(false);
    expect(isValidSecretAccount('a.b')).toBe(false);
    expect(isValidSecretAccount('a/b')).toBe(false);
    expect(isValidSecretAccount('héllo')).toBe(false);
  });
});

describe('secretAvailable', () => {
  it('returns the native availability flag', async () => {
    mocks.secretAvailable.mockResolvedValue({ ok: true, data: true });
    expect(await secretAvailable()).toBe(true);
  });

  it('fails closed to false on a transport failure', async () => {
    mocks.secretAvailable.mockResolvedValue({
      ok: false,
      error: structured('SECRET_STORAGE_UNAVAILABLE')
    });
    expect(await secretAvailable()).toBe(false);
  });
});

describe('getSecret', () => {
  it('returns the value on success', async () => {
    mocks.secretGet.mockResolvedValue({ ok: true, data: SECRET_VALUE });
    const result = await getSecret('openai');
    expect(result).toEqual({ ok: true, value: SECRET_VALUE });
  });

  it('returns null when no entry exists', async () => {
    mocks.secretGet.mockResolvedValue({ ok: true, data: null });
    expect(await getSecret('openai')).toEqual({ ok: true, value: null });
  });

  it('rejects an invalid account before invoking the native command', async () => {
    const result = await getSecret('BAD SLUG');
    expect(result.ok).toBe(false);
    expect(mocks.secretGet).not.toHaveBeenCalled();
  });

  it('maps an unavailable store to SECRET_STORAGE_UNAVAILABLE', async () => {
    mocks.secretGet.mockResolvedValue({
      ok: false,
      error: structured('SECRET_STORAGE_UNAVAILABLE')
    });
    const result = await getSecret('openai');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SECRET_STORAGE_UNAVAILABLE');
      expect(result.error.category).toBe('io');
    }
  });
});

describe('setSecret', () => {
  it('writes and emits security.key_stored without the value', async () => {
    mocks.secretSet.mockResolvedValue({ ok: true, data: undefined });
    const events: AppEvent[] = [];
    eventBus.on('security.key_stored', (event) => events.push(event));

    const result = await setSecret('openai', SECRET_VALUE);

    expect(result.ok).toBe(true);
    expect(mocks.secretSet).toHaveBeenCalledWith('openai', SECRET_VALUE);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ domain: 'security', providerId: 'openai' });
    expect(JSON.stringify(events[0]!.payload)).not.toContain(SECRET_VALUE);
  });

  it('fails closed and emits key_unavailable on a store failure', async () => {
    mocks.secretSet.mockResolvedValue({
      ok: false,
      error: structured('SECRET_STORAGE_UNAVAILABLE')
    });
    const events: AppEvent[] = [];
    eventBus.on('security.key_unavailable', (event) => events.push(event));

    const result = await setSecret('openai', SECRET_VALUE);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SECRET_STORAGE_UNAVAILABLE');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toContain(SECRET_VALUE);
  });

  it('rejects an invalid account without invoking the native command', async () => {
    const result = await setSecret('BAD', SECRET_VALUE);
    expect(result.ok).toBe(false);
    expect(mocks.secretSet).not.toHaveBeenCalled();
  });
});

describe('deleteSecret', () => {
  it('deletes and emits security.key_revoked', async () => {
    mocks.secretDelete.mockResolvedValue({ ok: true, data: undefined });
    const events: AppEvent[] = [];
    eventBus.on('security.key_revoked', (event) => events.push(event));

    const result = await deleteSecret('openai');

    expect(result.ok).toBe(true);
    expect(events[0]!.payload).toMatchObject({ domain: 'security', providerId: 'openai', removed: true });
  });

  it('reports an unavailable store as a failure', async () => {
    mocks.secretDelete.mockResolvedValue({
      ok: false,
      error: structured('SECRET_STORAGE_UNAVAILABLE')
    });
    const result = await deleteSecret('openai');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SECRET_STORAGE_UNAVAILABLE');
  });
});

describe('secret leakage', () => {
  it('never exposes the secret value in results, errors, or event payloads', async () => {
    const events: AppEvent[] = [];
    eventBus.on('security.key_stored', (event) => events.push(event));
    eventBus.on('security.key_unavailable', (event) => events.push(event));
    eventBus.on('security.key_revoked', (event) => events.push(event));

    mocks.secretGet.mockResolvedValue({ ok: true, data: SECRET_VALUE });
    mocks.secretSet.mockResolvedValue({ ok: true, data: undefined });
    mocks.secretDelete.mockResolvedValue({
      ok: false,
      error: structured('SECRET_WRITE_FAILED')
    });

    const read = await getSecret('openai');
    const write = await setSecret('openai', SECRET_VALUE);
    const remove = await deleteSecret('openai');

    // The value is returned only by the explicit read; it never appears in an
    // error or an emitted event payload.
    expect(read).toEqual({ ok: true, value: SECRET_VALUE });
    expect(JSON.stringify(write)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(remove)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(events)).not.toContain(SECRET_VALUE);
  });
});
