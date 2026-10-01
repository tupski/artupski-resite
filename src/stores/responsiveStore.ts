/**
 * Responsive capture store - Artupski ReSite
 *
 * Honest, read-only UI state for Phase 7 viewport captures. It loads the
 * persisted `responsive_captures` rows for a scan (source of truth: the
 * database) and exposes loading/empty/error states. It never fabricates a
 * screenshot or a breakpoint: if a scan has no captures, the gallery is empty.
 */
import { create } from 'zustand';
import { storageService } from '../services/storage';
import type { ResponsiveCapture } from '../types/models';

export interface ResponsiveState {
  captures: ResponsiveCapture[];
  loading: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
  /** Load captures for a scan (source of truth: the DB). */
  loadForScan: (scanId: string | null) => Promise<void>;
  clear: () => void;
  reset: () => void;
}

export const useResponsiveStore = create<ResponsiveState>((set) => ({
  captures: [],
  loading: false,
  error: null,

  loadForScan: async (scanId) => {
    if (!scanId) {
      set({ captures: [], loading: false, error: null });
      return;
    }
    if (storageService.getState() !== 'ready') {
      set({ captures: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const captures = await storageService.getRepositories().responsiveCaptures.listByScan(scanId);
      set({ captures, loading: false, error: null });
    } catch {
      set({
        captures: [],
        loading: false,
        error: {
          code: 'STORAGE_READ_FAILED',
          message: 'Could not read the viewport captures.',
          suggestedAction: 'Retry; if the problem persists, check the application logs.'
        }
      });
    }
  },

  clear: () => set({ captures: [], loading: false, error: null }),

  reset: () => set({ captures: [], loading: false, error: null })
}));
