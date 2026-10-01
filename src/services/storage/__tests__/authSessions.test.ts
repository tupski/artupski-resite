import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStorage, type TestStorage } from './helpers';
import type { CreateAuthSessionInput } from '../types';

function sessionInput(
  projectId: string,
  overrides: Partial<CreateAuthSessionInput> = {}
): CreateAuthSessionInput {
  return {
    projectId,
    authType: 'interactive',
    sessionName: 'app.example.com',
    targetDomain: 'app.example.com',
    ciphertext: 'Y2lwaGVy',
    iv: 'aXZpdml2aXZpdg==',
    authTag: 'dGFnZGFnZGFnZGFnZGFnZGFnZGFn',
    salt: 'c2FsdA==',
    cookieCount: 3,
    originCount: 1,
    expiresAt: null,
    ...overrides
  };
}

describe('migration 004 (auth_sessions)', () => {
  it('creates the table with its indexes', async () => {
    const storage = await createTestStorage();
    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions';"
    );
    expect(tables).toHaveLength(1);

    const indexes = storage.db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'auth_sessions';"
      )
      .map((row) => row.name);
    expect(indexes).toContain('idx_auth_sessions_project_id');
    expect(indexes).toContain('idx_auth_sessions_project_active');
    await storage.close();
  });
});

describe('AuthSessionRepository', () => {
  let storage: TestStorage;
  let projectId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Auth',
      targetUrl: 'https://app.example.com',
      storagePath: '/a'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('persists a session and reads it back without exposing plaintext', async () => {
    const saved = await storage.authSessions.saveSession(sessionInput(projectId));
    expect(saved.isActive).toBe(true);
    expect(saved.ciphertext).toBe('Y2lwaGVy');
    expect(saved.targetDomain).toBe('app.example.com');

    const active = await storage.authSessions.findActive(projectId);
    expect(active?.id).toBe(saved.id);
  });

  it('keeps at most one active session per project (replaces on save)', async () => {
    const first = await storage.authSessions.saveSession(sessionInput(projectId));
    const second = await storage.authSessions.saveSession(
      sessionInput(projectId, { sessionName: 'second' })
    );

    const all = await storage.authSessions.listByProject(projectId);
    expect(all).toHaveLength(2);
    const active = await storage.authSessions.findActive(projectId);
    expect(active?.id).toBe(second.id);
    expect((await storage.authSessions.getById(first.id))?.isActive).toBe(false);
  });

  it("never returns another project's session", async () => {
    const other = await storage.projects.create({
      name: 'Other',
      targetUrl: 'https://other.example.com',
      storagePath: '/o'
    });
    await storage.authSessions.saveSession(
      sessionInput(other.id, { targetDomain: 'other.example.com' })
    );
    expect(await storage.authSessions.findActive(projectId)).toBeNull();
  });

  it('purges expired sessions and reports expiry', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await storage.authSessions.saveSession(sessionInput(projectId, { expiresAt: past }));

    const purged = await storage.authSessions.purgeExpired();
    expect(purged).toBe(1);
    expect(await storage.authSessions.findActive(projectId)).toBeNull();
  });

  it('does not purge a future-dated session', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const saved = await storage.authSessions.saveSession(
      sessionInput(projectId, { expiresAt: future })
    );
    expect(await storage.authSessions.purgeExpired()).toBe(0);
    expect(await storage.authSessions.findActive(projectId)).not.toBeNull();
    expect(storage.authSessions.isExpired(saved)).toBe(false);
  });

  it('deletes all sessions for a project (cryptographic deletion)', async () => {
    await storage.authSessions.saveSession(sessionInput(projectId));
    const removed = await storage.authSessions.deleteByProject(projectId);
    expect(removed).toBe(1);
    expect(await storage.authSessions.findActive(projectId)).toBeNull();
  });

  it('cascades session deletion when the project is deleted', async () => {
    await storage.authSessions.saveSession(sessionInput(projectId));
    await storage.projects.delete(projectId);
    expect(await storage.authSessions.listByProject(projectId)).toHaveLength(0);
  });

  it('survives a database reopen', async () => {
    await storage.authSessions.saveSession(sessionInput(projectId));
    const reopened = await storage.reopen();
    const active = await reopened.authSessions.findActive(projectId);
    expect(active?.targetDomain).toBe('app.example.com');
    await reopened.close();
  });
});
