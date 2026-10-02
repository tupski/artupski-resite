/**
 * Clone service factory - Artupski ReSite
 *
 * Wires the `CloneService` to the real seams: the scanner worker client (which
 * speaks the extended protocol), the storage repositories (`scan_assets` +
 * `scan_pages`), and the sandboxed Rust clone file commands via `src/services/ipc`.
 * Kept separate so the service itself stays free of singletons and is trivially
 * unit-testable with fakes.
 */
import { storageService } from '../storage';
import { cloneWrite, cloneRead } from '../ipc';
import { toStructuredError } from '../infra/errors';
import type { CloneAssetType, ScanPage } from '../../types/models';
import {
  CloneService,
  type CloneFileIo,
  type ClonePersistence,
  type CloneWorker
} from './cloneService';
import type { ScannerWorkerClient } from '../scanner/scannerWorkerClient';

/** The `scan_assets.asset_type` CHECK domain, used to narrow worker output. */
const ASSET_TYPES: ReadonlySet<CloneAssetType> = new Set([
  'image',
  'stylesheet',
  'script',
  'font',
  'video',
  'audio',
  'document',
  'other'
]);

function toAssetType(value: string): CloneAssetType {
  return ASSET_TYPES.has(value as CloneAssetType) ? (value as CloneAssetType) : 'other';
}

/** Persistence adapter over the live storage repositories. */
export function createStorageClonePersistence(): ClonePersistence {
  return {
    async listPages(scanId: string): Promise<ScanPage[]> {
      return storageService.getRepositories().pages.listByScan(scanId);
    },
    async countAssets(scanId: string): Promise<number> {
      return storageService.getRepositories().assets.countByScan(scanId);
    },
    async upsertAssets(inputs): Promise<number> {
      return storageService.getRepositories().assets.upsertMany(
        inputs.map((input) => ({
          scanId: input.scanId,
          pageId: input.pageId,
          pageUrl: input.pageUrl,
          sourceUrl: input.sourceUrl,
          localPath: input.localPath,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          assetType: toAssetType(input.assetType)
        }))
      );
    }
  };
}

/** File I/O adapter over the sandboxed Rust clone commands. */
export function createIpcCloneFileIo(): CloneFileIo {
  return {
    async read(relative: string): Promise<Uint8Array | null> {
      const result = await cloneRead(relative);
      if (!result.ok) {
        return null;
      }
      return Uint8Array.from(result.data);
    },
    async write(relative: string, data: Uint8Array): Promise<boolean> {
      const result = await cloneWrite(relative, data);
      if (!result.ok) {
        toStructuredError(result.error);
        return false;
      }
      return true;
    }
  };
}

/** Adapt the scanner worker client to the clone worker port. */
export function createCloneWorker(worker: ScannerWorkerClient): CloneWorker {
  return {
    async extractRawHtml(sessionId, url, options) {
      const result = await worker.extractRawHtml(sessionId, url, options);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, data: { page: result.data.page, rawHtml: result.data.rawHtml } };
    },
    async captureAssets(sessionId, url, options) {
      const result = await worker.captureAssets(sessionId, url, options);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return {
        ok: true,
        data: {
          assets: result.data.assets,
          skipped: result.data.skipped,
          truncated: result.data.truncated,
          finalUrl: result.data.finalUrl
        }
      };
    }
  };
}

/** Build a fully wired clone service for the live application. */
export function createCloneService(worker: ScannerWorkerClient): CloneService {
  return new CloneService({
    worker: createCloneWorker(worker),
    persistence: createStorageClonePersistence(),
    io: createIpcCloneFileIo()
  });
}
