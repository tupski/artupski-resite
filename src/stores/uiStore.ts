/**
 * UI store - Artupski ReSite
 *
 * Ephemeral chrome state (navigation, transient notices). Deliberately free of
 * business logic so feature stores can evolve independently.
 *
 * Phase 15 extends the notice model with an optional recovery `action`, an
 * optional `durationMs` (0 = sticky) and a bounded queue (oldest dropped) so the
 * toast region can render structured errors as actionable, non-blocking chrome.
 */
import { create } from 'zustand';
import type { StructuredError } from '../services/infra/errors';

/** A recovery affordance attached to a notice. */
export interface NoticeAction {
  label: string;
  kind: 'retry' | 'reload' | 'settings';
}

export interface Notice {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  message: string;
  /** Optional actionable label + handler kind (recovery affordance). */
  action?: NoticeAction;
  /** Auto-dismiss after this many ms; 0 = sticky. */
  durationMs?: number;
}

export interface UiState {
  /** Whether the primary sidebar navigation is expanded. */
  sidebarExpanded: boolean;
  notices: Notice[];
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
  /** Map a `StructuredError` into a danger notice with a recovery action. */
  pushErrorNotice: (error: StructuredError) => void;
}

/** Upper bound on simultaneously-visible notices; the oldest is dropped first. */
export const MAX_NOTICES = 5;

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Choose the most useful recovery affordance for a structured error without
 * ever inventing a handler the shell cannot honour:
 * - secret/IO and AI/validation failures point at Settings;
 * - retryable failures offer a retry;
 * - everything else falls back to a full reload.
 */
function actionForError(error: StructuredError): NoticeAction {
  if (
    error.code.startsWith('SECRET_') ||
    error.category === 'io' ||
    error.category === 'ai' ||
    error.category === 'validation'
  ) {
    return { label: 'Open settings', kind: 'settings' };
  }
  if (error.retryable) {
    return { label: 'Try again', kind: 'retry' };
  }
  return { label: 'Reload application', kind: 'reload' };
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  notices: [],
  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
  pushNotice: (notice) =>
    set((state) => ({
      // Bounded queue: append, then keep only the newest `MAX_NOTICES`.
      notices: [...state.notices, { ...notice, id: createId() }].slice(-MAX_NOTICES),
    })),
  dismissNotice: (id) =>
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  pushErrorNotice: (error) =>
    set((state) => ({
      notices: [
        ...state.notices,
        {
          id: createId(),
          tone: 'danger' as const,
          message: error.message,
          action: actionForError(error),
          // Actionable errors stay visible until acted on or dismissed.
          durationMs: 0,
        },
      ].slice(-MAX_NOTICES),
    })),
}));
