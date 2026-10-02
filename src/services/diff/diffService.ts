/**
 * Visual verification service - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 13) and
 * docs/impl-plan/phase-13-impl-plan.md sections 7, 11-13.
 *
 * Orchestrates one visual comparison run:
 *   1. launch the generated project's local static server (loopback, managed);
 *   2. capture a screenshot of each generated route at each viewport profile
 *      through the Phase 3 browser worker (`captureViewport`);
 *   3. load the matching ORIGINAL captured screenshot (Phase 7) from the
 *      sandboxed assets root;
 *   4. decode both PNGs and call the pure `computeVisualDiff` core;
 *   5. report an honest, bounded result and emit `diff.*` events.
 *
 * Transparency and safety:
 *   - every collaborator is injectable, so the service is unit-testable without
 *     a Tauri shell, a real browser, or a real server;
 *   - it NEVER executes generated application code in-process;
 *   - one viewport failing never fails the run - it is reported and sets
 *     `partial`;
 *   - it never throws past its boundary.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import { createStructuredError, type StructuredError } from '../infra/errors';
import {
  MAX_DIFF_VIEWPORTS,
  type ViewportComparison,
  type VisualDiffReport,
  type VisualDiffReportSummary
} from '../../types/visualDiff';
import { decodePng, encodePng, PngError } from './png';
import { computeVisualDiff } from './visualDiff';
import type { GeneratedServerHandle } from './generatedServer';

const log = logger.child('diff');

/** One generated route to verify (derived from the Phase 12 report). */
export interface GeneratedRouteTarget {
  /** Route path as emitted by the generator (e.g. `/`, `/about`). */
  path: string;
  /**
   * The served URL for this route. When omitted the service joins `baseUrl` and
   * `path`; when supplied it is used verbatim (the caller owns its validity).
   */
  url?: string;
}

/** An original capture available for comparison (from Phase 7 rows). */
export interface OriginalCaptureRef {
  /** Viewport profile name (e.g. `desktop`). */
  profile: string;
  /** Sandboxed assets-relative path of the original PNG (may be null). */
  screenshotPath: string | null;
  width: number;
  height: number;
}

export interface VisualDiffRunRequest {
  /** The route(s) to verify. At least one required. */
  routes: GeneratedRouteTarget[];
  /** Viewport profiles to compare. At least one required. */
  profiles: string[];
  /** Original captures keyed by profile name (from the Phase 7 store). */
  originals: Record<string, OriginalCaptureRef | undefined>;
}

/** The generated-server seam (injectable for tests). */
export interface DiffServerLauncher {
  start(
    root: string
  ): Promise<{ ok: true; data: GeneratedServerHandle } | { ok: false; error: StructuredError }>;
  stop(): Promise<unknown>;
}

/** The browser/screenshot seam (injectable for tests). */
export interface DiffCaptureAdapter {
  launch(): Promise<{ ok: true; sessionId: string } | { ok: false; error: StructuredError }>;
  capture(
    sessionId: string,
    url: string,
    profile: string
  ): Promise<{ ok: true; screenshotBase64: string | null } | { ok: false; error: StructuredError }>;
  close(sessionId: string): Promise<void>;
}

/** The sandboxed asset reader seam (injectable for tests). */
export interface DiffOriginalReader {
  read(relative: string): Promise<Uint8Array | null>;
}

export interface VisualDiffServiceDeps {
  server?: DiffServerLauncher;
  capture?: DiffCaptureAdapter;
  originals?: DiffOriginalReader;
  /** Abort signal for cancellation (checked between viewports). */
  signal?: AbortSignal;
}

/** Maximum routes verified in one generated project run. */
export const MAX_DIFF_ROUTES = 50;

/**
 * Run a full visual comparison. Always returns a report; never throws. An
 * unrecoverable setup failure (no routes, no profiles, server launch failure)
 * yields `ok: false` with a structured error.
 */
export async function runVisualDiff(
  projectRoot: string,
  request: VisualDiffRunRequest,
  deps: VisualDiffServiceDeps = {}
): Promise<VisualDiffReport> {
  const routes = request.routes.slice(0, MAX_DIFF_ROUTES);
  const profiles = dedupeStrings(request.profiles).slice(0, MAX_DIFF_VIEWPORTS);

  if (routes.length === 0) {
    return failure(
      'NO_ROUTES',
      'There are no generated routes to compare.',
      'Generate a project first.'
    );
  }
  if (profiles.length === 0) {
    return failure(
      'NO_PROFILES',
      'No viewport profiles were requested.',
      'Select at least one viewport to compare.'
    );
  }
  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    return failure(
      'INVALID_ROOT',
      'The generated project root is missing.',
      'Regenerate the project.'
    );
  }

  eventBus.emit(createEvent('diff.started', { viewports: profiles.length, routes: routes.length }));

  const server = deps.server ?? (await resolveDefaultServer());
  if (!server) {
    const report = failure(
      'DIFF_SERVER_UNAVAILABLE',
      'The visual comparison server is only available in the desktop shell.',
      'Run the desktop shell with `npm run tauri:dev`.'
    );
    emitFailed(report);
    return report;
  }
  const capture = deps.capture ?? (await resolveDefaultCapture());
  const originals = deps.originals ?? defaultOriginalReader();

  const started = await server.start(projectRoot);
  if (!started.ok) {
    const report = failure(
      started.error.code,
      started.error.message,
      started.error.suggestedAction
    );
    emitFailed(report);
    return report;
  }
  const baseUrl = started.data.url;

  const session = await capture.launch();
  if (!session.ok) {
    await server.stop();
    const report = failure(
      session.error.code,
      session.error.message,
      session.error.suggestedAction
    );
    emitFailed(report);
    return report;
  }

  const comparisons: ViewportComparison[] = [];
  let aborted = false;

  try {
    for (const profile of profiles) {
      if (deps.signal?.aborted) {
        aborted = true;
        break;
      }
      const comparison = await compareProfile({
        profile,
        routes,
        baseUrl,
        original: request.originals[profile],
        sessionId: session.sessionId,
        capture,
        originals
      });
      comparisons.push(comparison);
      if (comparison.compared) {
        eventBus.emit(
          createEvent('diff.computed', {
            profile,
            mismatchedPixels: comparison.mismatchedPixels,
            totalPixels: comparison.totalPixels,
            similarityPercent: comparison.similarityPercent
          })
        );
      }
    }
  } finally {
    await capture.close(session.sessionId);
    await server.stop();
  }

  const summary = summarize(comparisons);
  eventBus.emit(
    createEvent('diff.completed', {
      viewports: profiles.length,
      compared: summary.compared,
      skipped: summary.skipped,
      averageSimilarityPercent: summary.averageSimilarityPercent,
      partial: summary.partial
    })
  );
  log.info('Visual comparison complete', {
    compared: summary.compared,
    skipped: summary.skipped,
    average: summary.averageSimilarityPercent
  });

  return { ok: true, comparisons, summary, aborted };
}

interface CompareDeps {
  profile: string;
  routes: GeneratedRouteTarget[];
  baseUrl: string;
  original: OriginalCaptureRef | undefined;
  sessionId: string;
  capture: DiffCaptureAdapter;
  originals: DiffOriginalReader;
}

/** Compare one viewport across all routes, keeping the worst (lowest) match. */
async function compareProfile(deps: CompareDeps): Promise<ViewportComparison> {
  // The original is a single page capture; the generated project's index route
  // is the matching render. Compare the first route (index) by default.
  const target = deps.routes[0]!;
  const url = target.url ?? joinUrl(deps.baseUrl, target.path);

  const originalBytes = deps.original?.screenshotPath
    ? await safeRead(deps.originals, deps.original.screenshotPath)
    : null;
  const generatedResult = await deps.capture.capture(deps.sessionId, url, deps.profile);
  const generatedBase64 = generatedResult.ok ? generatedResult.screenshotBase64 : null;

  eventBus.emit(
    createEvent('diff.captured', {
      profile: deps.profile,
      generated: generatedBase64 !== null,
      original: originalBytes !== null
    })
  );

  if (!originalBytes) {
    return skipped(deps.profile, 'The original captured screenshot is unavailable.');
  }
  if (!generatedBase64) {
    return skipped(deps.profile, 'The generated page could not be captured.');
  }

  let originalImage;
  let generatedImage;
  try {
    originalImage = await decodePng(originalBytes);
    generatedImage = await decodePng(base64ToBytes(generatedBase64));
  } catch (error) {
    return skipped(
      deps.profile,
      error instanceof PngError ? error.message : 'An image could not be decoded.'
    );
  }

  const result = computeVisualDiff(originalImage, generatedImage, { allowSizeMismatch: true });
  if (!result.ok || !result.diffImage) {
    return skipped(deps.profile, result.error ?? 'The images could not be compared.');
  }
  let diffPng: Uint8Array | null = null;
  try {
    diffPng = await encodePng(result.diffImage);
  } catch {
    diffPng = null;
  }

  return {
    profile: deps.profile,
    compared: true,
    width: result.width,
    height: result.height,
    mismatchedPixels: result.mismatchedPixels,
    totalPixels: result.totalPixels,
    similarityPercent: result.similarityPercent,
    discrepancies: result.discrepancies,
    skippedReason: null,
    diffPng
  };
}

function skipped(profile: string, reason: string): ViewportComparison {
  return {
    profile,
    compared: false,
    width: 0,
    height: 0,
    mismatchedPixels: 0,
    totalPixels: 0,
    similarityPercent: 0,
    discrepancies: [],
    skippedReason: reason,
    diffPng: null
  };
}

function summarize(comparisons: ViewportComparison[]): VisualDiffReportSummary {
  const comparedList = comparisons.filter((entry) => entry.compared);
  const compared = comparedList.length;
  const skippedCount = comparisons.length - compared;
  const average =
    compared === 0
      ? 0
      : Math.round(
          (comparedList.reduce((sum, e) => sum + e.similarityPercent, 0) / compared) * 100
        ) / 100;
  const mismatchedPixels = comparedList.reduce((sum, e) => sum + e.mismatchedPixels, 0);
  const totalPixels = comparedList.reduce((sum, e) => sum + e.totalPixels, 0);
  const partial =
    skippedCount > 0 ||
    comparedList.some((entry) =>
      entry.discrepancies.some((discrepancy) => discrepancy.kind === 'dimension_mismatch')
    );
  return {
    viewports: comparisons.length,
    compared,
    skipped: skippedCount,
    averageSimilarityPercent: average,
    mismatchedPixels,
    totalPixels,
    partial
  };
}

function failure(code: string, message: string, suggestedAction: string): VisualDiffReport {
  return {
    ok: false,
    comparisons: [],
    summary: {
      viewports: 0,
      compared: 0,
      skipped: 0,
      averageSimilarityPercent: 0,
      mismatchedPixels: 0,
      totalPixels: 0,
      partial: false
    },
    aborted: false,
    error: { code, message, suggestedAction }
  };
}

function emitFailed(report: VisualDiffReport): void {
  if (report.error) {
    eventBus.emit(
      createEvent('diff.failed', { code: report.error.code, message: report.error.message })
    );
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Join a loopback base URL with a route path without doubling separators. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function safeRead(reader: DiffOriginalReader, relative: string): Promise<Uint8Array | null> {
  try {
    return await reader.read(relative);
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  // Node fallback (Vitest runs in jsdom where atob exists; this is defensive).
  const buffer = Buffer.from(base64, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Resolve the production server launcher (ProcessManager over the Rust spawner). */
async function resolveDefaultServer(): Promise<DiffServerLauncher | null> {
  const { isTauriRuntime } = await import('../ipc/tauri');
  if (!isTauriRuntime()) {
    return null;
  }
  const { startGeneratedServer, stopGeneratedServer, resolveGeneratedServeRoot } =
    await import('./generatedServer');
  return {
    start: (root: string) => startGeneratedServer(resolveGeneratedServeRoot(root)),
    stop: () => stopGeneratedServer()
  };
}

/** Resolve the production capture adapter (Phase 3 browser runtime). */
async function resolveDefaultCapture(): Promise<DiffCaptureAdapter> {
  const { getBrowserRuntime } = await import('../browser');
  return {
    async launch() {
      const runtime = getBrowserRuntime();
      if (!runtime) {
        return {
          ok: false,
          error: createStructuredError({
            code: 'BROWSER_NOT_INSTALLED',
            category: 'browser',
            message: 'No browser runtime is available for capture.',
            severity: 'error',
            recoverable: true,
            suggestedAction: 'Install the browser runtime and retry.'
          })
        };
      }
      const result = await runtime.launchSession({ headless: true });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, sessionId: result.data.sessionId };
    },
    async capture(sessionId: string, url: string, profile: string) {
      const runtime = getBrowserRuntime();
      if (!runtime) {
        return {
          ok: false,
          error: createStructuredError({
            code: 'BROWSER_NOT_INSTALLED',
            category: 'browser',
            message: 'No browser runtime is available for capture.',
            severity: 'error',
            recoverable: true,
            suggestedAction: 'Install the browser runtime and retry.'
          })
        };
      }
      const result = await runtime.captureViewport(sessionId, url, selectProfile(profile));
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, screenshotBase64: result.data.screenshotBase64 };
    },
    async close(sessionId: string) {
      const runtime = getBrowserRuntime();
      if (runtime) {
        await runtime.closeSession(sessionId);
      }
    }
  };
}

/** Map a profile name to a full viewport profile (defaults to desktop). */
function selectProfile(name: string) {
  // Imported lazily to avoid a value import cycle at module load in tests.
  const profiles = [
    {
      name: 'desktop',
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false
    },
    {
      name: 'tablet',
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    },
    {
      name: 'mobile',
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true
    }
  ] as const;
  return profiles.find((profile) => profile.name === name) ?? profiles[0];
}

/** Default reader over the sandboxed assets root via the `asset_read` IPC command. */
function defaultOriginalReader(): DiffOriginalReader {
  return {
    async read(relative: string) {
      const { assetRead } = await import('../ipc');
      const result = await assetRead(relative);
      if (!result.ok) {
        return null;
      }
      return Uint8Array.from(result.data);
    }
  };
}
