/**
 * Project detail store - Artupski ReSite
 *
 * Read-only UI state for a single persisted project's review view. It resolves
 * the project and its scan history, then exposes the crawled pages for the
 * selected scan. Everything is read from the database (the source of truth) -
 * nothing is fabricated, and a project with no scans simply reports an empty
 * history rather than inventing one.
 *
 * The heavier per-scan datasets (technologies, responsive captures, clone
 * assets, Blueprint) are loaded by their own existing stores, exactly as the
 * Scan screen does, so this store stays small and focused.
 */
import { create } from 'zustand';
import type { Project, Scan, ScanPage } from '../types/models';
import type { StructuredError } from '../services/infra/errors';
import { storageService } from '../services/storage';
import { createStorageError } from '../services/storage/errors';
import { projectService } from '../services/projects/projectService';

/** How long to wait for storage initialization before surfacing the failure. */
const STORAGE_READY_TIMEOUT_MS = 10_000;

function notReadyError(): StructuredError {
  return createStorageError('STORAGE_NOT_READY', {
    message: 'Cannot load the project: local storage is not ready.'
  });
}

/**
 * Resolve once storage is `ready`, or `false` if it errored/timed out. Mirrors
 * the Projects list so the detail view waits out startup instead of rendering a
 * stale not-ready error the user would have to clear by hand.
 */
function waitForStorageSettled(): Promise<boolean> {
  return new Promise((resolve) => {
    if (storageService.getState() === 'ready') {
      resolve(true);
      return;
    }
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(storageService.getState() === 'ready');
    }, STORAGE_READY_TIMEOUT_MS);
    const unsubscribe = storageService.onStateChange((state) => {
      if (state === 'ready' || state === 'error') {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state === 'ready');
      }
    });
  });
}

/**
 * Honest lifecycle of the loaded project:
 *   idle      - nothing loaded yet
 *   loading   - the project/scan history is being read
 *   ready     - the project exists (its scan history may still be empty)
 *   not_found - no project exists for the requested id
 *   error     - the read itself failed (storage not ready, etc.)
 */
export type ProjectDetailStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';

export interface ProjectDetailState {
  projectId: string | null;
  status: ProjectDetailStatus;
  error: StructuredError | null;
  project: Project | null;
  /** Scan history for the project, newest first (the repository's order). */
  scans: Scan[];
  /** The scan whose pages are currently shown, or null when there are none. */
  activeScanId: string | null;
  pages: ScanPage[];
  pagesLoading: boolean;
  pagesError: string | null;
  /** Load a project + its scan history, then the newest scan's pages. */
  load: (projectId: string) => Promise<void>;
  /** Switch the pages view to another scan in the history. */
  selectScan: (scanId: string) => Promise<void>;
  loadPages: (scanId: string) => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE = {
  projectId: null as string | null,
  status: 'idle' as ProjectDetailStatus,
  error: null as StructuredError | null,
  project: null as Project | null,
  scans: [] as Scan[],
  activeScanId: null as string | null,
  pages: [] as ScanPage[],
  pagesLoading: false,
  pagesError: null as string | null
};

export const useProjectDetailStore = create<ProjectDetailState>((set, get) => ({
  ...INITIAL_STATE,

  load: async (projectId) => {
    set({ ...INITIAL_STATE, projectId, status: 'loading' });

    const current = storageService.getState();
    if (current === 'initializing') {
      const settled = await waitForStorageSettled();
      if (!settled) {
        set({ status: 'error', error: notReadyError() });
        return;
      }
    } else if (current !== 'ready') {
      set({ status: 'error', error: notReadyError() });
      return;
    }

    const result = await projectService.getProject(projectId);
    // Ignore a late response for a project the store has already moved past.
    if (get().projectId !== projectId) {
      return;
    }
    if (!result.ok) {
      set({ status: 'error', error: result.error });
      return;
    }
    if (!result.data) {
      set({ status: 'not_found', project: null, scans: [], activeScanId: null });
      return;
    }

    let scans: Scan[] = [];
    try {
      scans = await storageService.getRepositories().scans.listByProject(projectId);
    } catch (error) {
      set({
        status: 'error',
        error: createStorageError('STORAGE_READ_FAILED', {
          message: 'The project was loaded, but its scan history could not be read.',
          cause: error
        })
      });
      return;
    }
    if (get().projectId !== projectId) {
      return;
    }

    const activeScanId = scans[0]?.id ?? null;
    set({ project: result.data, scans, activeScanId, status: 'ready' });
    if (activeScanId) {
      await get().loadPages(activeScanId);
    }
  },

  selectScan: async (scanId) => {
    if (get().activeScanId === scanId) {
      return;
    }
    set({ activeScanId: scanId });
    await get().loadPages(scanId);
  },

  loadPages: async (scanId) => {
    set({ pages: [], pagesLoading: true, pagesError: null });
    if (storageService.getState() !== 'ready') {
      set({ pagesLoading: false, pagesError: 'Local storage is not ready.' });
      return;
    }
    try {
      const pages = await storageService.getRepositories().pages.listByScan(scanId);
      // Ignore a late response for a scan the store has already moved past.
      if (get().activeScanId !== scanId) {
        return;
      }
      set({ pages, pagesLoading: false, pagesError: null });
    } catch {
      set({ pagesLoading: false, pagesError: 'The crawled pages could not be loaded.' });
    }
  },

  reset: () => set({ ...INITIAL_STATE })
}));
