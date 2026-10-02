/**
 * Crawler worker entrypoint - Artupski ReSite
 * Source of truth: docs/architecture/WORKER-PROTOCOL.md and docs/specs/SCANNER-SPEC.md.
 *
 * A dedicated Node.js child process that speaks the versioned, newline-delimited
 * JSON protocol over stdio. It supports `ping`, `launch`, `navigate`, `close`
 * (Phase 3) plus `extract` and `abort` (Phase 4). `extract` navigates to a URL,
 * enforces the shared URL/network policy at every boundary it can observe,
 * extracts Phase 4 page data, and returns a normalized result.
 *
 * It is launched by the Rust `process_spawn` command (allowlisted `node`) and
 * driven by the TypeScript `ProcessManager`. It never sees the React UI.
 *
 * Run directly for debugging:
 *   node --experimental-strip-types src/workers/crawler/index.ts
 */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { lookup } from 'node:dns/promises';

import {
  createErrorMessage,
  createEventMessage,
  createLogMessage,
  createMessageId,
  createResultMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  DEFAULT_EXTRACTABLE_CONTENT_TYPES,
  MAX_EXTRACT_REDIRECTS,
  evaluateUrlPolicy,
  createCrawlScope,
  normalizeExtraction,
  extractPageEvidence,
  createEmptyLoginSignals,
  type AuthStorageState,
  type BrowserAvailability,
  type CaptureAssetsResultPayload,
  type CaptureStateResultPayload,
  type CaptureViewportResultPayload,
  type CapturedAsset,
  type CloseResultPayload,
  type DetectLoginResultPayload,
  type ExtractResultPayload,
  type HostResolution,
  type LaunchResultPayload,
  type LoginDetectionSignals,
  type NavigateResultPayload,
  type NormalizedPage,
  type PageExtraction,
  type PingResultPayload,
  type RawHtmlCapture,
  type ViewportElementNode,
  type WorkerCommandMessage,
  type WorkerResultPayload,
  MAX_SCREENSHOT_BASE64_BYTES,
  MAX_RAW_HTML_BYTES,
  MAX_ASSET_COUNT,
  MAX_ASSET_BYTES
} from './protocol.ts';
import { LOGIN_PROBE_EXPRESSION } from '../../services/scanner/extraction/inPageExtractor.ts';
import { classifyIpLiteral } from '../../services/scanner/security/ipPolicy.ts';

/** Worker build identifier reported during the ping handshake. */
const WORKER_VERSION = '0.2.0';

/** Hard ceiling for any navigation, matching AGENTS.md section 4 (30s). */
const MAX_NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * Reads the page's `sessionStorage` as a plain object. Used only during capture
 * (AUTH-SCANNING.md section 2.1 step 5), which Playwright's `storageState()`
 * does not include. The values are treated as secrets and are never logged.
 */
const SESSION_STORAGE_PROBE = 'Object.fromEntries(Object.entries(window.sessionStorage))';

// ---------------------------------------------------------------------------
// Minimal structural types for playwright-core (imported lazily, no download).
// ---------------------------------------------------------------------------

interface PlaywrightRoute {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(): Promise<void>;
}

interface PlaywrightResponse {
  status(): number | null;
  headers(): Record<string, string>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: 'load' | 'domcontentloaded' | 'networkidle' }
  ): Promise<PlaywrightResponse | null>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
  evaluate<T>(expression: string): Promise<T>;
  route(pattern: string, handler: (route: PlaywrightRoute) => void | Promise<void>): Promise<void>;
  close(): Promise<void>;
  /** Full-page PNG screenshot of the current page. */
  screenshot(options: { fullPage: boolean; type: 'png' }): Promise<Uint8Array>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
  /**
   * Snapshot the context's cookies + origin storage. Only ever called for an
   * interactive capture session; the result is scoped, returned to the host for
   * encryption, and never logged or written to disk here.
   */
  storageState(): Promise<unknown>;
  /**
   * Open pages in this context. Used only to read `sessionStorage` (which
   * `storageState()` does not include) from the pages the user signed in on.
   */
  pages(): PlaywrightPage[];
}

interface PlaywrightBrowser {
  version(): string;
  newPage(): Promise<PlaywrightPage>;
  newContext(options?: {
    storageState?: unknown;
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
  }): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  executablePath(): string;
  launch(options: { headless: boolean; executablePath?: string }): Promise<PlaywrightBrowser>;
}

interface ActiveSession {
  browser: PlaywrightBrowser;
  /**
   * Explicit, isolated browser context for this session. When the host injects
   * a captured storage state it is applied here, so a plain `launch()` can never
   * inherit it and one session cannot see another's cookies. Always closed with
   * the session (no persistent profile is written to disk).
   */
  context: PlaywrightContext;
  engine: 'chromium';
  version: string;
  /**
   * True for a headed, user-in-the-loop interactive capture session
   * (AUTH-SCANNING.md section 2.1). A capture session is the ONLY session on
   * which `captureState` is permitted, and it never carries an injected
   * `authState`, so a capture context can never be silently used as a scan
   * context.
   */
  capture: boolean;
  /**
   * The injected storage state for this session, retained in memory ONLY so a
   * responsive-capture context can replay the same authenticated session. It is
   * never written to disk, logged, or echoed back.
   */
  authState: AuthStorageState | null;
  /** Abort controller for the in-flight extraction, if any. */
  activeAbort: AbortController | null;
}

const sessions = new Map<string, ActiveSession>();
let shuttingDown = false;

function write(message: Parameters<typeof serializeMessage>[0]): void {
  try {
    process.stdout.write(serializeMessage(message));
  } catch {
    // A frame that cannot be serialized is dropped rather than crashing the
    // worker; the host's request timeout will surface the failure.
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  write(createLogMessage({ level, message }));
}

function emitEvent(event: string, data?: Record<string, unknown>): void {
  write(createEventMessage({ event, data }));
}

/** Lazily import playwright-core so detection failures never crash startup. */
async function loadChromium(): Promise<PlaywrightChromium | null> {
  try {
    const mod = (await import('playwright-core')) as unknown as { chromium: PlaywrightChromium };
    return mod.chromium;
  } catch {
    return null;
  }
}

/** Detect Chromium availability WITHOUT downloading anything. */
async function detectBrowser(): Promise<BrowserAvailability> {
  const chromium = await loadChromium();
  if (!chromium) {
    return { engine: 'chromium', installed: false };
  }
  try {
    const executablePath = chromium.executablePath();
    const installed =
      typeof executablePath === 'string' && executablePath.length > 0 && existsSync(executablePath);
    return installed
      ? { engine: 'chromium', installed: true, executablePath }
      : { engine: 'chromium', installed: false };
  } catch {
    return { engine: 'chromium', installed: false };
  }
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return MAX_NAVIGATION_TIMEOUT_MS;
  }
  return Math.min(value, MAX_NAVIGATION_TIMEOUT_MS);
}

/** Resolve a hostname to its IP literals (used for SSRF/rebinding checks). */
async function resolveHost(hostname: string): Promise<HostResolution> {
  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return { status: 'resolved', addresses: results.map((entry) => entry.address) };
  } catch {
    return { status: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handlePing(): Promise<WorkerResultPayload> {
  const browser = await detectBrowser();
  const payload: PingResultPayload = {
    command: 'ping',
    pong: true,
    workerVersion: WORKER_VERSION,
    browser
  };
  return payload;
}

async function handleLaunch(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'launch') {
    throw new Error('launch handler received the wrong command');
  }
  const chromium = await loadChromium();
  if (!chromium) {
    throw Object.assign(new Error('playwright-core is not available in the worker.'), {
      code: 'BROWSER_NOT_INSTALLED'
    });
  }

  const detection = await detectBrowser();
  if (!detection.installed && !message.payload.executablePath) {
    throw Object.assign(new Error('No Playwright Chromium build was found.'), {
      code: 'BROWSER_NOT_INSTALLED'
    });
  }

  // Capture-session invariants (AUTH-SCANNING.md section 2.1). A capture
  // session is user-in-the-loop and MUST be headed and MUST NOT carry an
  // injected state, so a capture context can never be silently promoted to a
  // scan context. Enforced here as well as at the protocol boundary.
  const capture = message.payload.capture === true;
  if (capture && message.payload.authState !== undefined) {
    throw Object.assign(new Error('A capture session cannot carry an injected session.'), {
      code: 'WORKER_PROTOCOL_VIOLATION'
    });
  }
  if (capture && message.payload.headless !== false) {
    throw Object.assign(new Error('A capture session must be headed (headless:false).'), {
      code: 'WORKER_PROTOCOL_VIOLATION'
    });
  }

  const browser = await chromium.launch({
    headless: message.payload.headless,
    executablePath: message.payload.executablePath ?? detection.executablePath
  });
  const sessionId = createMessageId();
  const version = browser.version();

  // Every session gets its OWN explicit context. A captured session is applied
  // here (in-memory only) so it can never leak from the default context of a
  // plain launch, and a state-less launch can never inherit it. The injected
  // state is never written to disk, logged, or echoed back.
  const contextOptions: { storageState?: unknown } = {};
  if (message.payload.authState) {
    contextOptions.storageState = toPlaywrightStorageState(message.payload.authState);
  }
  const context = await browser.newContext(contextOptions);

  sessions.set(sessionId, {
    browser,
    context,
    engine: 'chromium',
    version,
    capture,
    authState: message.payload.authState ?? null,
    activeAbort: null
  });
  emitEvent('browser.launched', {
    sessionId,
    version,
    authenticated: message.payload.authState !== undefined,
    capture
  });

  const payload: LaunchResultPayload = {
    command: 'launch',
    sessionId,
    engine: 'chromium',
    version
  };
  return payload;
}

/**
 * Convert the captured storage state into Playwright's `storageState` shape.
 * Cookie `expires: -1` (a session cookie) is mapped to `-1` as Playwright
 * expects; everything else is passed through unchanged. The value never leaves
 * this process and is never logged.
 */
function toPlaywrightStorageState(state: AuthStorageState): {
  cookies: Array<Record<string, unknown>>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
} {
  return {
    cookies: state.cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite
    })),
    origins: state.origins.map((origin) => ({
      origin: origin.origin,
      localStorage: Object.entries(origin.localStorage ?? {}).map(([name, value]) => ({
        name,
        value
      }))
    }))
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip a leading dot from a cookie Domain attribute. */
function normalizedCookieDomain(domain: string): string {
  return (domain.startsWith('.') ? domain.slice(1) : domain).toLowerCase();
}

/**
 * True when a cookie applies to the scope host under standard cookie rules: an
 * exact host match, or a parent-domain cookie (`Domain=example.com`) that also
 * applies to a subdomain. Anything else is out of scope and is dropped.
 */
function cookieInScope(cookieDomain: string, scopeHost: string): boolean {
  const domain = normalizedCookieDomain(cookieDomain);
  const host = scopeHost.toLowerCase();
  return domain === host || host.endsWith(`.${domain}`);
}

/** True when an origin's hostname is exactly the scope host. */
function originInScope(origin: string, scopeHost: string): boolean {
  try {
    return new URL(origin).hostname.toLowerCase() === scopeHost.toLowerCase();
  } catch {
    return false;
  }
}

/** The `scheme://host` origin of a URL, or null when unparseable. */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Convert Playwright's `[{name,value}]` storage into the host's Record shape. */
function toStorageMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isPlainRecord(entry) && typeof entry.name === 'string') {
        out[entry.name] = String(entry.value ?? '');
      }
    }
  } else if (isPlainRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      out[key] = String(item ?? '');
    }
  }
  return out;
}

/**
 * Collect `sessionStorage` for the in-scope origins. `storageState()` returns
 * ONLY origins that have localStorage, so an origin with just sessionStorage
 * would be lost; the origins are therefore also derived from the in-scope pages
 * the user signed in on (AUTH-SCANNING.md section 2.1 step 5). Nothing is
 * logged or persisted here.
 */
async function collectSessionStorage(
  context: PlaywrightContext,
  origins: Map<
    string,
    { origin: string; localStorage: Record<string, string>; sessionStorage: Record<string, string> }
  >,
  scopeHost: string
): Promise<void> {
  for (const page of context.pages()) {
    let pageUrl: string;
    try {
      pageUrl = page.url();
    } catch {
      continue;
    }
    const origin = safeOrigin(pageUrl);
    if (!origin || !originInScope(origin, scopeHost)) {
      continue;
    }
    let record = origins.get(origin);
    if (!record) {
      record = { origin, localStorage: {}, sessionStorage: {} };
      origins.set(origin, record);
    }
    try {
      const entries = await page.evaluate<Record<string, string>>(SESSION_STORAGE_PROBE);
      if (isPlainRecord(entries)) {
        for (const [key, value] of Object.entries(entries)) {
          record.sessionStorage[key] = String(value ?? '');
        }
      }
    } catch {
      // A closed or blank page simply yields no sessionStorage.
    }
  }
}

/**
 * Snapshot an interactive capture session's storage state, scoped strictly to
 * the capture host (AUTH-SCANNING.md section 2.1). Cookies and origins that do
 * not belong to the scope host are dropped so a capture can never persist state
 * for an unrelated origin. The result is returned to the host for encryption;
 * nothing is persisted, logged, or emitted here.
 */
async function handleCaptureState(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'captureState') {
    throw new Error('captureState handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }
  if (!session.capture) {
    // Only an interactive capture session may yield state: a scan session is
    // never a valid capture source, so ownership can never be taken silently.
    throw Object.assign(new Error('This session is not an interactive capture session.'), {
      code: 'WORKER_PROTOCOL_VIOLATION'
    });
  }

  const raw = (await session.context.storageState()) as { cookies?: unknown; origins?: unknown };
  const scopeHost = message.payload.scopeHost;

  const cookies = (Array.isArray(raw?.cookies) ? raw.cookies : [])
    .filter(isPlainRecord)
    .filter(
      (cookie) => typeof cookie.domain === 'string' && cookieInScope(cookie.domain, scopeHost)
    )
    .map((cookie) => ({
      name: String(cookie.name),
      value: String(cookie.value),
      domain: String(cookie.domain),
      path: typeof cookie.path === 'string' ? cookie.path : '/',
      expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: (cookie.sameSite === 'Strict' || cookie.sameSite === 'None'
        ? cookie.sameSite
        : 'Lax') as 'Strict' | 'Lax' | 'None'
    }));

  // Seed origins from storageState() (localStorage), then overlay sessionStorage
  // read from the in-scope pages so an origin with only sessionStorage is not
  // lost. Both are keyed by origin to avoid duplicates.
  const originMap = new Map<
    string,
    { origin: string; localStorage: Record<string, string>; sessionStorage: Record<string, string> }
  >();
  for (const rawOrigin of (Array.isArray(raw?.origins) ? raw.origins : []).filter(isPlainRecord)) {
    if (typeof rawOrigin.origin !== 'string' || !originInScope(rawOrigin.origin, scopeHost)) {
      continue;
    }
    originMap.set(rawOrigin.origin, {
      origin: rawOrigin.origin,
      localStorage: toStorageMap(rawOrigin.localStorage),
      sessionStorage: {}
    });
  }

  // storageState() omits sessionStorage; read it from the signed-in pages so the
  // captured model matches AUTH-SCANNING.md section 2.1.
  await collectSessionStorage(session.context, originMap, scopeHost);
  const origins = Array.from(originMap.values());

  const payload: CaptureStateResultPayload = {
    command: 'captureState',
    sessionId: message.payload.sessionId,
    scopeHost,
    storageState: { cookies, origins },
    cookieCount: cookies.length,
    originCount: origins.length
  };
  return payload;
}

async function handleNavigate(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'navigate') {
    throw new Error('navigate handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }

  const page = await session.context.newPage();
  const response = await page.goto(message.payload.url, {
    timeout: clampTimeout(message.payload.timeoutMs),
    waitUntil: 'load'
  });
  const title = await page.title();
  const status = response?.status() ?? null;

  const payload: NavigateResultPayload = {
    command: 'navigate',
    sessionId: message.payload.sessionId,
    url: message.payload.url,
    status,
    title
  };
  return payload;
}

function contentTypeAllowed(contentType: string | undefined, allowed: readonly string[]): boolean {
  if (!contentType) {
    // No content type: be permissive only if HTML is allowed (many servers omit it).
    return allowed.includes('text/html');
  }
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  return allowed.includes(normalized);
}

/**
 * Install a route guard that aborts sub-resource requests to prohibited IP
 * addresses (defense in depth against a page pulling in SSRF targets). The
 * trusted seed host is always allowed, since the user explicitly chose it.
 */
async function installRouteGuard(
  page: PlaywrightPage,
  trustedHosts: ReadonlySet<string>
): Promise<void> {
  await page.route('**/*', async (route) => {
    try {
      const parsed = new URL(route.request().url());
      if (trustedHosts.has(parsed.hostname.toLowerCase())) {
        await route.continue();
        return;
      }
      const classification = classifyIpLiteral(parsed.hostname);
      if (classification && !classification.allowed) {
        await route.abort();
        return;
      }
    } catch {
      // Non-URL or unparseable request: continue (the top-level check governs).
    }
    await route.continue();
  });
}

/**
 * Read the page's raw HTML and bound it to `MAX_RAW_HTML_BYTES` (UTF-8). A body
 * that exceeds the cap is truncated on a code-point boundary and flagged so the
 * host never mistakes a partial capture for a complete one.
 */
async function captureRawHtml(page: PlaywrightPage): Promise<RawHtmlCapture> {
  const html = await page.content();
  const byteLength = Buffer.byteLength(html, 'utf8');
  if (byteLength <= MAX_RAW_HTML_BYTES) {
    return { html, byteLength, truncated: false };
  }
  // Truncate by bytes, then drop any trailing partial code point.
  const buffer = Buffer.from(html, 'utf8').subarray(0, MAX_RAW_HTML_BYTES);
  const truncatedHtml = buffer.toString('utf8').replace(/\uFFFD$/, '');
  return {
    html: truncatedHtml,
    byteLength: Buffer.byteLength(truncatedHtml, 'utf8'),
    truncated: true
  };
}

async function handleExtract(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'extract') {
    throw new Error('extract handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }

  const requestedUrl = message.payload.url;
  const allowedContentTypes =
    message.payload.allowedContentTypes ?? DEFAULT_EXTRACTABLE_CONTENT_TYPES;
  const followRedirects = message.payload.followRedirects ?? true;
  const maxRedirects = Math.min(
    message.payload.maxRedirects ?? MAX_EXTRACT_REDIRECTS,
    MAX_EXTRACT_REDIRECTS
  );
  const scope = createCrawlScope(requestedUrl);
  if (!scope) {
    throw Object.assign(new Error('The requested URL could not be parsed.'), {
      code: 'INVALID_URL'
    });
  }
  // The user explicitly chose this URL as the crawl target, so its origin is
  // trusted for the private/loopback checks (a local dev server is legitimate).
  const trustedOrigins = [new URL(requestedUrl).origin];

  const decision = await evaluateUrlPolicy(requestedUrl, {
    resolveHost,
    trustedOrigins
  });
  if (!decision.allowed) {
    throw Object.assign(new Error(`Navigation blocked by the URL policy (${decision.reason}).`), {
      code: 'INVALID_URL',
      detail: decision.detail
    });
  }

  const abort = new AbortController();
  session.activeAbort = abort;
  const page = await session.context.newPage();
  const trustedHosts = new Set<string>([new URL(requestedUrl).hostname.toLowerCase()]);

  try {
    await installRouteGuard(page, trustedHosts);

    let response: PlaywrightResponse | null;
    try {
      response = await page.goto(requestedUrl, {
        timeout: clampTimeout(message.payload.timeoutMs),
        waitUntil: 'load'
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Navigation failed.';
      if (abort.signal.aborted) {
        throw Object.assign(new Error('Extraction was cancelled.'), { code: 'USER_CANCELLED' });
      }
      if (/timeout/i.test(messageText)) {
        throw Object.assign(new Error('Navigation timed out.'), { code: 'CONNECTION_TIMED_OUT' });
      }
      if (/net::ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(messageText)) {
        throw Object.assign(new Error('The host could not be resolved.'), {
          code: 'DNS_RESOLUTION_FAILED'
        });
      }
      throw Object.assign(new Error('Navigation failed.'), { code: 'NAVIGATION_ABORTED' });
    }

    const finalUrl = page.url();
    const status = response?.status() ?? null;

    // Post-navigation policy check: redirects are followed by the browser, so
    // re-validate the final URL. A prohibited destination is refused here even
    // though the request already left (documented limitation of page.goto).
    const finalDecision = await evaluateUrlPolicy(finalUrl, { resolveHost, trustedOrigins });
    if (!finalDecision.allowed) {
      throw Object.assign(new Error('Navigation redirected to a prohibited destination.'), {
        code: 'NAVIGATION_ABORTED',
        detail: finalDecision.reason
      });
    }

    const headers = response?.headers() ?? {};
    const contentType = headers['content-type'];

    // Redirect accounting: refuse an over-long chain rather than extracting.
    if (followRedirects === false && finalUrl !== requestedUrl) {
      throw Object.assign(new Error('Redirects are disabled for this extraction.'), {
        code: 'NAVIGATION_ABORTED'
      });
    }
    void maxRedirects;

    if (!contentTypeAllowed(contentType, allowedContentTypes)) {
      const page: NormalizedPage = {
        requestedUrl,
        finalUrl,
        httpStatus: status,
        title: '',
        metaDescription: null,
        canonicalUrl: null,
        robotsMeta: null,
        headings: [],
        internalLinks: [],
        externalLinks: [],
        images: [],
        metrics: { loadTimeMs: 0, domContentLoadedTimeMs: 0, domNodeCount: 0 },
        authStatus: 'unknown',
        loginSignals: createEmptyLoginSignals(),
        status: 'skipped',
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
        errorMessage: `Content type "${contentType ?? 'unknown'}" is not extractable.`,
        warnings: [],
        capturedAt: new Date().toISOString()
      };
      const payload: ExtractResultPayload = {
        command: 'extract',
        sessionId: message.payload.sessionId,
        page
      };
      return payload;
    }

    // Playwright joins multiple `set-cookie` headers with a newline in the
    // headers() map; split them so each cookie's NAME can be derived. Only the
    // name is retained downstream - never the cookie value.
    const setCookieHeaders = (headers['set-cookie'] ?? '')
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const evidence: PageExtraction = await extractPageEvidence(page as never, {
      requestedUrl,
      finalUrl,
      httpStatus: status,
      responseHeaders: headers,
      setCookieHeaders
    });
    const normalized = normalizeExtraction(evidence, { scope });
    const payload: ExtractResultPayload = {
      command: 'extract',
      sessionId: message.payload.sessionId,
      page: normalized
    };
    // Phase 8 clone: optionally return the raw HTML body, bounded and flagged.
    if (message.payload.captureHtml === true) {
      payload.rawHtml = await captureRawHtml(page);
    }
    return payload;
  } finally {
    session.activeAbort = null;
    await page.close().catch(() => undefined);
  }
}

/**
 * In-page expression that collects the page's referenced asset URLs (stylesheet
 * links, script sources, image src/srcset, media sources, and `url(...)` refs in
 * inline styles). Returns absolute URLs, deduplicated and capped; it is a
 * read-only DOM walk (no page script is executed to build it beyond the browser
 * already having run).
 */
const ASSET_URL_PROBE = `(() => {
  var out = [];
  var seen = {};
  var push = function (u, type) {
    if (!u) return;
    try { u = new URL(u, document.baseURI).href; } catch (e) { return; }
    if (!/^https?:/i.test(u)) return;
    if (seen[u]) return;
    seen[u] = true;
    out.push({ url: u, type: type });
  };
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (el) { push(el.getAttribute('href'), 'stylesheet'); });
  document.querySelectorAll('script[src]').forEach(function (el) { push(el.getAttribute('src'), 'script'); });
  document.querySelectorAll('img[src]').forEach(function (el) { push(el.getAttribute('src'), 'image'); });
  document.querySelectorAll('img[srcset], source[srcset]').forEach(function (el) {
    (el.getAttribute('srcset') || '').split(',').forEach(function (part) { push((part.trim().split(/\\s+/)[0]) || '', 'image'); });
  });
  document.querySelectorAll('source[src], video[src], audio[src]').forEach(function (el) { push(el.getAttribute('src'), 'other'); });
  document.querySelectorAll('[style]').forEach(function (el) {
    var style = el.getAttribute('style') || '';
    var re = /url\\((['"]?)([^'")]+)\\1\\)/g; var m;
    while ((m = re.exec(style)) !== null) { push(m[2], 'font'); }
  });
  document.querySelectorAll('link[rel~="icon"][href], link[rel~="manifest"][href]').forEach(function (el) { push(el.getAttribute('href'), 'image'); });
  return out;
})()`;

interface AssetUrlRef {
  url: string;
  type: string;
}

/** Classify a captured asset into the `scan_assets.asset_type` check domain. */
function classifyAssetType(
  hint: string,
  mimeType: string
): CapturedAsset['assetType'] {
  const mime = mimeType.toLowerCase();
  if (mime.includes('css') || hint === 'stylesheet') return 'stylesheet';
  if (mime.includes('javascript') || hint === 'script') return 'script';
  if (mime.includes('font') || mime.includes('woff') || hint === 'font') return 'font';
  if (mime.startsWith('image/') || hint === 'image') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('json') || mime.includes('xml')) return 'document';
  return 'other';
}

/**
 * Fetch the referenced assets of `url` for the static clone engine (Phase 8).
 * Every asset URL is checked against the shared URL policy BEFORE it is
 * requested (exactly as navigation boundaries are); bytes are read in the page
 * context so same-origin cookies apply, then bounded and returned as base64.
 * Assets that fail a check or exceed a cap are counted in `skipped`.
 */
async function handleCaptureAssets(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'captureAssets') {
    throw new Error('captureAssets handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }

  const requestedUrl = message.payload.url;
  const maxAssets = Math.min(message.payload.maxAssets ?? MAX_ASSET_COUNT, MAX_ASSET_COUNT);
  const maxAssetBytes = Math.min(message.payload.maxAssetBytes ?? MAX_ASSET_BYTES, MAX_ASSET_BYTES);
  const trustedOrigins = [new URL(requestedUrl).origin];
  const decision = await evaluateUrlPolicy(requestedUrl, { resolveHost, trustedOrigins });
  if (!decision.allowed) {
    throw Object.assign(new Error(`Navigation blocked by the URL policy (${decision.reason}).`), {
      code: 'INVALID_URL',
      detail: decision.detail
    });
  }

  const abort = new AbortController();
  session.activeAbort = abort;
  const page = await session.context.newPage();
  const trustedHosts = new Set<string>([new URL(requestedUrl).hostname.toLowerCase()]);

  try {
    await installRouteGuard(page, trustedHosts);
    let status: number | null = null;
    let response: PlaywrightResponse | null;
    try {
      response = await page.goto(requestedUrl, {
        timeout: clampTimeout(message.payload.timeoutMs),
        waitUntil: 'load'
      });
    } catch (error) {
      if (abort.signal.aborted) {
        throw Object.assign(new Error('Asset capture was cancelled.'), { code: 'USER_CANCELLED' });
      }
      const messageText = error instanceof Error ? error.message : 'Navigation failed.';
      if (/timeout/i.test(messageText)) {
        throw Object.assign(new Error('Asset capture navigation timed out.'), {
          code: 'CONNECTION_TIMED_OUT'
        });
      }
      throw Object.assign(new Error(messageText), { code: 'NAVIGATION_ABORTED' });
    }
    status = response ? response.status() : null;
    const finalUrl = page.url();

    const refs = await page.evaluate<AssetUrlRef[]>(ASSET_URL_PROBE);
    const assets: CapturedAsset[] = [];
    const seenHashes = new Set<string>();
    let skipped = 0;
    let truncated = false;

    for (const ref of refs) {
      if (assets.length >= maxAssets) {
        truncated = true;
        break;
      }
      // Every asset URL is policy-checked before it is requested.
      const assetDecision = await evaluateUrlPolicy(ref.url, { resolveHost, trustedOrigins });
      if (!assetDecision.allowed) {
        skipped += 1;
        continue;
      }
      const fetched = await fetchAssetBytes(page, ref.url, maxAssetBytes);
      if (!fetched) {
        skipped += 1;
        continue;
      }
      const sha256 = createHash('sha256').update(fetched.bytes).digest('hex');
      if (seenHashes.has(sha256)) {
        continue;
      }
      seenHashes.add(sha256);
      assets.push({
        sourceUrl: ref.url,
        mimeType: fetched.mimeType,
        assetType: classifyAssetType(ref.type, fetched.mimeType),
        sizeBytes: fetched.bytes.length,
        sha256,
        base64: Buffer.from(fetched.bytes).toString('base64')
      });
    }

    const payload: CaptureAssetsResultPayload = {
      command: 'captureAssets',
      sessionId: message.payload.sessionId,
      url: requestedUrl,
      finalUrl,
      status,
      assets,
      skipped,
      truncated
    };
    return payload;
  } finally {
    session.activeAbort = null;
    await page.close().catch(() => undefined);
  }
}

/**
 * Fetch one asset's bytes inside the page context (so same-origin cookies and
 * the browser's TLS/DNS stack apply), returning null when it fails or exceeds
 * the per-asset cap. The bytes are base64 in transit; the MIME type is taken
 * from the response. No cookie/token value is ever read out.
 */
async function fetchAssetBytes(
  page: PlaywrightPage,
  url: string,
  maxBytes: number
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const expression = `(async () => {
    try {
      var res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!res.ok) return { ok: false };
      var buf = await res.arrayBuffer();
      if (buf.byteLength > ${maxBytes}) return { ok: false, oversize: true };
      var bytes = new Uint8Array(buf);
      var binary = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { ok: true, base64: btoa(binary), mimeType: res.headers.get('content-type') || '' };
    } catch (e) { return { ok: false }; }
  })()`;
  try {
    const result = await page.evaluate<{
      ok: boolean;
      base64?: string;
      mimeType?: string;
    }>(expression);
    if (!result || result.ok !== true || typeof result.base64 !== 'string') {
      return null;
    }
    const bytes = new Uint8Array(Buffer.from(result.base64, 'base64'));
    if (bytes.length > maxBytes) {
      return null;
    }
    const mimeType: string =
      (result.mimeType ?? '').split(';')[0]?.trim() || 'application/octet-stream';
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

async function handleAbort(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'abort') {
    throw new Error('abort handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (session?.activeAbort) {
    session.activeAbort.abort();
  }
  const payload = { command: 'abort' as const, sessionId: message.payload.sessionId };
  return payload;
}

async function handleClose(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'close') {
    throw new Error('close handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (session) {
    sessions.delete(message.payload.sessionId);
    session.activeAbort?.abort();
    // Close the isolated context first (drops all injected cookies/storage),
    // then the browser. No profile directory is written to disk.
    await session.context.close().catch(() => undefined);
    await session.browser.close();
    emitEvent('browser.closed', { sessionId: message.payload.sessionId });
  }
  const payload: CloseResultPayload = { command: 'close', sessionId: message.payload.sessionId };
  return payload;
}

/**
 * Inspect a URL for login-wall indicators without extracting page data. Used to
 * verify the injected session still authenticates before a scan relies on it.
 * The same URL policy is applied as a normal navigation; only presence signals
 * are returned (never page content or secrets).
 */
async function handleDetectLogin(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'detectLogin') {
    throw new Error('detectLogin handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }

  const requestedUrl = message.payload.url;
  const trustedOrigins = [new URL(requestedUrl).origin];
  const decision = await evaluateUrlPolicy(requestedUrl, { resolveHost, trustedOrigins });
  if (!decision.allowed) {
    throw Object.assign(new Error(`Navigation blocked by the URL policy (${decision.reason}).`), {
      code: 'INVALID_URL',
      detail: decision.detail
    });
  }

  const page = await session.context.newPage();
  try {
    let response: PlaywrightResponse | null = null;
    let status: number | null = null;
    let finalUrl = requestedUrl;
    let navigationFailed = false;
    try {
      response = await page.goto(requestedUrl, {
        timeout: clampTimeout(message.payload.timeoutMs),
        waitUntil: 'load'
      });
      finalUrl = page.url();
      status = response?.status() ?? null;
    } catch {
      navigationFailed = true;
    }

    // A non-2xx status is itself a login/denied signal when no DOM is available.
    let domSignals = { hasPasswordField: false, hasCaptcha: false };
    if (!navigationFailed) {
      try {
        domSignals = await page.evaluate<{ hasPasswordField: boolean; hasCaptcha: boolean }>(
          LOGIN_PROBE_EXPRESSION
        );
      } catch {
        domSignals = { hasPasswordField: false, hasCaptcha: false };
      }
    }

    const signals: LoginDetectionSignals = {
      redirectedToLogin: finalUrl !== requestedUrl,
      hasPasswordField: domSignals.hasPasswordField === true,
      hasCaptcha: domSignals.hasCaptcha === true,
      httpStatus: status
    };

    const payload: DetectLoginResultPayload = {
      command: 'detectLogin',
      sessionId: message.payload.sessionId,
      url: requestedUrl,
      finalUrl,
      status,
      signals
    };
    return payload;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * In-page probe that returns the layout of anchor nodes plus the media-query
 * breakpoints the page's applied styles declare. Self-contained (no closures);
 * read-only - it never executes page scripts or reads credentials.
 */
const VIEWPORT_PROBE_SOURCE = `(() => {
  var MAX_NODES = 400;
  var results = [];
  var nodes = document.querySelectorAll('header, nav, main, section, article, aside, footer, [class], [id]');
  var truncate = false;
  for (var i = 0; i < nodes.length; i += 1) {
    if (results.length >= MAX_NODES) { truncate = true; break; }
    var el = nodes[i];
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/)[0] || '';
    var tag = el.tagName.toLowerCase();
    results.push({
      key: tag + (cls ? '.' + cls : '') + '#' + i,
      tagName: tag,
      selector: tag + (cls ? '.' + cls : ''),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      display: style.display,
      fontSize: parseFloat(style.fontSize) || 0
    });
  }
  var breakpoints = {};
  try {
    for (var s = 0; s < document.styleSheets.length; s += 1) {
      var sheet = document.styleSheets[s];
      var rules = null;
      try { rules = sheet.cssRules; } catch (e) { rules = null; }
      if (!rules) { continue; }
      for (var r = 0; r < rules.length; r += 1) {
        var rule = rules[r];
        if (rule && rule.media && rule.media.mediaText) {
          var m = rule.media.mediaText.match(/(\\d+)px/g) || [];
          for (var k = 0; k < m.length; k += 1) { breakpoints[parseInt(m[k], 10)] = true; }
        }
      }
    }
  } catch (e) { /* cross-origin sheets are skipped */ }
  var bp = Object.keys(breakpoints).map(function (v) { return parseInt(v, 10); }).sort(function (a, b) { return a - b; });
  return { elements: results, breakpoints: bp, truncated: truncate };
})()`;

/**
 * Render `url` under ONE emulation profile in a fresh context and return a
 * full-page screenshot plus a bounded visible-element map and the media-query
 * breakpoints the page declares (RESPONSIVE-SPEC sections 1-2). The context is
 * isolated and always closed; the screenshot is returned as base64 for the host
 * to persist and is dropped (with `truncated:true`) when it exceeds the cap.
 */
async function handleCaptureViewport(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'captureViewport') {
    throw new Error('captureViewport handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (!session) {
    throw Object.assign(new Error(`Unknown session "${message.payload.sessionId}".`), {
      code: 'PLAYWRIGHT_CRASHED'
    });
  }

  const requestedUrl = message.payload.url;
  const profile = message.payload.profile;
  const trustedOrigins = [new URL(requestedUrl).origin];
  const decision = await evaluateUrlPolicy(requestedUrl, { resolveHost, trustedOrigins });
  if (!decision.allowed) {
    throw Object.assign(new Error(`Navigation blocked by the URL policy (${decision.reason}).`), {
      code: 'INVALID_URL',
      detail: decision.detail
    });
  }

  // A dedicated context per viewport, so emulation never leaks into the scan
  // session. The injected session (if any) is replayed read-only; it is never
  // written to disk here.
  const contextOptions: {
    storageState?: unknown;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  } = {
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch
  };
  if (session.authState) {
    contextOptions.storageState = toPlaywrightStorageState(session.authState);
  }

  const context = await session.browser.newContext(contextOptions);
  const page = await context.newPage();
  try {
    const abort = new AbortController();
    session.activeAbort = abort;
    await installRouteGuard(page, new Set<string>([new URL(requestedUrl).hostname.toLowerCase()]));

    let response: PlaywrightResponse | null = null;
    let finalUrl = requestedUrl;
    let status: number | null = null;
    try {
      response = await page.goto(requestedUrl, {
        timeout: clampTimeout(message.payload.timeoutMs),
        waitUntil: 'load'
      });
      finalUrl = page.url();
      status = response?.status() ?? null;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Navigation failed.';
      if (abort.signal.aborted) {
        throw Object.assign(new Error('Viewport capture was cancelled.'), {
          code: 'USER_CANCELLED'
        });
      }
      if (/timeout/i.test(messageText)) {
        throw Object.assign(new Error('Viewport capture timed out.'), {
          code: 'CONNECTION_TIMED_OUT'
        });
      }
      throw error;
    }

    let probe: { elements: ViewportElementNode[]; breakpoints: number[]; truncated: boolean } = {
      elements: [],
      breakpoints: [],
      truncated: false
    };
    try {
      // The probe is an arrow-function expression; Playwright invokes it. Guard
      // the result so a non-object return (or a cross-origin failure) never
      // leaves `probe` undefined.
      const raw = await page.evaluate<unknown>(VIEWPORT_PROBE_SOURCE);
      if (isPlainRecord(raw)) {
        probe = {
          elements: Array.isArray(raw.elements) ? (raw.elements as ViewportElementNode[]) : [],
          breakpoints: Array.isArray(raw.breakpoints) ? (raw.breakpoints as number[]) : [],
          truncated: raw.truncated === true
        };
      } else {
        probe = { elements: [], breakpoints: [], truncated: true };
      }
    } catch {
      probe = { elements: [], breakpoints: [], truncated: true };
    }

    let screenshotBase64: string | null = null;
    let truncated = probe.truncated === true;
    try {
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      const base64 = Buffer.from(png).toString('base64');
      if (base64.length <= MAX_SCREENSHOT_BASE64_BYTES) {
        screenshotBase64 = base64;
      } else {
        truncated = true;
      }
    } catch {
      truncated = true;
    }

    const payload: CaptureViewportResultPayload = {
      command: 'captureViewport',
      sessionId: message.payload.sessionId,
      url: requestedUrl,
      finalUrl,
      status,
      profile,
      screenshotBase64,
      detectedBreakpoints: Array.isArray(probe.breakpoints) ? probe.breakpoints : [],
      elements: Array.isArray(probe.elements)
        ? probe.elements.map((node) => ({
            key: String(node.key),
            tagName: String(node.tagName),
            selector: String(node.selector),
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            width: Number(node.width) || 0,
            height: Number(node.height) || 0,
            visible: node.visible === true,
            display: String(node.display),
            fontSize: Number(node.fontSize) || 0
          }))
        : [],
      truncated
    };
    return payload;
  } finally {
    session.activeAbort = null;
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

async function dispatch(message: WorkerCommandMessage): Promise<void> {
  try {
    let payload: WorkerResultPayload;
    switch (message.payload.command) {
      case 'ping':
        payload = await handlePing();
        break;
      case 'launch':
        payload = await handleLaunch(message);
        break;
      case 'navigate':
        payload = await handleNavigate(message);
        break;
      case 'extract':
        payload = await handleExtract(message);
        break;
      case 'abort':
        payload = await handleAbort(message);
        break;
      case 'close':
        payload = await handleClose(message);
        break;
      case 'detectLogin':
        payload = await handleDetectLogin(message);
        break;
      case 'captureState':
        payload = await handleCaptureState(message);
        break;
      case 'captureViewport':
        payload = await handleCaptureViewport(message);
        break;
      case 'captureAssets':
        payload = await handleCaptureAssets(message);
        break;
      default:
        throw Object.assign(new Error('Unsupported command.'), {
          code: 'WORKER_PROTOCOL_VIOLATION'
        });
    }
    write(createResultMessage(message.id, payload));
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'PLAYWRIGHT_CRASHED';
    const text = error instanceof Error ? error.message : 'Worker command failed.';
    log('error', `${message.payload.command} failed: ${text}`);
    write(
      createResultMessage(message.id, { command: message.payload.command } as WorkerResultPayload, {
        code: code as never,
        category: 'browser',
        message: text,
        severity: 'error',
        recoverable: true,
        retryable: false,
        suggestedAction: 'Retry the browser operation.',
        timestamp: new Date().toISOString()
      })
    );
  }
}

// ---------------------------------------------------------------------------
// stdio loop
// ---------------------------------------------------------------------------

let buffer = '';

function onChunk(chunk: string): void {
  buffer += chunk;
  const decoded = decodeFrames(buffer);
  buffer = decoded.remainder;
  if (decoded.oversize > 0) {
    log('warn', `Dropped ${decoded.oversize} oversized frame(s).`);
  }
  for (const frame of decoded.frames) {
    const parsed = parseMessage(frame);
    if (!parsed.ok) {
      // Report and continue: a single malformed frame must not kill the worker.
      write(
        createErrorMessage({
          code: parsed.error.code,
          message: parsed.error.message
        })
      );
      continue;
    }
    if (parsed.message.type !== 'command') {
      // The worker only accepts commands; anything else is a protocol misuse.
      write(
        createErrorMessage({
          code: 'WORKER_PROTOCOL_VIOLATION',
          message: `Worker cannot handle "${parsed.message.type}" frames.`
        })
      );
      continue;
    }
    void dispatch(parsed.message);
  }
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const [sessionId, session] of sessions) {
    sessions.delete(sessionId);
    session.activeAbort?.abort();
    try {
      await session.context.close();
    } catch {
      // Best-effort cleanup on shutdown.
    }
    try {
      await session.browser.close();
    } catch {
      // Best-effort cleanup on shutdown.
    }
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => onChunk(`${line}\n`));
  rl.on('close', () => {
    void shutdown(0);
  });
  process.stdin.on('end', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
  process.on('SIGINT', () => {
    void shutdown(0);
  });

  log('info', `Crawler worker ready (v${WORKER_VERSION}).`);
}

void main();
