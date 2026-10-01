import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../../storage';
import {
  captureSession,
  clearSession,
  getSessionMetadata,
  hasActiveSession,
  loadSessionForScan
} from '../authSessionService';
import type { CapturedStorageState } from '../types';

const TARGET = 'https://app.example.com/dashboard';

function state(overrides: Partial<CapturedStorageState> = {}): CapturedStorageState {
  return {
    cookies: [
      {
        name: 'sid',
        value: 'super-secret-token',
        domain: 'app.example.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }
    ],
    origins: [
      {
        origin: 'https://app.example.com',
        localStorage: { authToken: 'abc123' },
        sessionStorage: {}
      }
    ],
    ...overrides
  };
}

describe('authSessionService', () => {
  let projectId: string;

  beforeEach(async () => {
    await storageService.initialize();
    const project = await storageService.getRepositories().projects.create({
      name: 'App',
      targetUrl: TARGET,
      storagePath: '/app'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storageService.resetForTests();
  });

  it('captures, persists, and reloads a session (round trip)', async () => {
    const captured = await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.data.cookieCount).toBe(1);
    expect(await hasActiveSession(projectId)).toBe(true);

    const loaded = await loadSessionForScan(projectId, TARGET);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.cookies[0]?.value).toBe('super-secret-token');
    expect(loaded.data.origins[0]?.localStorage.authToken).toBe('abc123');
  });

  it('rejects an empty capture (login not completed)', async () => {
    const captured = await captureSession({
      projectId,
      targetUrl: TARGET,
      storageState: { cookies: [], origins: [] }
    });
    expect(captured.ok).toBe(false);
    if (captured.ok) return;
    expect(captured.error.code).toBe('LOGIN_FAILED');
  });

  it('refuses to load when no session exists', async () => {
    const loaded = await loadSessionForScan(projectId, TARGET);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe('LOGIN_FAILED');
  });

  it('refuses to reuse a session against a different domain', async () => {
    await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    const loaded = await loadSessionForScan(projectId, 'https://other.example.com/');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.message).toMatch(/captured for/i);
  });

  it('reports metadata without exposing ciphertext', async () => {
    await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    const metadata = await getSessionMetadata(projectId);
    expect(metadata?.targetDomain).toBe('app.example.com');
    expect(JSON.stringify(metadata)).not.toContain('super-secret-token');
    expect(metadata && 'ciphertext' in metadata).toBe(false);
  });

  it('clears the session cryptographically', async () => {
    await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    const cleared = await clearSession(projectId);
    expect(cleared.ok).toBe(true);
    expect(await hasActiveSession(projectId)).toBe(false);
    const loaded = await loadSessionForScan(projectId, TARGET);
    expect(loaded.ok).toBe(false);
  });

  it('does not persist the plaintext token anywhere in the database', async () => {
    await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    const row = storageService
      .getDatabase()
      .get<{ ciphertext: string; iv: string; auth_tag: string }>(
        'SELECT ciphertext, iv, auth_tag FROM auth_sessions LIMIT 1;'
      );
    expect(row).toBeTruthy();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('abc123');
  });

  it('purges an expired session before loading', async () => {
    await captureSession({ projectId, targetUrl: TARGET, storageState: state() });
    // Force the stored session into the past.
    storageService
      .getDatabase()
      .run("UPDATE auth_sessions SET expires_at = '2000-01-01 00:00:00' WHERE project_id = ?;", [
        projectId
      ]);
    const loaded = await loadSessionForScan(projectId, TARGET);
    expect(loaded.ok).toBe(false);
  });
});
