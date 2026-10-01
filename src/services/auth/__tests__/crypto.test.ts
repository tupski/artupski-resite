import { describe, expect, it } from 'vitest';
import {
  createSalt,
  decryptSessionState,
  deriveSessionKey,
  encryptSessionState,
  redactSecrets
} from '../crypto';

const SEED = 'installation-seed-value';
const PLAINTEXT = JSON.stringify({
  cookies: [{ name: 'sid', value: 'super-secret-token', domain: 'app.example.com' }],
  origins: [{ origin: 'https://app.example.com', localStorage: { token: 'abc' } }]
});

describe('auth crypto', () => {
  it('round-trips a payload through encrypt -> decrypt', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(encrypted.authTag.length).toBeGreaterThan(0);

    const decrypted = await decryptSessionState({
      ...encrypted,
      installationSeed: SEED,
      projectSalt: salt
    });
    expect(decrypted).toBe(PLAINTEXT);
  });

  it('produces a fresh IV so identical plaintext yields different ciphertext', async () => {
    const salt = createSalt();
    const a = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    const b = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails closed when the ciphertext is tampered with', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    const tampered = {
      ...encrypted,
      // Flip the last Base64 char to corrupt the payload without changing length.
      ciphertext:
        encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.endsWith('A') ? 'B' : 'A') + '='
    };
    await expect(
      decryptSessionState({ ...tampered, installationSeed: SEED, projectSalt: salt })
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
  });

  it('fails closed when the seed or salt is wrong', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    await expect(
      decryptSessionState({ ...encrypted, installationSeed: 'wrong-seed', projectSalt: salt })
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    await expect(
      decryptSessionState({ ...encrypted, installationSeed: SEED, projectSalt: 'other-salt' })
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
  });

  it('derives a usable key from the seed and salt', async () => {
    const key = await deriveSessionKey(SEED, createSalt());
    expect(key.type).toBe('secret');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('rejects an empty installation seed', async () => {
    await expect(deriveSessionKey('', 'salt')).rejects.toMatchObject({
      code: 'STORAGE_WRITE_FAILED'
    });
  });

  it('fails closed on malformed Base64 in the envelope', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    // 'not*base64!' is not decodable by atob and must not silently succeed.
    await expect(
      decryptSessionState({
        ...encrypted,
        ciphertext: 'not*base64!',
        installationSeed: SEED,
        projectSalt: salt
      })
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
  });

  it('fails closed when the authentication tag is truncated', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    await expect(
      decryptSessionState({
        ...encrypted,
        authTag: encrypted.authTag.slice(0, 4),
        installationSeed: SEED,
        projectSalt: salt
      })
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
  });

  it('never embeds the plaintext secret in the ciphertext', async () => {
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: PLAINTEXT,
      installationSeed: SEED,
      projectSalt: salt
    });
    expect(encrypted.ciphertext).not.toContain('super-secret-token');
    expect(encrypted.iv).not.toBe(encrypted.authTag);
  });
});

describe('redactSecrets', () => {
  it('redacts cookie, token, and authorization fields recursively', () => {
    const input = {
      url: 'https://app.example.com',
      cookie: 'sid=secret',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      nested: { sessionToken: 'xyz', safe: 1 }
    };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.url).toBe('https://app.example.com');
    expect(out.cookie).toBe('[redacted]');
    const headers = out.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe('[redacted]');
    expect(headers['Content-Type']).toBe('application/json');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.sessionToken).toBe('[redacted]');
    expect(nested.safe).toBe(1);
  });

  it('handles arrays', () => {
    const out = redactSecrets([{ password: 'p' }, { ok: true }]) as Array<Record<string, unknown>>;
    expect(out[0]!.password).toBe('[redacted]');
    expect(out[1]!.ok).toBe(true);
  });
});
