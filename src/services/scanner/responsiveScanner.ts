/**
 * Responsive scanner service - Artupski ReSite
 * Source of truth: docs/design/RESPONSIVE-SPEC.md sections 1-2 and
 * docs/specs/SCANNER-SPEC.md section 4.2 (`viewportProfiles`).
 *
 * Orchestrates multi-viewport capture for scanned pages: for each requested
 * profile it asks the worker (`captureViewport`) to render the page under that
 * emulation, then writes the returned full-page screenshot to disk and persists
 * the metadata + visible-element map via `ResponsiveCaptureRepository`.
 *
 * Ownership / boundaries:
 *   - The React UI never calls this directly; `scanService` runs it after a crawl.
 *   - Screenshot PNGs are written through the sandboxed Rust `asset_write`
 *     command (never inline in SQLite), so the database stays small.
 *   - A capture failure for one profile is recorded as a skip and does NOT fail
 *     the crawl; the service reports partial coverage honestly.
 *
 * DELIBERATE SCOPE (documented limitation): this phase delivers the acceptance
 * criterion's "distinct screenshots and visible element maps for each
 * breakpoint" plus detected CSS media-query breakpoints. The full Tailwind
 * responsive-rule synthesizer (inferred `hidden md:flex` classes,
 * desktopPattern/mobilePattern classification) from RESPONSIVE-SPEC section 4 is
 * deferred to a later phase.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import type { StructuredError } from '../infra/errors';
import { createStructuredError } from '../infra/errors';
import { storageService } from '../storage';
import { assetWrite } from '../ipc';
import { isTauriRuntime } from '../ipc/tauri';
import {
  RESPONSIVE_VIEWPORT_PROFILES,
  type ViewportProfile,
  type ViewportProfileName
} from '../infra/workerProtocol';

/** The worker/runtime seam this service depends on (injectable for tests). */
export interface ResponsiveWorker {
  captureViewport(
    sessionId: string,
    url: string,
    profile: ViewportProfile,
    timeoutMs?: number
  ): Promise<
    | {
        ok: true;
        data: {
          screenshotBase64: string | null;
          detectedBreakpoints: number[];
          elements: unknown[];
          truncated: boolean;
        };
      }
    | { ok: false; error: StructuredError }
  >;
}

export interface ResponsiveScanRequest {
  scanId: string;
  projectId: string;
  sessionId: string;
  /** Pages to capture (already persisted `scan_pages` rows: { id, url }). */
  pages: Array<{ id: string; url: string }>;
  /** Which profiles to capture; defaults to all three. */
  profiles?: ViewportProfileName[];
  /** Navigation timeout per capture (worker clamps to <= 30s). */
  timeoutMs?: number;
}

export interface ResponsiveScanOutcome {
  scanId: string;
  captured: number;
  skipped: number;
}

/** Select the requested profiles from the canonical matrix, preserving order. */
export function resolveProfiles(names?: ViewportProfileName[]): ViewportProfile[] {
  if (!names || names.length === 0) {
    return [...RESPONSIVE_VIEWPORT_PROFILES];
  }
  const wanted = new Set(names);
  return RESPONSIVE_VIEWPORT_PROFILES.filter((profile) => wanted.has(profile.name));
}

/**
 * Deterministic, filesystem-safe relative asset path for a screenshot. Uses the
 * scan id + page id + profile so re-running a scan overwrites rather than
 * accumulates; the path is validated again by the Rust `asset_write` command.
 */
export function screenshotRelativePath(scanId: string, pageId: string, profile: string): string {
  // Only [a-zA-Z0-9_-] survive, so a '..' component can never form.
  const safe = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `responsive/${safe(scanId)}/${safe(pageId)}-${safe(profile)}.png`;
}

/** Decode a base64 string into bytes, or null when it is empty/malformed. */
function decodeBase64(value: string | null): Uint8Array | null {
  if (!value) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Write a screenshot to the sandboxed assets directory; null bytes => no file. */
async function writeScreenshot(relative: string, bytes: Uint8Array | null): Promise<string | null> {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  // In the browser preview there is no native command; the element map is still
  // captured and persisted, but no file is written.
  if (!isTauriRuntime()) {
    return null;
  }
  const result = await assetWrite(relative, bytes);
  return result.ok ? relative : null;
}

/**
 * Capture every page under every requested profile, writing screenshots and
 * persisting one `responsive_captures` row per (page, profile). Never throws:
 * a per-page or per-profile failure is recorded and skipped so the crawl's
 * terminal status is unaffected.
 */
export async function runResponsiveScan(
  request: ResponsiveScanRequest,
  worker: ResponsiveWorker
): Promise<ResponsiveScanOutcome> {
  const log = logger.child('responsive');
  const profiles = resolveProfiles(request.profiles);
  let captured = 0;
  let skipped = 0;

  if (storageService.getState() !== 'ready' || profiles.length === 0) {
    return { scanId: request.scanId, captured: 0, skipped: request.pages.length * profiles.length };
  }
  const repository = storageService.getRepositories().responsiveCaptures;

  for (const page of request.pages) {
    for (const profile of profiles) {
      try {
        const result = await worker.captureViewport(
          request.sessionId,
          page.url,
          profile,
          request.timeoutMs
        );
        if (!result.ok) {
          skipped += 1;
          log.debug('Viewport capture skipped', {
            url: page.url,
            profile: profile.name,
            code: result.error.code
          });
          continue;
        }

        const relative = screenshotRelativePath(request.scanId, page.id, profile.name);
        const bytes = decodeBase64(result.data.screenshotBase64);
        const screenshotPath = await writeScreenshot(relative, bytes);

        await repository.upsert({
          scanId: request.scanId,
          pageId: page.id,
          url: page.url,
          profile: profile.name,
          width: profile.width,
          height: profile.height,
          deviceScaleFactor: profile.deviceScaleFactor,
          isMobile: profile.isMobile,
          hasTouch: profile.hasTouch,
          screenshotPath,
          detectedBreakpoints: result.data.detectedBreakpoints,
          elementMap: result.data.elements as never,
          truncated: result.data.truncated
        });
        captured += 1;
      } catch (error) {
        skipped += 1;
        log.warn('Viewport capture failed', {
          url: page.url,
          profile: profile.name,
          error: String(error)
        });
      }
    }
  }

  eventBus.emit(
    createEvent('responsive.captured', {
      scanId: request.scanId,
      captured,
      skipped,
      profiles: profiles.map((profile) => profile.name)
    })
  );
  log.info('Responsive capture complete', { scanId: request.scanId, captured, skipped });
  return { scanId: request.scanId, captured, skipped };
}

/** A structured error for callers that need one (never thrown internally). */
export function createResponsiveError(message: string, suggestedAction: string): StructuredError {
  return createStructuredError({
    code: 'NAVIGATION_ABORTED',
    category: 'browser',
    message,
    severity: 'warning',
    recoverable: true,
    retryable: true,
    suggestedAction
  });
}
