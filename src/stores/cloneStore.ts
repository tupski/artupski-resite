/**
 * Static clone store - Artupski ReSite
 *
 * Honest, read-only UI state for the Phase 8 static clone. It loads the
 * persisted `scan_assets` rows (source of truth: the database) for a scan and
 * mirrors the `clone.*` events for live refresh. It never fabricates a cloned
 * page or a preview URL: if a scan has no assets, the panel is empty.
 */
import { create } from 'zustand';
import { storageService } from '../services/storage';
import { cloneRoot } from '../services/ipc';
import { startLocalServer, stopLocalServer } from '../services/clone';
import type { CloneAsset } from '../types/models';
import type { CloneReport } from '../types/clone';

export interface CloneState {
  assets: CloneAsset[];
  loading: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
  /** The most recent run's honest report (null before any run this session). */
  lastReport: CloneReport | null;
  /** The running preview server URL, or null. */
  previewUrl: string | null;
  /** True while a preview start/stop is in flight. */
  previewBusy: boolean;
  /** Load persisted assets for a scan (source of truth: the DB). */
  loadForScan: (scanId: string | null) => Promise<void>;
  /** Record a completed run's report. */
  setReport: (report: CloneReport | null) => void;
  /** Record a run error (or clear it). */
  setError: (error: CloneState['error']) => void;
  /**
   * Start the local preview server for the sandboxed clone tree. The root is
   * resolved from Rust (`clone_root`); the UI never supplies a path.
   */
  openPreview: () => Promise<void>;
  /** Stop the local preview server. */
  closePreview: () => Promise<void>;
  clear: () => void;
  reset: () => void;
}

export const useCloneStore = create<CloneState>((set) => ({
  assets: [],
  loading: false,
  error: null,
  lastReport: null,
  previewUrl: null,
  previewBusy: false,

  loadForScan: async (scanId) => {
    if (!scanId) {
      set({ assets: [], loading: false, error: null });
      return;
    }
    if (storageService.getState() !== 'ready') {
      set({ assets: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const assets = await storageService.getRepositories().assets.listByScan(scanId);
      set({ assets, loading: false, error: null });
    } catch {
      set({
        assets: [],
        loading: false,
        error: {
          code: 'STORAGE_READ_FAILED',
          message: 'Could not read the clone assets.',
          suggestedAction: 'Retry; if the problem persists, check the application logs.'
        }
      });
    }
  },

  setReport: (report) => set({ lastReport: report }),

  setError: (error) => set({ error }),

  openPreview: async () => {
    set({ previewBusy: true, error: null });
    const rootResult = await cloneRoot();
    if (!rootResult.ok) {
      set({ previewBusy: false, previewUrl: null, error: rootResult.error });
      return;
    }
    const result = await startLocalServer(rootResult.data);
    if (!result.ok) {
      set({ previewBusy: false, previewUrl: null, error: result.error });
      return;
    }
    set({ previewBusy: false, previewUrl: result.data.url });
  },

  closePreview: async () => {
    set({ previewBusy: true });
    await stopLocalServer();
    set({ previewBusy: false, previewUrl: null });
  },

  clear: () => set({ assets: [], loading: false, error: null, lastReport: null, previewUrl: null }),

  reset: () =>
    set({
      assets: [],
      loading: false,
      error: null,
      lastReport: null,
      previewUrl: null,
      previewBusy: false
    })
}));
