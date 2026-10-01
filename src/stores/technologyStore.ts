/**
 * Technology detection store - Artupski ReSite
 *
 * Surfaces the persisted Phase 5 detections for a scan. The database is the
 * source of truth (`loadForScan` reads `scan_technologies`), and live
 * `technology.detected` events are mirrored for immediate feedback while a scan
 * finishes. No detection is ever fabricated: an empty list means none were
 * found, and a load failure is surfaced honestly rather than shown as "none".
 */
import { create } from 'zustand';
import type { ScanTechnology } from '../types/models';
import { storageService } from '../services/storage';
import { eventBus } from '../services/infra/eventBus';
import { logger } from '../services/infra/logger';

export interface TechnologyState {
  scanId: string | null;
  detections: ScanTechnology[];
  loading: boolean;
  error: string | null;
  /** True when the detection pass flagged truncated/incomplete evidence. */
  partial: boolean;
  /** Load persisted detections for a scan (source of truth). */
  loadForScan: (scanId: string) => Promise<void>;
  /** Attach live event mirroring for a scan; returns an unsubscribe. */
  watch: (scanId: string) => () => void;
  clear: () => void;
}

export const useTechnologyStore = create<TechnologyState>((set, get) => ({
  scanId: null,
  detections: [],
  loading: false,
  error: null,
  partial: false,

  loadForScan: async (scanId) => {
    set({ scanId, loading: true, error: null });
    if (storageService.getState() !== 'ready') {
      set({ loading: false, error: 'Local storage is not ready.' });
      return;
    }
    try {
      const detections = await storageService.getRepositories().technologies.listByScan(scanId);
      // Ignore a late response for a scan the store has already moved past.
      if (get().scanId !== scanId) {
        return;
      }
      set({ detections, loading: false, error: null });
    } catch (error) {
      logger.child('technology').warn('Failed to load detections', { scanId, error: String(error) });
      set({ loading: false, error: 'Detected technologies could not be loaded.' });
    }
  },

  watch: (scanId) => {
    const unsubDetected = eventBus.on('technology.detected', (event) => {
      const payload = event.payload as { scanId?: string };
      if (payload.scanId !== scanId) {
        return;
      }
      // The persisted rows are authoritative; refresh after each detection so
      // the list reflects exactly what was stored (never an event-only view).
      void get().loadForScan(scanId);
    });
    const unsubCompleted = eventBus.on('technology.scan_completed', (event) => {
      const payload = event.payload as { scanId?: string; partial?: boolean };
      if (payload.scanId !== scanId) {
        return;
      }
      set({ partial: payload.partial === true });
      void get().loadForScan(scanId);
    });
    return () => {
      unsubDetected();
      unsubCompleted();
    };
  },

  clear: () => set({ scanId: null, detections: [], loading: false, error: null, partial: false }),
}));
