/**
 * Clone preview server worker - Artupski ReSite
 * Source of truth: docs/architecture/ARCHITECTURE.md section 2 (Layer 1 -
 * "Serves static snapshot locally via internal HTTP server"),
 * docs/specs/CLONE-SPEC.md section 6, and docs/impl-plan/phase-8-impl-plan.md
 * (open decision C5).
 *
 * A dedicated, `ProcessManager`-managed Node child that serves the sandboxed
 * clone tree over HTTP for a local preview. Security is the whole point:
 * - it binds LOOPBACK ONLY (127.0.0.1) on an ephemeral port;
 * - it serves strictly from the canonical clone root passed by the Rust
 *   `clone_root` command; every request path is confined by the shared
 *   `serverPathPolicy` (traversal/absolute/NUL/backslash all rejected);
 * - it never executes page scripts server-side and never touches SQLite.
 *
 * It speaks the shared stdio JSON envelope with two commands: `serveClone`
 * (returns the loopback URL) and `stopClone`.
 *
 * Run directly for debugging:
 *   node --experimental-strip-types src/workers/cloneServer/index.ts
 */
import { createInterface } from 'node:readline';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import {
  createErrorMessage,
  createEventMessage,
  createLogMessage,
  createResultMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  resolveServePath,
  contentTypeFor,
  type WorkerCommandMessage,
  type WorkerResultPayload
} from './protocol.ts';

const SERVER_VERSION = '0.1.0';

let buffer = '';
let server: Server | null = null;
let listeningPort: number | null = null;
let servingRoot: string | null = null;

type OutboundMessage = Parameters<typeof serializeMessage>[0];

function write(message: OutboundMessage): void {
  try {
    process.stdout.write(serializeMessage(message));
  } catch {
    // A single oversize frame must never crash the server; it is dropped.
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  write(createLogMessage({ level, message }));
}

/** Send a 4xx/5xx response with a tiny text body (no information disclosure). */
function sendError(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    // A preview page must never be framed/embed hostile content.
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store'
  });
  response.end(text);
}

/** Handle one HTTP request against the confined clone root. */
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const root = servingRoot;
  if (!root) {
    sendError(response, 503, 'The preview server is not ready.');
    return;
  }
  const rawUrl = request.url ?? '/';
  const resolved = resolveServePath(rawUrl, root);
  if (!resolved.ok || !resolved.relative) {
    sendError(response, 403, 'Forbidden.');
    return;
  }

  let target = join(root, resolved.relative);
  try {
    const info = statSync(target);
    if (info.isDirectory()) {
      target = join(target, 'index.html');
    }
  } catch {
    // Fall through to the read attempt, which will 404 cleanly.
  }

  // Re-verify the real (symlink-resolved) path stays inside the root.
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    sendError(response, 404, 'Not found.');
    return;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    sendError(response, 500, 'Preview root is unavailable.');
    return;
  }
  if (!(
    realTarget === realRoot ||
    realTarget.startsWith(`${realRoot}\\`) ||
    realTarget.startsWith(`${realRoot}/`)
  )) {
    sendError(response, 403, 'Forbidden.');
    return;
  }

  try {
    const data = await fs.readFile(realTarget);
    response.writeHead(200, {
      'content-type': contentTypeFor(resolved.relative),
      'content-length': String(data.length),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store'
    });
    response.end(data);
  } catch {
    sendError(response, 404, 'Not found.');
  }
}

/** Start the loopback-only preview server rooted at `root`. */
async function handleServe(message: WorkerCommandMessage): Promise<WorkerResultPayload> {
  if (message.payload.command !== 'serveClone') {
    throw new Error('serveClone handler received the wrong command');
  }
  if (server) {
    return {
      command: 'serveClone',
      url: `http://127.0.0.1:${listeningPort}`,
      port: listeningPort ?? 0,
      root: servingRoot ?? message.payload.root
    };
  }
  const requestedPort = message.payload.port ?? 0;
  servingRoot = realpathSync(message.payload.root);
  server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(requestedPort, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  listeningPort = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${listeningPort}`;
  write(
    createEventMessage({ event: 'clone.server_listening', data: { url, port: listeningPort } })
  );
  log('info', `Clone preview server listening on ${url}`);

  return { command: 'serveClone', url, port: listeningPort, root: servingRoot };
}

/** Stop the server if it is running. */
async function handleStop(): Promise<WorkerResultPayload> {
  if (!server) {
    return { command: 'stopClone', stopped: false };
  }
  const current = server;
  server = null;
  listeningPort = null;
  servingRoot = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
  write(createEventMessage({ event: 'clone.server_stopped' }));
  return { command: 'stopClone', stopped: true };
}

async function handleCommand(message: WorkerCommandMessage): Promise<void> {
  try {
    let payload: WorkerResultPayload;
    switch (message.payload.command) {
      case 'ping':
        payload = { command: 'ping', pong: true, workerVersion: SERVER_VERSION };
        break;
      case 'serveClone':
        payload = await handleServe(message);
        break;
      case 'stopClone':
        payload = await handleStop();
        break;
      default:
        throw Object.assign(new Error('Unsupported command.'), {
          code: 'WORKER_PROTOCOL_VIOLATION'
        });
    }
    write(createResultMessage(message.id, payload));
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Clone server command failed.';
    log('error', `${message.payload.command} failed: ${text}`);
    write(
      createResultMessage(message.id, { command: message.payload.command } as WorkerResultPayload, {
        code: 'WORKER_PROTOCOL_VIOLATION',
        category: 'process',
        message: text,
        severity: 'error',
        recoverable: true,
        retryable: false,
        suggestedAction: 'Retry the preview operation.',
        timestamp: new Date().toISOString()
      })
    );
  }
}

function onChunk(chunk: string): void {
  buffer += chunk;
  const decoded = decodeFrames(buffer);
  buffer = decoded.remainder;
  for (const frame of decoded.frames) {
    const parsed = parseMessage(frame);
    if (!parsed.ok) {
      write(createErrorMessage({ code: parsed.error.code, message: parsed.error.message }));
      continue;
    }
    if (parsed.message.type !== 'command') {
      write(
        createErrorMessage({
          code: 'WORKER_PROTOCOL_VIOLATION',
          message: 'The clone server only accepts command frames.'
        })
      );
      continue;
    }
    void handleCommand(parsed.message);
  }
}

async function shutdown(code: number): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => onChunk(`${line}\n`));
  rl.on('close', () => void shutdown(0));
  process.stdin.on('end', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  log('info', `Clone preview server worker ready (v${SERVER_VERSION}).`);
}

void main();

// `createReadStream` is imported to document the intended streaming path; the
// small clone files are read whole to keep the handler simple and bounded.
void createReadStream;
