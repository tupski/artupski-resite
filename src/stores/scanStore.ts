/**
 * Scan store - Artupski ReSite
 *
 * Models the scan lifecycle defined in UI-SPEC section 4. Phase 1 has NO
 * scanner: this store only holds configuration/input state and provides the
 * lifecycle shape future scanner phases will drive. It never fakes progress.
 */
import { create } from 'zustand';
import type { ScanLogEntry, ScanLogLevel, ScanStatus } from '../types/scan';

/** Sliding window keeps memory bounded for the future live console. */
const MAX_LOG_ENTRIES = 1000;

export interface ScanConfiguration {
  maxDepth: number;
  maxPages: number;
  headless: boolean;
  viewports: {
    desktop: boolean;
    tablet: boolean;
    mobile: boolean;
  };
}

export interface ScanState {
  targetUrl: string;
  projectTitle: string;
  status: ScanStatus;
  activePhase: string;
  progressPercent: number;
  logs: ScanLogEntry[];
  discoveredPages: string[];
  configuration: ScanConfiguration;
  setTargetUrl: (url: string) => void;
  setProjectTitle: (title: string) => void;
  setStatus: (status: ScanStatus) => void;
  updateConfiguration: (patch: Partial<ScanConfiguration>) => void;
  appendLog: (level: ScanLogLevel, message: string) => void;
  resetScan: () => void;
}

export const DEFAULT_SCAN_CONFIGURATION: ScanConfiguration = {
  maxDepth: 2,
  maxPages: 25,
  headless: true,
  viewports: {
    desktop: true,
    tablet: false,
    mobile: false,
  },
};

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useScanStore = create<ScanState>((set) => ({
  targetUrl: '',
  projectTitle: '',
  status: 'idle',
  activePhase: '',
  progressPercent: 0,
  logs: [],
  discoveredPages: [],
  configuration: DEFAULT_SCAN_CONFIGURATION,
  setTargetUrl: (targetUrl) => set({ targetUrl }),
  setProjectTitle: (projectTitle) => set({ projectTitle }),
  setStatus: (status) => set({ status }),
  updateConfiguration: (patch) =>
    set((state) => ({
      configuration: {
        ...state.configuration,
        ...patch,
        viewports: {
          ...state.configuration.viewports,
          ...(patch.viewports ?? {}),
        },
      },
    })),
  appendLog: (level, message) =>
    set((state) => ({
      logs: [
        ...state.logs.slice(-(MAX_LOG_ENTRIES - 1)),
        { id: createId(), timestamp: new Date().toISOString(), level, message },
      ],
    })),
  resetScan: () =>
    set({
      status: 'idle',
      activePhase: '',
      progressPercent: 0,
      logs: [],
      discoveredPages: [],
    }),
}));
