/**
 * Worker lifecycle & protocol robustness test - Artupski ReSite
 * Source of truth: docs/architecture/WORKER-PROTOCOL.md sections 4-5.
 *
 * UNLIKE the other crawler E2E files this one is NOT opt-in: it spawns the real
 * worker (via Node type stripping) but never launches a browser or touches the
 * network, so it can run in CI. It reproduces the reported lifecycle bug cluster:
 *
 *  (a) every command path posts a terminal reply (success OR error) - an unknown
 *      session returns a structured error instead of hanging until timeout;
 *  (b) a malformed / unsupported frame yields a SPECIFIC error (naming the
 *      offending field or version) rather than a generic "malformed message";
 *  (c) a protocol violation does not kill the worker - it stays responsive.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWorkerEntrypoint } from '../workerPaths';
import {
  createCommandMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  WORKER_PROTOCOL_VERSION,
  type WorkerCommandPayload,
  type WorkerMessage,
  type WorkerResultMessage,
  type WorkerErrorMessage
} from '../../../services/infra/workerProtocol';

interface Harness {
  child: ChildProcessWithoutNullStreams;
  send: (command: WorkerCommandPayload) => void;
  sendRaw: (frame: string) => void;
  waitForResult: (timeoutMs?: number) => Promise<WorkerResultMessage>;
  waitForError: (timeoutMs?: number) => Promise<WorkerErrorMessage>;
}

async function startWorker(): Promise<Harness> {
  const entry = await resolveWorkerEntrypoint();
  const child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });

  let buffer = '';
  const results: WorkerResultMessage[] = [];
  const errors: WorkerErrorMessage[] = [];
  const resultWaiters: Array<(message: WorkerResultMessage) => void> = [];
  const errorWaiters: Array<(message: WorkerErrorMessage) => void> = [];

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const decoded = decodeFrames(buffer);
    buffer = decoded.remainder;
    for (const frame of decoded.frames) {
      const parsed = parseMessage(frame);
      if (!parsed.ok) {
        continue;
      }
      deliver(parsed.message);
    }
  });

  function deliver(message: WorkerMessage): void {
    if (message.type === 'result') {
      const waiter = resultWaiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        results.push(message);
      }
    } else if (message.type === 'error') {
      const waiter = errorWaiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        errors.push(message);
      }
    }
  }

  function waitForResult(timeoutMs = 10_000): Promise<WorkerResultMessage> {
    const existing = results.shift();
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<WorkerResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a result frame')), timeoutMs);
      resultWaiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  function waitForError(timeoutMs = 10_000): Promise<WorkerErrorMessage> {
    const existing = errors.shift();
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<WorkerErrorMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for an error frame')), timeoutMs);
      errorWaiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  return {
    child,
    send: (command) => child.stdin.write(serializeMessage(createCommandMessage(command))),
    sendRaw: (frame) => child.stdin.write(frame.endsWith('\n') ? frame : `${frame}\n`),
    waitForResult,
    waitForError
  };
}

describe('crawler worker lifecycle & protocol robustness', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startWorker();
  });

  afterAll(() => {
    if (harness?.child && !harness.child.killed) {
      harness.child.stdin.end();
      harness.child.kill();
    }
  });

  it('posts a terminal error reply for an unknown session (never hangs)', async () => {
    harness.send({
      command: 'captureViewport',
      sessionId: 'no-such-session',
      url: 'http://127.0.0.1:9/none',
      timeoutMs: 5_000,
      profile: {
        name: 'mobile',
        width: 375,
        height: 812,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      }
    });

    const result = await harness.waitForResult();
    expect(result.payload.command).toBe('captureViewport');
    expect(result.error?.code).toBe('PLAYWRIGHT_CRASHED');
  });

  it('names the missing field on a malformed command', async () => {
    harness.sendRaw(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'missing-session',
        type: 'command',
        payload: { command: 'captureViewport', url: 'http://x/', timeoutMs: 1000 }
      })
    );

    const error = await harness.waitForError();
    expect(error.payload.code).toBe('WORKER_PROTOCOL_VIOLATION');
    expect(error.payload.message).toMatch(/sessionId/);
  });

  it('rejects an unsupported protocol version with a version-specific error', async () => {
    harness.sendRaw(
      JSON.stringify({
        protocolVersion: 999,
        id: 'bad-version',
        type: 'command',
        payload: { command: 'ping' }
      })
    );

    const error = await harness.waitForError();
    expect(error.payload.code).toBe('WORKER_PROTOCOL_VIOLATION');
    expect(error.payload.message).toMatch(/version/i);
  });

  it('rejects a non-JSON frame without killing the worker', async () => {
    harness.sendRaw('{ this is not json');

    const error = await harness.waitForError();
    expect(error.payload.code).toBe('WORKER_PROTOCOL_VIOLATION');
    expect(error.payload.message).toMatch(/json/i);

    // The worker is still alive and protocol-compatible after the violation.
    harness.send({ command: 'ping' });
    const pong = await harness.waitForResult();
    expect(pong.payload.command).toBe('ping');
    if (pong.payload.command === 'ping') {
      expect(pong.payload.pong).toBe(true);
    }
  });
});
