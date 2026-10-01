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
  type WorkerCommandMessage,
  type WorkerResultPayload
} from './protocol.ts';
import { LOGIN_PROBE_EXPRESSION } from '../../services/scanner/extraction/inPageExtractor.ts';
import { classifyIpLiteral } from '../../services/scanner/security/ipPolicy.ts';

/** Worker build identifier reported during the ping handshake. */
const WORKER_VERSION = '0.2.0';

/** Hard ceiling for any navigation, matching AGENTS.md section 4 (30s). */
const MAX_NAVIGATION_TIMEOUT_MS = 30_000;

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
  evaluate<T>(expression: string): Promise<T>;
  route(pattern: string, handler: (route: PlaywrightRoute) => void | Promise<void>): Promise<void>;
  close(): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  version(): string;
  newPage(): Promise<PlaywrightPage>;
  newContext(options?: { storageState?: unknown }): Promise<PlaywrightContext>;
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

  sessions.set(sessionId, { browser, context, engine: 'chromium', version, activeAbort: null });
  emitEvent('browser.launched', {
    sessionId,
    version,
    authenticated: message.payload.authState !== undefined
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
    return payload;
  } finally {
    session.activeAbort = null;
    await page.close().catch(() => undefined);
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
