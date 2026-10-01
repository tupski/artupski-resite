/**
 * Projects store - Artupski ReSite
 *
 * Holds transient UI state for the Projects view (load status, error, busy
 * flags, selection) and delegates all persistence to `projectService`. It never
 * touches SQL or the storage driver, and it never fabricates records - the list
 * mirrors whatever the database returns.
 */
import { create } from 'zustand';
import type { Project } from '../types/models';
import type { StructuredError } from '../services/infra/errors';
import { storageService } from '../services/storage';
import { createStorageError } from '../services/storage/errors';
import { projectService, type CreateProjectRequest } from '../services/projects/projectService';

/** How long to wait for storage initialization before surfacing the failure. */
const STORAGE_READY_TIMEOUT_MS = 10_000;

function notReadyError(): StructuredError {
  return createStorageError('STORAGE_NOT_READY', {
    message: 'Cannot load projects: local storage is not ready.'
  });
}

/**
 * Resolve once storage is `ready`, or `false` if it errored/timed out.
 * Used so the Projects view waits out startup instead of rendering a stale
 * not-ready error that the user would have to clear by hand.
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

export type ProjectsLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectsState {
  projects: Project[];
  status: ProjectsLoadStatus;
  error: StructuredError | null;
  /** True while a create/delete mutation is in flight. */
  mutating: boolean;
  selectedProjectId: string | null;
  loadProjects: () => Promise<void>;
  createProject: (request: CreateProjectRequest) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  selectProject: (id: string | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  projects: [] as Project[],
  status: 'idle' as ProjectsLoadStatus,
  error: null as StructuredError | null,
  mutating: false,
  selectedProjectId: null as string | null
};

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  ...INITIAL_STATE,

  loadProjects: async () => {
    set({ status: 'loading', error: null });

    // Storage initializes asynchronously at app startup. If this view mounts
    // first, wait out the in-flight initialization rather than showing a stale
    // "not ready" error the user would have to dismiss manually. If storage was
    // never started (or already failed), fail fast instead of waiting.
    const current = storageService.getState();
    if (current === 'initializing') {
      const settled = await waitForStorageSettled();
      if (!settled) {
        set({ projects: [], status: 'error', error: notReadyError() });
        return;
      }
    } else if (current !== 'ready') {
      set({ projects: [], status: 'error', error: notReadyError() });
      return;
    }

    const result = await projectService.listProjects();
    if (result.ok) {
      set({ projects: result.data, status: 'ready', error: null });
      return;
    }
    set({ projects: [], status: 'error', error: result.error });
  },

  createProject: async (request) => {
    set({ mutating: true });
    const result = await projectService.createProject(request);
    if (!result.ok) {
      set({ mutating: false });
      return false;
    }
    // Re-read so ordering and server-defaulted timestamps stay authoritative.
    const list = await projectService.listProjects();
    set({
      mutating: false,
      ...(list.ok ? { projects: list.data, status: 'ready' as const } : {})
    });
    return true;
  },

  deleteProject: async (id) => {
    set({ mutating: true });
    const result = await projectService.deleteProject(id);
    if (!result.ok) {
      set({ mutating: false });
      return false;
    }
    const remaining = get().projects.filter((project) => project.id !== id);
    set({
      mutating: false,
      projects: remaining,
      selectedProjectId: get().selectedProjectId === id ? null : get().selectedProjectId
    });
    return true;
  },

  selectProject: (selectedProjectId) => set({ selectedProjectId }),

  reset: () => set({ ...INITIAL_STATE })
}));
