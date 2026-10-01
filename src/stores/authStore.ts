/**
 * Authentication store - Artupski ReSite
 *
 * Honest, service-backed state for authenticated scanning. It holds NO secret:
 * only the non-sensitive metadata of the active session (target domain, capture
 * time, cookie/origin counts, expiry) read from the database, plus the user's
 * choice to run the next scan authenticated.
 *
 * A session is considered "ready" only when the persisted metadata says so;
 * the store never fabricates a successful authentication state. If the
 * interactive capture window is unavailable (a documented limitation), the UI
 * reflects that plainly rather than pretending a session exists.
 */
import { create } from 'zustand';
import {
  clearSession as clearSessionService,
  getSessionMetadata
} from '../services/auth/authSessionService';
import type { AuthSessionMetadata, ScanAuthMode } from '../services/auth/types';

export interface AuthState {
  mode: ScanAuthMode;
  /** Active session metadata for the selected project, or null. */
  session: AuthSessionMetadata | null;
  busy: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
  setMode: (mode: ScanAuthMode) => void;
  setError: (error: AuthState['error']) => void;
  /** Reload the active session for a project (source of truth: the DB). */
  refresh: (projectId: string | null) => Promise<void>;
  /** Cryptographically delete the project's session. */
  clear: (projectId: string | null) => Promise<void>;
  /** Test-only reset. */
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  mode: 'none',
  session: null,
  busy: false,
  error: null,

  setMode: (mode) => set({ mode }),
  setError: (error) => set({ error }),

  refresh: async (projectId) => {
    if (!projectId) {
      set({ session: null });
      return;
    }
    try {
      const session = await getSessionMetadata(projectId);
      set({ session, error: null });
    } catch {
      set({
        session: null,
        error: {
          code: 'STORAGE_READ_FAILED',
          message: 'Could not read the stored session.',
          suggestedAction: 'Retry; if the problem persists, check the application logs.'
        }
      });
    }
  },

  clear: async (projectId) => {
    if (!projectId) {
      return;
    }
    set({ busy: true, error: null });
    try {
      const result = await clearSessionService(projectId);
      if (!result.ok) {
        set({ busy: false, error: result.error });
        return;
      }
      set({ busy: false, session: null, mode: 'none' });
    } catch {
      set({
        busy: false,
        error: {
          code: 'STORAGE_WRITE_FAILED',
          message: 'Could not clear the stored session.',
          suggestedAction: 'Retry; if the problem persists, restart the application.'
        }
      });
    }
  },

  reset: () => set({ mode: 'none', session: null, busy: false, error: null })
}));
