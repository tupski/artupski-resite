/**
 * UI store - Artupski ReSite
 *
 * Ephemeral chrome state (navigation, transient notices). Deliberately free of
 * business logic so feature stores can evolve independently.
 */
import { create } from 'zustand';

export interface Notice {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  message: string;
}

export interface UiState {
  /** Whether the primary sidebar navigation is expanded. */
  sidebarExpanded: boolean;
  notices: Notice[];
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  notices: [],
  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
  pushNotice: (notice) =>
    set((state) => ({
      notices: [...state.notices, { ...notice, id: createId() }],
    })),
  dismissNotice: (id) =>
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
}));
