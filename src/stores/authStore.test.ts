import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './authStore';
import { storageService } from '../services/storage';
import { captureSession, type AuthServiceResult } from '../services/auth';

const TARGET = 'https://app.example.com/dashboard';

describe('authStore', () => {
  let projectId: string;

  beforeEach(async () => {
    useAuthStore.getState().reset();
    await storageService.initialize();
    const project = await storageService.getRepositories().projects.create({
      name: 'App',
      targetUrl: TARGET,
      storagePath: '/app'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    useAuthStore.getState().reset();
    await storageService.resetForTests();
  });

  it('starts with no session and mode "none"', () => {
    const state = useAuthStore.getState();
    expect(state.mode).toBe('none');
    expect(state.session).toBeNull();
  });

  it('refresh reads the persisted session (never fabricates one)', async () => {
    await useAuthStore.getState().refresh(projectId);
    expect(useAuthStore.getState().session).toBeNull();

    const captured: AuthServiceResult<unknown> = await captureSession({
      projectId,
      targetUrl: TARGET,
      storageState: {
        cookies: [
          {
            name: 'sid',
            value: 'v',
            domain: 'app.example.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          }
        ],
        origins: []
      }
    });
    expect(captured.ok).toBe(true);

    await useAuthStore.getState().refresh(projectId);
    const session = useAuthStore.getState().session;
    expect(session?.targetDomain).toBe('app.example.com');
    expect(session && 'ciphertext' in session).toBe(false);
  });

  it('clear removes the session and resets the mode', async () => {
    await captureSession({
      projectId,
      targetUrl: TARGET,
      storageState: {
        cookies: [
          {
            name: 'sid',
            value: 'v',
            domain: 'app.example.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          }
        ],
        origins: []
      }
    });
    await useAuthStore.getState().refresh(projectId);
    useAuthStore.getState().setMode('session');

    await useAuthStore.getState().clear(projectId);
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().mode).toBe('none');
  });

  it('refresh with a null project clears any cached session', async () => {
    useAuthStore.setState({ session: { id: 'x' } as never });
    await useAuthStore.getState().refresh(null);
    expect(useAuthStore.getState().session).toBeNull();
  });
});
