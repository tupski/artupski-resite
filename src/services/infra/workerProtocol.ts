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

/** The closed set of operations the worker understands in Phase 3. */
export type WorkerCommandName = 'ping' | 'launch' | 'navigate' | 'close';

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
  /** Optional explicit executable; when omitted Playwright resolves its own. */
  executablePath?: string;
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

export type WorkerCommandPayload =
  | PingCommandPayload
  | LaunchCommandPayload
  | NavigateCommandPayload
  | CloseCommandPayload;

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

export type WorkerResultPayload =
  | PingResultPayload
  | LaunchResultPayload
  | NavigateResultPayload
  | CloseResultPayload;

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

const COMMAND_NAMES: readonly WorkerCommandName[] = ['ping', 'launch', 'navigate', 'close'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCommandName(value: unknown): value is WorkerCommandName {
  return typeof value === 'string' && (COMMAND_NAMES as readonly string[]).includes(value);
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
        (payload.executablePath === undefined || isNonEmptyString(payload.executablePath))
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
      return isNonEmptyString(payload.sessionId) && payload.engine === 'chromium' && isNonEmptyString(payload.version);
    case 'navigate':
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.url) &&
        (payload.status === null || typeof payload.status === 'number') &&
        typeof payload.title === 'string'
      );
    case 'close':
      return isNonEmptyString(payload.sessionId);
    default:
      return false;
  }
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
  if (typeof value.type !== 'string' || !(MESSAGE_TYPES as readonly string[]).includes(value.type)) {
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
  | { ok: true; message: WorkerMessage }
  | { ok: false; error: StructuredError };

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
      error: createProtocolViolation(`Frame of ${trimmed.length} bytes exceeds the ${MAX_FRAME_BYTES} byte limit.`)
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
  return { protocolVersion: WORKER_PROTOCOL_VERSION, id: createMessageId(), type: 'event', payload };
}

/** Build a typed log envelope. */
export function createLogMessage(payload: WorkerLogPayload): WorkerLogMessage {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, id: createMessageId(), type: 'log', payload };
}

/** Build a typed error envelope. */
export function createErrorMessage(payload: WorkerErrorPayload): WorkerErrorMessage {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, id: createMessageId(), type: 'error', payload };
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
