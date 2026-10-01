/**
 * Worker protocol - Artupski ReSite
 * Source of truth: docs/architecture/WORKER-PROTOCOL.md.
 *
 * The Playwright worker is a dedicated Node.js child process that speaks a
 * newline-delimited JSON message stream over stdio (never a WebSocket, so the
 * webview CSP `connect-src` is not widened). This module is the single,
 * versioned contract shared by the TypeScript host (ProcessManager /
 * browserRuntime) and the worker entrypoint:
 *
 * - every frame is a typed envelope `{ protocolVersion, id, type, payload, error? }`;
 * - `id` is a correlation id tying a `result` back to the `command` that caused it;
 * - the protocol version is an integer and any unknown version is rejected;
 * - serialization is deterministic (stable key order) so frames are diffable;
 * - every message crossing the boundary is validated at runtime; malformed
 *   frames are reported as `WORKER_PROTOCOL_VIOLATION`, never silently accepted.
 *
 * Nothing here knows about Playwright, React, or Tauri - it is pure data.
 */
// NOTE: `.ts` extensions are required so the dedicated Node worker (which runs
// these files via Node's native type stripping) can resolve the import chain.
import { createProcessError, type ProcessErrorCode } from './processErrors.ts';
import type { StructuredError } from './errors.ts';
import type { NormalizedPage } from '../scanner/extraction/types.ts';

// Re-exported so host consumers can type the `extract` result from the single
// protocol module without reaching into the scanner internals.
export type { NormalizedPage };

/**
 * Integer protocol version. Bump only on a breaking wire-format change; the
 * host and worker both reject frames that do not carry the exact version.
 */
export const WORKER_PROTOCOL_VERSION = 1;

/** Maximum size of a single serialized frame (1 MiB) to bound buffering. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export type WorkerMessageType = 'command' | 'result' | 'event' | 'log' | 'error';

/** Browser engines the worker can control. Chromium-only for the Phase 3 MVP. */
export type BrowserEngine = 'chromium';

/** The closed set of operations the worker understands. */
export type WorkerCommandName =
  | 'ping'
  | 'launch'
  | 'navigate'
  | 'close'
  | 'extract'
  | 'abort'
  | 'detectLogin'
  | 'captureState'
  | 'captureViewport';

/**
 * A per-domain storage state the host injects into a browser context.
 * Deliberately loose (`Record<string, string>` for storage) because the worker
 * must not depend on host domain types; the host validates the shape before it
 * is ever sent, and the worker re-validates on receipt.
 */
export interface AuthStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Record<string, string>;
    sessionStorage?: Record<string, string>;
  }>;
}

/** Signals the worker reports when classifying a page as an auth wall. */
export interface LoginDetectionSignals {
  /** Redirect (or SPA route) landed on a known login path. */
  redirectedToLogin: boolean;
  /** A password input / sign-in form was present on the final page. */
  hasPasswordField: boolean;
  /** A CAPTCHA / WAF challenge marker was present. */
  hasCaptcha: boolean;
  /** Non-2xx status observed (401/403/429) when no page could be extracted. */
  httpStatus: number | null;
}

/** Default content types the crawler will extract; anything else is skipped. */
export const DEFAULT_EXTRACTABLE_CONTENT_TYPES: readonly string[] = [
  'text/html',
  'application/xhtml+xml'
];

/** Hard ceiling on the number of redirects a single extraction may follow. */
export const MAX_EXTRACT_REDIRECTS = 5;

/** Upper bound for any viewport width/height (defends against pathological emulation). */
export const MAX_VIEWPORT_DIMENSION = 4320;

/**
 * Upper bound for a captured screenshot payload (12 MiB of base64 PNG). The
 * worker drops the image (keeping the element map) when a capture exceeds this,
 * so one pathological page cannot exhaust the stdio frame budget.
 */
export const MAX_SCREENSHOT_BASE64_BYTES = 12 * 1024 * 1024;

/** The standard responsive profiles (RESPONSIVE-SPEC section 1.1). Desktop first. */
export const RESPONSIVE_VIEWPORT_PROFILES: readonly ViewportProfile[] = [
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
  { name: 'mobile', width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
];

// ---------------------------------------------------------------------------
// Command payloads (host -> worker)
// ---------------------------------------------------------------------------

export interface PingCommandPayload {
  command: 'ping';
}

export interface LaunchCommandPayload {
  command: 'launch';
  engine: BrowserEngine;
  headless: boolean;
  /**
   * Capture intent (AUTH-SCANNING.md section 2.1). When true this launch is a
   * headed, user-in-the-loop interactive session: the worker MUST reject any
   * `authState`, and the host owns closing it via `close`. It is a distinct,
   * auditable intent, not merely `headless === false`, so a capture context can
   * never silently be treated as a scan context.
   */
  capture?: boolean;
  /** Optional explicit executable; when omitted Playwright resolves its own. */
  executablePath?: string;
  /**
   * Optional captured storage state to isolate into this session's context.
   * When present, the worker creates an explicit context with this state so a
   * plain `launch()` (no state) can never inherit it. The state is never
   * echoed back in any result/log/event frame.
   */
  authState?: AuthStorageState;
}

export interface NavigateCommandPayload {
  command: 'navigate';
  sessionId: string;
  url: string;
  /** Navigation timeout in ms. The worker clamps this to <= 30000. */
  timeoutMs: number;
}

export interface CloseCommandPayload {
  command: 'close';
  sessionId: string;
}

/**
 * Navigate to `url`, extract Phase 4 page data, and return a normalized result.
 * The worker validates every navigation/redirect boundary against the URL
 * policy before the browser is allowed to reach it.
 */
export interface ExtractCommandPayload {
  command: 'extract';
  sessionId: string;
  url: string;
  /** Navigation timeout in ms. The worker clamps this to <= 30000. */
  timeoutMs: number;
  /** Whether redirects may be followed (each target is policy-checked). Default true. */
  followRedirects?: boolean;
  /** Content types eligible for extraction. Defaults to HTML only. */
  allowedContentTypes?: string[];
  /** Maximum redirects to follow. Defaults to and is capped at 5. */
  maxRedirects?: number;
}

/** Cancel an in-flight extraction for a session. */
export interface AbortCommandPayload {
  command: 'abort';
  sessionId: string;
}

/**
 * Inspect a URL (using the session's stored auth state) for login-wall
 * indicators WITHOUT extracting page data. Used to verify the stored session
 * still authenticates before a scan relies on it.
 */
export interface DetectLoginCommandPayload {
  command: 'detectLogin';
  sessionId: string;
  url: string;
  /** Navigation timeout in ms. The worker clamps this to <= 30000. */
  timeoutMs: number;
}

/**
 * Capture the current storage state out of an interactive (headed) session's
 * context after the user has completed login manually (AUTH-SCANNING.md section
 * 2.1). The worker returns the state so the HOST can encrypt and persist it; the
 * worker itself never writes it to disk, logs it, or echoes it in any event.
 *
 * The state is scoped to `scopeHost`: cookies whose domain does not match and
 * origins whose hostname is not the scope host are dropped, so a capture can
 * never persist state for an unrelated origin.
 */
export interface CaptureStateCommandPayload {
  command: 'captureState';
  sessionId: string;
  /** Hostname the capture is scoped to (the interactive login target). */
  scopeHost: string;
}

/** The three standard responsive viewport profiles (RESPONSIVE-SPEC section 1.1). */
export type ViewportProfileName = 'desktop' | 'tablet' | 'mobile';

/**
 * A concrete emulation profile. Bounded by the host before it is ever sent: the
 * width/height must fall inside `MAX_VIEWPORT_DIMENSION`. The worker only ever
 * receives one profile per `captureViewport` so a single navigation/screenshot
 * cannot be conflated with another's state.
 */
export interface ViewportProfile {
  name: ViewportProfileName;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

/**
 * Capture a full-page screenshot plus a visible-element map for ONE viewport
 * profile (RESPONSIVE-SPEC section 2.1). The screenshot is returned as a bounded
 * base64 PNG; the host writes it to disk. The element map records each anchor
 * node's bounding box and visibility so the host can diff breakpoints. No secret
 * material is involved and the page is never scripted beyond the read-only probes.
 */
export interface CaptureViewportCommandPayload {
  command: 'captureViewport';
  sessionId: string;
  url: string;
  /** Navigation timeout in ms. The worker clamps this to <= 30000. */
  timeoutMs: number;
  /** The single emulation profile to render this page under. */
  profile: ViewportProfile;
}

export type WorkerCommandPayload =
  | PingCommandPayload
  | LaunchCommandPayload
  | NavigateCommandPayload
  | CloseCommandPayload
  | ExtractCommandPayload
  | AbortCommandPayload
  | DetectLoginCommandPayload
  | CaptureStateCommandPayload
  | CaptureViewportCommandPayload;

// ---------------------------------------------------------------------------
// Result payloads (worker -> host)
// ---------------------------------------------------------------------------

/** Browser availability reported by the worker without downloading anything. */
export interface BrowserAvailability {
  engine: BrowserEngine;
  installed: boolean;
  executablePath?: string;
  version?: string;
}

export interface PingResultPayload {
  command: 'ping';
  pong: true;
  workerVersion: string;
  /** Present when the worker probed browser availability during the handshake. */
  browser?: BrowserAvailability;
}

export interface LaunchResultPayload {
  command: 'launch';
  sessionId: string;
  engine: BrowserEngine;
  version: string;
}

export interface NavigateResultPayload {
  command: 'navigate';
  sessionId: string;
  url: string;
  status: number | null;
  title: string;
}

export interface CloseResultPayload {
  command: 'close';
  sessionId: string;
}

export interface ExtractResultPayload {
  command: 'extract';
  sessionId: string;
  /** Normalized, bounded page result (raw evidence is never sent to the host). */
  page: NormalizedPage;
}

export interface AbortResultPayload {
  command: 'abort';
  sessionId: string;
}

export interface DetectLoginResultPayload {
  command: 'detectLogin';
  sessionId: string;
  url: string;
  /** Final URL after any redirects (login redirect detection compares these). */
  finalUrl: string;
  status: number | null;
  signals: LoginDetectionSignals;
}

/**
 * The storage state captured from an interactive session, already scoped to the
 * requested host by the worker. Carried host-side only long enough to encrypt
 * and persist; it is never logged, never emitted as an event, and never written
 * to disk by the worker.
 */
export interface CaptureStateResultPayload {
  command: 'captureState';
  sessionId: string;
  /** Host the capture was scoped to (echoed for host-side validation). */
  scopeHost: string;
  /** Scoped storage state; the host encrypts and persists it. */
  storageState: AuthStorageState;
  cookieCount: number;
  originCount: number;
}

/** One anchor node's layout at a specific viewport (RESPONSIVE-SPEC section 2.1). */
export interface ViewportElementNode {
  /** Stable-ish identity derived from tag + first class + index (no PII). */
  key: string;
  tagName: string;
  selector: string;
  /** Bounding box in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  display: string;
  /** Computed font size in px, for typography diffing. */
  fontSize: number;
}

export interface CaptureViewportResultPayload {
  command: 'captureViewport';
  sessionId: string;
  url: string;
  finalUrl: string;
  status: number | null;
  /** Echo of the emulated profile so the host can key the capture. */
  profile: ViewportProfile;
  /** Bounded base64 PNG, or null when the capture was skipped/too large. */
  screenshotBase64: string | null;
  /** Media-query breakpoints detected in the page's applied styles (px, sorted). */
  detectedBreakpoints: number[];
  /** Bounded list of anchor nodes with their layout at this viewport. */
  elements: ViewportElementNode[];
  /** True when the element list or screenshot was truncated by a cap. */
  truncated: boolean;
}

export type WorkerResultPayload =
  | PingResultPayload
  | LaunchResultPayload
  | NavigateResultPayload
  | CloseResultPayload
  | ExtractResultPayload
  | AbortResultPayload
  | DetectLoginResultPayload
  | CaptureStateResultPayload
  | CaptureViewportResultPayload;

// ---------------------------------------------------------------------------
// Event / log / error payloads
// ---------------------------------------------------------------------------

export type WorkerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WorkerEventPayload {
  /** Dotted worker event name, e.g. `browser.launched`. */
  event: string;
  data?: Record<string, unknown>;
}

export interface WorkerLogPayload {
  level: WorkerLogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface WorkerEnvelope<TType extends WorkerMessageType, TPayload> {
  protocolVersion: number;
  id: string;
  type: TType;
  payload: TPayload;
  /** Present on `result`/`error` frames that describe a failure. */
  error?: StructuredError;
}

export type WorkerCommandMessage = WorkerEnvelope<'command', WorkerCommandPayload>;
export type WorkerResultMessage = WorkerEnvelope<'result', WorkerResultPayload>;
export type WorkerEventMessage = WorkerEnvelope<'event', WorkerEventPayload>;
export type WorkerLogMessage = WorkerEnvelope<'log', WorkerLogPayload>;
export type WorkerErrorMessage = WorkerEnvelope<'error', WorkerErrorPayload>;

export type WorkerMessage =
  | WorkerCommandMessage
  | WorkerResultMessage
  | WorkerEventMessage
  | WorkerLogMessage
  | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// Serialization (deterministic)
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys are emitted in sorted order at every depth. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serialize a message into a single newline-terminated frame.
 * Throws when the frame exceeds `MAX_FRAME_BYTES`.
 */
export function serializeMessage(message: WorkerMessage): string {
  const json = stableStringify(message);
  if (json.length > MAX_FRAME_BYTES) {
    throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
      message: `Refusing to serialize a frame of ${json.length} bytes: it exceeds the ${MAX_FRAME_BYTES} byte limit.`
    });
  }
  return `${json}\n`;
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

const MESSAGE_TYPES: readonly WorkerMessageType[] = ['command', 'result', 'event', 'log', 'error'];

const COMMAND_NAMES: readonly WorkerCommandName[] = [
  'ping',
  'launch',
  'navigate',
  'close',
  'extract',
  'abort',
  'detectLogin',
  'captureState',
  'captureViewport'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCommandName(value: unknown): value is WorkerCommandName {
  return typeof value === 'string' && (COMMAND_NAMES as readonly string[]).includes(value);
}

/**
 * Structural validation for an injected storage state. Bounded so a hostile
 * (or corrupt) payload cannot smuggle an oversized or malformed context into
 * the worker; a bad shape is rejected at the protocol boundary.
 */
export function isAuthStorageState(value: unknown): value is AuthStorageState {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.cookies) || value.cookies.length > 500) {
    return false;
  }
  if (!Array.isArray(value.origins) || value.origins.length > 50) {
    return false;
  }
  const cookieOk = value.cookies.every(
    (cookie) =>
      isRecord(cookie) &&
      isNonEmptyString(cookie.name) &&
      typeof cookie.value === 'string' &&
      isNonEmptyString(cookie.domain) &&
      typeof cookie.path === 'string'
  );
  if (!cookieOk) {
    return false;
  }
  return value.origins.every(
    (origin) =>
      isRecord(origin) &&
      isNonEmptyString(origin.origin) &&
      isRecord(origin.localStorage) &&
      (origin.sessionStorage === undefined || isRecord(origin.sessionStorage))
  );
}

/** Structural + bounded check for a viewport profile. */
export function isViewportProfile(value: unknown): value is ViewportProfile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.name === 'desktop' || value.name === 'tablet' || value.name === 'mobile') &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    value.width <= MAX_VIEWPORT_DIMENSION &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    value.height <= MAX_VIEWPORT_DIMENSION &&
    typeof value.deviceScaleFactor === 'number' &&
    Number.isFinite(value.deviceScaleFactor) &&
    value.deviceScaleFactor >= 1 &&
    value.deviceScaleFactor <= 4 &&
    typeof value.isMobile === 'boolean' &&
    typeof value.hasTouch === 'boolean'
  );
}

function validateCommandPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !isCommandName(payload.command)) {
    return false;
  }
  switch (payload.command) {
    case 'ping':
      return true;
    case 'launch':
      return (
        payload.engine === 'chromium' &&
        typeof payload.headless === 'boolean' &&
        (payload.capture === undefined || typeof payload.capture === 'boolean') &&
        // A capture context is user-in-the-loop and MUST NOT receive an injected
        // session, and a capture context MUST be headed. Enforced at the wire
        // boundary so the invariant cannot be violated by a future caller.
        (payload.capture !== true ||
          (payload.headless === false && payload.authState === undefined)) &&
        (payload.executablePath === undefined || isNonEmptyString(payload.executablePath)) &&
        (payload.authState === undefined || isAuthStorageState(payload.authState))
      );
    case 'navigate':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        typeof payload.timeoutMs === 'number' &&
        Number.isFinite(payload.timeoutMs)
      );
    case 'close':
      return isNonEmptyString(payload.sessionId);
    case 'extract':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        typeof payload.timeoutMs === 'number' &&
        Number.isFinite(payload.timeoutMs) &&
        (payload.followRedirects === undefined || typeof payload.followRedirects === 'boolean') &&
        (payload.maxRedirects === undefined ||
          (typeof payload.maxRedirects === 'number' && Number.isInteger(payload.maxRedirects))) &&
        (payload.allowedContentTypes === undefined ||
          (Array.isArray(payload.allowedContentTypes) &&
            payload.allowedContentTypes.every((entry) => typeof entry === 'string')))
      );
    case 'abort':
      return isNonEmptyString(payload.sessionId);
    case 'detectLogin':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        typeof payload.timeoutMs === 'number' &&
        Number.isFinite(payload.timeoutMs)
      );
    case 'captureState':
      return isNonEmptyString(payload.sessionId) && isNonEmptyString(payload.scopeHost);
    case 'captureViewport':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        typeof payload.timeoutMs === 'number' &&
        Number.isFinite(payload.timeoutMs) &&
        isViewportProfile(payload.profile)
      );
    default:
      return false;
  }
}

function validateResultPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !isCommandName(payload.command)) {
    return false;
  }
  switch (payload.command) {
    case 'ping':
      return payload.pong === true && isNonEmptyString(payload.workerVersion);
    case 'launch':
      return (
        isNonEmptyString(payload.sessionId) &&
        payload.engine === 'chromium' &&
        isNonEmptyString(payload.version)
      );
    case 'navigate':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        (payload.status === null || typeof payload.status === 'number') &&
        typeof payload.title === 'string'
      );
    case 'close':
      return isNonEmptyString(payload.sessionId);
    case 'extract':
      return isNonEmptyString(payload.sessionId) && isNormalizedPageShape(payload.page);
    case 'abort':
      return isNonEmptyString(payload.sessionId);
    case 'detectLogin':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        isNonEmptyString(payload.finalUrl) &&
        (payload.status === null || typeof payload.status === 'number') &&
        isRecord(payload.signals)
      );
    case 'captureState':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.scopeHost) &&
        isAuthStorageState(payload.storageState) &&
        typeof payload.cookieCount === 'number' &&
        typeof payload.originCount === 'number'
      );
    case 'captureViewport':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        isNonEmptyString(payload.finalUrl) &&
        (payload.status === null || typeof payload.status === 'number') &&
        isViewportProfile(payload.profile) &&
        (payload.screenshotBase64 === null || typeof payload.screenshotBase64 === 'string') &&
        Array.isArray(payload.detectedBreakpoints) &&
        payload.detectedBreakpoints.every((entry) => typeof entry === 'number') &&
        Array.isArray(payload.elements) &&
        payload.elements.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.key === 'string' &&
            typeof entry.tagName === 'string' &&
            typeof entry.selector === 'string' &&
            typeof entry.visible === 'boolean'
        ) &&
        typeof payload.truncated === 'boolean'
      );
    default:
      return false;
  }
}

/**
 * Structural check of a normalized page result. The full type lives in
 * `extraction/types.ts`; this validates the fields the host relies on so a
 * malformed worker result is rejected at the protocol boundary.
 */
function isNormalizedPageShape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.requestedUrl === 'string' &&
    typeof value.finalUrl === 'string' &&
    (value.httpStatus === null || typeof value.httpStatus === 'number') &&
    typeof value.title === 'string' &&
    (value.metaDescription === null || typeof value.metaDescription === 'string') &&
    (value.canonicalUrl === null || typeof value.canonicalUrl === 'string') &&
    (value.robotsMeta === null || typeof value.robotsMeta === 'string') &&
    Array.isArray(value.headings) &&
    Array.isArray(value.internalLinks) &&
    Array.isArray(value.externalLinks) &&
    Array.isArray(value.images) &&
    isRecord(value.metrics) &&
    typeof value.status === 'string' &&
    (value.errorCode === null || typeof value.errorCode === 'string') &&
    (value.errorMessage === null || typeof value.errorMessage === 'string') &&
    Array.isArray(value.warnings) &&
    typeof value.capturedAt === 'string' &&
    typeof value.authStatus === 'string' &&
    isRecord(value.loginSignals)
  );
}

function validateEventPayload(payload: unknown): boolean {
  return isRecord(payload) && isNonEmptyString(payload.event);
}

function validateLogPayload(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.level === 'string' &&
    (['debug', 'info', 'warn', 'error'] as readonly string[]).includes(payload.level) &&
    typeof payload.message === 'string'
  );
}

function validateErrorPayload(payload: unknown): boolean {
  return isRecord(payload) && isNonEmptyString(payload.code) && typeof payload.message === 'string';
}

function validatePayload(type: WorkerMessageType, payload: unknown): boolean {
  switch (type) {
    case 'command':
      return validateCommandPayload(payload);
    case 'result':
      return validateResultPayload(payload);
    case 'event':
      return validateEventPayload(payload);
    case 'log':
      return validateLogPayload(payload);
    case 'error':
      return validateErrorPayload(payload);
    default:
      return false;
  }
}

/**
 * Validate a decoded value as a protocol message. Returns a reason string on
 * failure so callers can surface an actionable `WORKER_PROTOCOL_VIOLATION`.
 */
export function validateMessage(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: 'Message is not a JSON object.' };
  }
  if (!Number.isInteger(value.protocolVersion)) {
    return { ok: false, reason: 'Missing or non-integer protocolVersion.' };
  }
  if (value.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `Unsupported protocol version ${String(value.protocolVersion)} (expected ${WORKER_PROTOCOL_VERSION}).`
    };
  }
  if (!isNonEmptyString(value.id)) {
    return { ok: false, reason: 'Missing correlation id.' };
  }
  if (
    typeof value.type !== 'string' ||
    !(MESSAGE_TYPES as readonly string[]).includes(value.type)
  ) {
    return { ok: false, reason: `Unknown message type "${String(value.type)}".` };
  }
  if (value.error !== undefined && !isRecord(value.error)) {
    return { ok: false, reason: 'Malformed error field.' };
  }
  // A `result` frame carrying an error describes a failed command, so its
  // payload only needs the command discriminator (a placeholder is expected).
  if (value.type === 'result' && value.error !== undefined) {
    if (!isRecord(value.payload) || !isCommandName(value.payload.command)) {
      return { ok: false, reason: 'Invalid payload for "result" message.' };
    }
    return { ok: true };
  }
  if (!validatePayload(value.type as WorkerMessageType, value.payload)) {
    return { ok: false, reason: `Invalid payload for "${value.type}" message.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Parsing (single frame)
// ---------------------------------------------------------------------------

export type ParseResult =
  { ok: true; message: WorkerMessage } | { ok: false; error: StructuredError };

/**
 * Parse one newline-delimited frame. Empty/whitespace-only frames are rejected
 * rather than ignored so a silent framing bug is never masked.
 */
export function parseMessage(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: createProtocolViolation('Received an empty frame.')
    };
  }
  if (trimmed.length > MAX_FRAME_BYTES) {
    return {
      ok: false,
      error: createProtocolViolation(
        `Frame of ${trimmed.length} bytes exceeds the ${MAX_FRAME_BYTES} byte limit.`
      )
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch (cause) {
    return { ok: false, error: createProtocolViolation('Frame is not valid JSON.', cause) };
  }

  const validation = validateMessage(decoded);
  if (!validation.ok) {
    return { ok: false, error: createProtocolViolation(validation.reason) };
  }

  return { ok: true, message: decoded as WorkerMessage };
}

/** Build a `WORKER_PROTOCOL_VIOLATION` structured error. */
export function createProtocolViolation(message: string, cause?: unknown): StructuredError {
  return createProcessError('WORKER_PROTOCOL_VIOLATION', { message, cause });
}

// ---------------------------------------------------------------------------
// Framing (stream buffering)
// ---------------------------------------------------------------------------

export interface FrameBufferResult {
  /** Fully-received, newline-terminated frames, in arrival order. */
  frames: string[];
  /** Trailing bytes not yet terminated by a newline. */
  remainder: string;
  /** Frames dropped because they exceeded `MAX_FRAME_BYTES`. */
  oversize: number;
}

/**
 * Split an accumulated stdio buffer into newline-delimited frames.
 *
 * Keeps a bounded remainder: if the unterminated tail exceeds the frame limit
 * it is discarded and counted, so a runaway worker cannot exhaust host memory.
 */
export function decodeFrames(buffer: string): FrameBufferResult {
  const frames: string[] = [];
  let rest = buffer;
  let oversize = 0;

  let newlineIndex = rest.indexOf('\n');
  while (newlineIndex !== -1) {
    const frame = rest.slice(0, newlineIndex);
    rest = rest.slice(newlineIndex + 1);
    if (frame.length > MAX_FRAME_BYTES) {
      oversize += 1;
    } else {
      frames.push(frame);
    }
    newlineIndex = rest.indexOf('\n');
  }

  if (rest.length > MAX_FRAME_BYTES) {
    oversize += 1;
    rest = '';
  }

  return { frames, remainder: rest, oversize };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let fallbackCounter = 0;

/** Generate a correlation id for a command. */
export function createMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `msg-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/** Build a typed command envelope with a fresh correlation id. */
export function createCommandMessage(
  payload: WorkerCommandPayload,
  id: string = createMessageId()
): WorkerCommandMessage {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, id, type: 'command', payload };
}

/** Build a typed result envelope correlating to a command id. */
export function createResultMessage(
  id: string,
  payload: WorkerResultPayload,
  error?: StructuredError
): WorkerResultMessage {
  return error
    ? { protocolVersion: WORKER_PROTOCOL_VERSION, id, type: 'result', payload, error }
    : { protocolVersion: WORKER_PROTOCOL_VERSION, id, type: 'result', payload };
}

/** Build a typed event envelope. */
export function createEventMessage(payload: WorkerEventPayload): WorkerEventMessage {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    id: createMessageId(),
    type: 'event',
    payload
  };
}

/** Build a typed log envelope. */
export function createLogMessage(payload: WorkerLogPayload): WorkerLogMessage {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, id: createMessageId(), type: 'log', payload };
}

/** Build a typed error envelope. */
export function createErrorMessage(payload: WorkerErrorPayload): WorkerErrorMessage {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    id: createMessageId(),
    type: 'error',
    payload
  };
}

/** Narrowing helpers used by consumers (kept explicit; no `any`). */
export function isResultMessage(message: WorkerMessage): message is WorkerResultMessage {
  return message.type === 'result';
}

export function isCommandMessage(message: WorkerMessage): message is WorkerCommandMessage {
  return message.type === 'command';
}

export function isErrorMessage(message: WorkerMessage): message is WorkerErrorMessage {
  return message.type === 'error';
}

export function isLogMessage(message: WorkerMessage): message is WorkerLogMessage {
  return message.type === 'log';
}

export function isEventMessage(message: WorkerMessage): message is WorkerEventMessage {
  return message.type === 'event';
}

/** Re-export for callers that need to type the code without importing errors. */
export type { ProcessErrorCode };
