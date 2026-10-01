/**
 * Crawler worker entrypoint - Artupski ReSite
 * Source of truth: docs/architecture/WORKER-PROTOCOL.md.
 *
 * A dedicated Node.js child process that speaks the versioned, newline-delimited
 * JSON protocol over stdio. Phase 3 is a *foundation*: it supports exactly
 * `ping`, `launch`, `navigate`, and `close` against a controlled browser, plus
 * runtime detection. It performs NO crawling, DOM/CSS/JS analysis, network
 * analysis, technology detection, or screenshots - those are later phases.
 *
 * It is launched by the Rust `process_spawn` command (allowlisted `node`) and
 * driven by the TypeScript `ProcessManager`. It never sees the React UI.
 *
 * Run directly for debugging:
 *   node --experimental-strip-types src/workers/crawler/index.ts
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  createErrorMessage,
  createEventMessage,
  createLogMessage,
  createMessageId,
  createResultMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  type BrowserAvailability,
  type CloseResultPayload,
  type LaunchResultPayload,
  type NavigateResultPayload,
  type PingResultPayload,
  type WorkerCommandMessage,
  type WorkerResultPayload
} from './protocol.ts';

/** Worker build identifier reported during the ping handshake. */
const WORKER_VERSION = '0.1.0';

/** Hard ceiling for any navigation, matching AGENTS.md section 4 (30s). */
const MAX_NAVIGATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Minimal structural types for playwright-core (imported lazily, no download).
// ---------------------------------------------------------------------------

interface PlaywrightPage {
  goto(url: string, options: { timeout: number; waitUntil: 'load' }): Promise<{ status(): number | null } | null>;
  title(): Promise<string>;
}

interface PlaywrightBrowser {
  version(): string;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  executablePath(): string;
  launch(options: { headless: boolean; executablePath?: string }): Promise<PlaywrightBrowser>;
}

interface ActiveSession {
  browser: PlaywrightBrowser;
  engine: 'chromium';
  version: string;
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
    const installed = typeof executablePath === 'string' && executablePath.length > 0 && existsSync(executablePath);
    return installed ? { engine: 'chromium', installed: true, executablePath } : { engine: 'chromium', installed: false };
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

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handlePing(): Promise<WorkerResultPayload> {
  const browser = await detectBrowser();
  const payload: PingResultPayload = { command: 'ping', pong: true, workerVersion: WORKER_VERSION, browser };
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
    throw Object.assign(new Error('No Playwright Chromium build was found.'), { code: 'BROWSER_NOT_INSTALLED' });
  }

  const browser = await chromium.launch({
    headless: message.payload.headless,
    executablePath: message.payload.executablePath ?? detection.executablePath
  });
  const sessionId = createMessageId();
  const version = browser.version();
  sessions.set(sessionId, { browser, engine: 'chromium', version });
  emitEvent('browser.launched', { sessionId, version });

  const payload: LaunchResultPayload = { command: 'launch', sessionId, engine: 'chromium', version };
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

  const page = await session.browser.newPage();
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

async function handleClose(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'close') {
    throw new Error('close handler received the wrong command');
  }
  const session = sessions.get(message.payload.sessionId);
  if (session) {
    sessions.delete(message.payload.sessionId);
    await session.browser.close();
    emitEvent('browser.closed', { sessionId: message.payload.sessionId });
  }
  const payload: CloseResultPayload = { command: 'close', sessionId: message.payload.sessionId };
  return payload;
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
      case 'close':
        payload = await handleClose(message);
        break;
      default:
        throw Object.assign(new Error('Unsupported command.'), { code: 'WORKER_PROTOCOL_VIOLATION' });
    }
    write(createResultMessage(message.id, payload));
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'PLAYWRIGHT_CRASHED';
    const text = error instanceof Error ? error.message : 'Worker command failed.';
    log('error', `${message.payload.command} failed: ${text}`);
    write(
      createResultMessage(
        message.id,
        { command: message.payload.command } as WorkerResultPayload,
        {
          code: code as never,
          category: 'browser',
          message: text,
          severity: 'error',
          recoverable: true,
          retryable: false,
          suggestedAction: 'Retry the browser operation.',
          timestamp: new Date().toISOString()
        }
      )
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
      write(createErrorMessage({ code: 'WORKER_PROTOCOL_VIOLATION', message: `Worker cannot handle "${parsed.message.type}" frames.` }));
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
