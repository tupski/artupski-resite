/**
 * Static clone service - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md and
 * docs/impl-plan/phase-8-impl-plan.md.
 *
 * The orchestration seam: it composes the pure clone modules, the extended
 * worker protocol (`extract` raw HTML + `captureAssets`), the sandboxed clone
 * file I/O, and the `AssetRepository` into one honest clone run. It owns no URL
 * policy, no DOM extraction, and no SQL of its own.
 *
 * Honesty: a page whose HTML cannot be captured is SKIPPED and counted; no clone
 * output is ever synthesized from metadata. Asset bytes live on disk; only
 * metadata + the local path are persisted.
 *
 * The worker + I/O + persistence seams are injectable so the service is unit
 * tested with fakes and never needs a real browser or Tauri shell.
 */
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import { logger, type Logger } from '../infra/logger';
import { toStructuredError, type StructuredError } from '../infra/errors';
import type { NormalizedPage, RawHtmlCapture } from '../infra/workerProtocol';
import type { ScanPage } from '../../types/models';
import type {
  CloneManifest,
  CloneManifestAsset,
  CloneManifestRoute,
  CloneReport,
  AssetMap,
  RouteMap
} from '../../types/clone';
import { assetPathFor, isSafeRelativePath, pagePathForUrl } from './clonePaths';
import { rewriteHtml } from './htmlRewriter';
import { rewriteCss } from './cssRewriter';
import { MOCK_CLIENT_JS } from './mockClient';
import { buildManifest, serializeManifest } from './manifest';

/** A captured asset returned by the worker `captureAssets` command. */
export interface CapturedAssetLike {
  sourceUrl: string;
  mimeType: string;
  assetType: string;
  sizeBytes: number;
  sha256: string;
  base64: string;
}

/** The worker/runtime seam this service depends on (injectable for tests). */
export interface CloneWorker {
  extractRawHtml(
    sessionId: string,
    url: string,
    options?: { timeoutMs?: number }
  ): Promise<
    | { ok: true; data: { page: NormalizedPage; rawHtml?: RawHtmlCapture } }
    | { ok: false; error: StructuredError }
  >;
  captureAssets(
    sessionId: string,
    url: string,
    options?: { timeoutMs?: number; maxAssets?: number; maxAssetBytes?: number }
  ): Promise<
    | {
        ok: true;
        data: {
          assets: CapturedAssetLike[];
          skipped: number;
          truncated: boolean;
          finalUrl: string;
        };
      }
    | { ok: false; error: StructuredError }
  >;
}

/** Persistence seam (implemented over `AssetRepository` + `ScanPageRepository`). */
export interface ClonePersistence {
  listPages(scanId: string): Promise<ScanPage[]>;
  countAssets(scanId: string): Promise<number>;
  upsertAssets(
    inputs: Array<{
      scanId: string;
      pageId: string | null;
      pageUrl: string | null;
      sourceUrl: string;
      localPath: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      assetType: string;
    }>
  ): Promise<number>;
}

/** Sandboxed clone-tree file I/O seam (implemented over the Rust clone commands). */
export interface CloneFileIo {
  /** Read a previously written clone file as bytes. */
  read(relative: string): Promise<Uint8Array | null>;
  /** Write bytes to a relative path inside the clone tree. */
  write(relative: string, data: Uint8Array): Promise<boolean>;
}

export interface CloneRequest {
  scanId: string;
  projectId: string;
  sessionId: string;
  /** The origin used to build the route map (from the seed URL). */
  sourceOrigin: string;
  /** Maximum pages to clone in this run (bounds the pass). */
  maxPages?: number;
}

export interface CloneResult {
  ok: boolean;
  report?: CloneReport;
  manifest?: CloneManifest;
  error?: StructuredError;
}

export interface CloneServiceDeps {
  worker: CloneWorker;
  persistence: ClonePersistence;
  io: CloneFileIo;
  events?: { emit(event: AppEvent): void };
  logger?: Logger;
  now?: () => string;
}

/** Default bound on pages cloned per run. */
export const DEFAULT_CLONE_MAX_PAGES = 50;

export class CloneService {
  private readonly worker: CloneWorker;
  private readonly persistence: ClonePersistence;
  private readonly io: CloneFileIo;
  private readonly events: { emit(event: AppEvent): void };
  private readonly log: Logger;
  private readonly now: () => string;

  constructor(deps: CloneServiceDeps) {
    this.worker = deps.worker;
    this.persistence = deps.persistence;
    this.io = deps.io;
    this.events = deps.events ?? { emit: (event) => eventBus.emit(event) };
    this.log = deps.logger ?? logger.child('clone');
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Run one clone pass for a scan. Never throws; failures are returned. */
  async run(request: CloneRequest): Promise<CloneResult> {
    const warnings: string[] = [];
    const maxPages = request.maxPages ?? DEFAULT_CLONE_MAX_PAGES;

    try {
      const pages = (await this.persistence.listPages(request.scanId)).filter(
        (page) => page.status === 'completed'
      );
      const selected = pages.slice(0, maxPages);
      if (pages.length > selected.length) {
        warnings.push(
          `Cloned the first ${selected.length} of ${pages.length} completed pages (limit ${maxPages}).`
        );
      }

      this.events.emit(
        createEvent('clone.started', { scanId: request.scanId, pageCount: selected.length })
      );

      // Build the route map first so anchors can resolve during rewriting.
      const routeMap: RouteMap = {};
      const routeEntries: CloneManifestRoute[] = [];
      for (const page of selected) {
        const file = pagePathForUrl(page.url, request.sourceOrigin);
        routeMap[page.url] = file;
        routeMap[page.path] = file;
        routeEntries.push({ url: page.url, file, status: page.httpStatus });
      }

      const assetMap: AssetMap = {};
      const manifestAssets: CloneManifestAsset[] = [];
      let assetsWritten = 0;
      let assetsSkipped = 0;
      let skippedPages = 0;
      let generatedPages = 0;

      for (const page of selected) {
        const pageFile = routeMap[page.url] ?? pagePathForUrl(page.url, request.sourceOrigin);

        // 1. Capture the raw HTML for this page (fresh, via the worker).
        const htmlResult = await this.worker.extractRawHtml(request.sessionId, page.url);
        if (!htmlResult.ok || !htmlResult.data.rawHtml) {
          skippedPages += 1;
          warnings.push(`Skipped ${page.url}: no raw HTML could be captured.`);
          continue;
        }

        // 2. Capture + persist this page's assets.
        const assetResult = await this.worker.captureAssets(request.sessionId, page.url);
        if (assetResult.ok) {
          assetsSkipped += assetResult.data.skipped;
          if (assetResult.data.truncated) {
            warnings.push(`Assets for ${page.url} were truncated by a size cap.`);
          }
          const persisted: Parameters<ClonePersistence['upsertAssets']>[0] = [];
          for (const asset of assetResult.data.assets) {
            const localPath = assetPathFor(asset.sourceUrl, asset.assetType, asset.sha256);
            if (!isSafeRelativePath(localPath)) {
              assetsSkipped += 1;
              continue;
            }
            const bytes = decodeBase64(asset.base64);
            const written = await this.io.write(localPath, bytes);
            if (!written) {
              assetsSkipped += 1;
              continue;
            }
            assetsWritten += 1;
            assetMap[asset.sourceUrl] = localPath;
            manifestAssets.push({
              sourceUrl: asset.sourceUrl,
              localPath,
              mimeType: asset.mimeType,
              sizeBytes: asset.sizeBytes,
              sha256: asset.sha256,
              assetType: asset.assetType
            });
            persisted.push({
              scanId: request.scanId,
              pageId: page.id,
              pageUrl: page.url,
              sourceUrl: asset.sourceUrl,
              localPath,
              mimeType: asset.mimeType,
              sizeBytes: asset.sizeBytes,
              sha256: asset.sha256,
              assetType: asset.assetType
            });
            this.events.emit(
              createEvent('clone.asset_downloaded', {
                scanId: request.scanId,
                localPath,
                sha256: asset.sha256,
                sizeBytes: asset.sizeBytes
              })
            );
          }
          if (persisted.length > 0) {
            await this.persistence.upsertAssets(persisted);
          }
        } else {
          warnings.push(
            `Assets for ${page.url} could not be captured: ${assetResult.error.message}`
          );
        }

        // 3. Rewrite the HTML and write it into the clone tree.
        const rewritten = rewriteHtml(htmlResult.data.rawHtml.html, {
          assetMap,
          routeMap,
          pagePath: pageFile,
          mockClientPath: 'js/mock-client.js',
          baseUrl: page.url
        });
        const htmlWritten = await this.io.write(pageFile, encodeUtf8(rewritten));
        if (!htmlWritten) {
          skippedPages += 1;
          warnings.push(`Skipped ${page.url}: the rewritten page could not be written.`);
          continue;
        }
        generatedPages += 1;
        this.events.emit(
          createEvent('clone.file_generated', { scanId: request.scanId, file: pageFile })
        );

        // 4. Rewrite any captured stylesheets (bundled into a single file).
        const stylesheetAssets = assetResult.ok
          ? assetResult.data.assets.filter((asset) => asset.assetType === 'stylesheet')
          : [];
        if (stylesheetAssets.length > 0) {
          const combined: string[] = [];
          for (const sheet of stylesheetAssets) {
            const localPath = assetMap[sheet.sourceUrl];
            if (!localPath) {
              continue;
            }
            const existing = await this.io.read(localPath);
            if (existing) {
              combined.push(
                rewriteCss(decodeUtf8(existing), { assetMap, cssPath: 'css/styles.css' })
              );
            }
          }
          if (combined.length > 0) {
            await this.io.write('css/styles.css', encodeUtf8(combined.join('\n\n')));
          }
        }
      }

      // 5. Always emit the mock client + manifest so the clone is self-contained.
      await this.io.write('js/mock-client.js', encodeUtf8(MOCK_CLIENT_JS));

      const manifest = buildManifest({
        sourceOrigin: request.sourceOrigin,
        generatedAt: this.now(),
        routes: routeEntries,
        assets: manifestAssets,
        skippedPageCount: skippedPages
      });
      await this.io.write('manifest.json', encodeUtf8(serializeManifest(manifest)));

      const report: CloneReport = {
        scanId: request.scanId,
        generatedPages,
        skippedPages,
        assetsWritten,
        assetsSkipped,
        warnings
      };

      this.events.emit(
        createEvent('clone.completed', {
          scanId: request.scanId,
          generatedPages,
          skippedPages,
          assetsWritten,
          assetsSkipped,
          partial: skippedPages > 0 || assetsSkipped > 0
        })
      );
      this.log.info('Clone complete', { scanId: request.scanId, generatedPages, skippedPages });
      return { ok: true, report, manifest };
    } catch (error) {
      const structured = toStructuredError(error);
      this.events.emit(
        createEvent('clone.failed', {
          scanId: request.scanId,
          code: structured.code,
          message: structured.message
        })
      );
      return { ok: false, error: structured };
    }
  }
}

/** Decode a base64 payload to bytes without a Node-only dependency. */
function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return new Uint8Array(bufferCtor.from(base64, 'base64'));
}

function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return new Uint8Array(bufferCtor.from(text, 'utf8'));
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return bufferCtor.from(bytes).toString('utf8');
}
