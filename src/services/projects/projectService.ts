/**
 * Project application service - Artupski ReSite
 *
 * The seam between UI state (stores/components) and persistence (repositories).
 * It owns cross-cutting decisions that should not live in either:
 *
 * - project storage directory naming,
 * - target URL validation before a record is written,
 * - translating storage-not-ready into a typed result the UI can render.
 *
 * Flow: store -> projectService -> repository -> SqliteDatabase -> StorageFile.
 */
import { validateTargetUrl } from '../../lib/url';
import type { Project } from '../../types/models';
import { toStructuredError, type StructuredError } from '../infra/errors';
import { storageService } from '../storage';
import { createStorageError } from '../storage/errors';

export type ProjectServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StructuredError };

export interface CreateProjectRequest {
  name: string;
  targetUrl: string;
}

/**
 * Resolve the per-project storage directory. Phase 2 stores only the path
 * string; directory creation/asset writes arrive with the scanner phases.
 */
function storagePathFor(projectId: string): string {
  return `AppData/Local/ArtupskiReSite/projects/${projectId}`;
}

function notReady(operation: string): StructuredError {
  return createStorageError('STORAGE_NOT_READY', {
    message: `Cannot ${operation}: local storage is not ready.`,
    details: { operation }
  });
}

async function run<T>(operation: string, fn: () => Promise<T>): Promise<ProjectServiceResult<T>> {
  try {
    if (storageService.getState() !== 'ready') {
      return { ok: false, error: notReady(operation) };
    }
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'STORAGE_WRITE_FAILED',
        category: 'database',
        message: `Failed to ${operation}.`,
        severity: 'error',
        recoverable: true,
        retryable: true
      })
    };
  }
}

export const projectService = {
  async listProjects(): Promise<ProjectServiceResult<Project[]>> {
    return run('load projects', () => storageService.getRepositories().projects.list());
  },

  async getProject(id: string): Promise<ProjectServiceResult<Project | null>> {
    return run('load the project', () => storageService.getRepositories().projects.getById(id));
  },

  async createProject(request: CreateProjectRequest): Promise<ProjectServiceResult<Project>> {
    const name = request.name.trim();
    if (name.length === 0) {
      return { ok: false, error: createStorageError('STORAGE_WRITE_FAILED', { message: 'Project name is required.' }) };
    }

    const validated = validateTargetUrl(request.targetUrl);
    if (!validated.valid) {
      return {
        ok: false,
        error: {
          ...createStorageError('STORAGE_WRITE_FAILED', { message: validated.message }),
          category: 'validation',
          code: 'INVALID_URL'
        }
      };
    }

    // Generate the id up front so the storage path and the row share it.
    const id = crypto.randomUUID();
    return run('create the project', () =>
      storageService.getRepositories().projects.create({
        id,
        name,
        targetUrl: validated.url,
        storagePath: storagePathFor(id)
      })
    );
  },

  async deleteProject(id: string): Promise<ProjectServiceResult<boolean>> {
    return run('delete the project', () => storageService.getRepositories().projects.delete(id));
  }
};
