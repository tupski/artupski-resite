/**
 * Authentication store - Artupski ReSite
 *
 * Honest, service-backed state for authenticated scanning. It holds NO secret:
 * only the non-sensitive metadata of the active session (target domain, capture
 * time, cookie/origin counts, expiry) read from the database, plus the user's
 * choice to run the next scan authenticated.
 *
 * It also owns the *capture UI state machine* for the headed interactive
 * capture window (AUTH-SCANNING.md section 2.1):
 *
 *   idle -> launching -> awaiting_login -> capturing -> saved
 *                          |                 |
 *                          +---- cancel ---- +---- error
 *
 * The store never fabricates success: `saved` is entered only when the service
 * reports a persisted session. Cancellation and failure close the window and
 * return to a truthful state. No cookie/token ever enters this store.
 */
import { create } from 'zustand';
import {
  beginInteractiveCapture,
  cancelInteractiveCapture,
  clearSession as clearSessionService,
  completeInteractiveCapture,
  getSessionMetadata
} from '../services/auth/authSessionService';
import type { AuthSessionMetadata, ScanAuthMode } from '../services/auth/types';

/** Lifecycle of the headed interactive capture window. */
export type CaptureStatus =
  'idle' | 'launching' | 'awaiting_login' | 'capturing' | 'saved' | 'error';

export interface AuthState {
  mode: ScanAuthMode;
  /** Active session metadata for the selected project, or null. */
  session: AuthSessionMetadata | null;
  busy: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
  /** Capture-window lifecycle, driven only by real service calls. */
  captureStatus: CaptureStatus;
  /** Opaque id of the open capture window, or null. Never a secret. */
  captureSessionId: string | null;
  setMode: (mode: ScanAuthMode) => void;
  setError: (error: AuthState['error']) => void;
  /** Reload the active session for a project (source of truth: the DB). */
  refresh: (projectId: string | null) => Promise<void>;
  /** Cryptographically delete the project's session. */
  clear: (projectId: string | null) => Promise<void>;
  /** Open the headed capture window for the target URL. */
  startCapture: (projectId: string | null, targetUrl: string) => Promise<void>;
  /** Capture + persist the session, then close the window. */
  completeCapture: (projectId: string | null, targetUrl: string) => Promise<void>;
  /** Close the window without persisting. Idempotent. */
  cancelCapture: () => Promise<void>;
  /** Test-only reset. */
  reset: () => void;
}

const NO_PROJECT_ERROR: AuthState['error'] = {
  code: 'STORAGE_NOT_READY',
  message: 'Select or create a project before capturing a session.',
  suggestedAction: 'Enter the target URL so its project resolves, then retry.'
};

export const useAuthStore = create<AuthState>((set) => ({
  mode: 'none',
  session: null,
  busy: false,
  error: null,
  captureStatus: 'idle',
  captureSessionId: null,

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

  startCapture: async (projectId, targetUrl) => {
    if (!projectId) {
      set({ error: NO_PROJECT_ERROR, captureStatus: 'error' });
      return;
    }
    set({
      captureStatus: 'launching',
      captureSessionId: null,
      error: null,
      busy: true
    });
    try {
      const result = await beginInteractiveCapture({ targetUrl });
      if (!result.ok) {
        set({ captureStatus: 'error', busy: false, error: result.error });
        return;
      }
      // The window is open and waiting for the human. This is not success.
      set({
        captureStatus: 'awaiting_login',
        captureSessionId: result.data.sessionId,
        busy: false,
        error: null
      });
    } catch {
      set({
        captureStatus: 'error',
        busy: false,
        error: {
          code: 'PLAYWRIGHT_CRASHED',
          message: 'Could not open the capture window.',
          suggestedAction: 'Retry; if it recurs, restart the application.'
        }
      });
    }
  },

  completeCapture: async (projectId, targetUrl) => {
    if (!projectId) {
      set({ error: NO_PROJECT_ERROR, captureStatus: 'error' });
      return;
    }
    set({ captureStatus: 'capturing', busy: true, error: null });
    try {
      const result = await completeInteractiveCapture({ projectId, targetUrl });
      if (!result.ok) {
        set({ captureStatus: 'error', busy: false, captureSessionId: null, error: result.error });
        return;
      }
      // Success is real only now: the session is persisted.
      set({
        captureStatus: 'saved',
        captureSessionId: null,
        busy: false,
        error: null,
        session: result.data,
        mode: 'session'
      });
    } catch {
      set({
        captureStatus: 'error',
        captureSessionId: null,
        busy: false,
        error: {
          code: 'STORAGE_WRITE_FAILED',
          message: 'Could not capture and store the session.',
          suggestedAction: 'Retry the capture.'
        }
      });
    }
  },

  cancelCapture: async () => {
    // Clear local state first so the UI cannot show a live window after cancel,
    // then ask the service to close any window it knows about. Idempotent.
    set({
      captureStatus: 'idle',
      captureSessionId: null,
      busy: false,
      error: null
    });
    await cancelInteractiveCapture();
  },

  reset: () =>
    set({
      mode: 'none',
      session: null,
      busy: false,
      error: null,
      captureStatus: 'idle',
      captureSessionId: null
    })
}));
