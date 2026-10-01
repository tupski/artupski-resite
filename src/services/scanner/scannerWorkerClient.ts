/**
 * Scanner worker client - Artupski ReSite
 * Source of truth: docs/architecture/WORKER-PROTOCOL.md and docs/specs/SCANNER-SPEC.md.
 *
 * A thin, typed wrapper over the crawler worker protocol. It owns NO crawling
 * logic: the worker performs navigation + extraction, and this client only
 * sends validated commands and returns typed results. It reuses the Phase 3
 * `ProcessManager` boundary (there is exactly one process manager and one
 * protocol; this client never spawns anything itself).
 *
 * The React UI never touches this module's process internals. A later
 * workstream wires it into the scan orchestration/lifecycle layer.
 */
import { logger } from '../infra/logger';
import type { StructuredError } from '../infra/errors';
import type { ProcessManager } from '../infra/processManager';
import {
  MAX_EXTRACT_REDIRECTS,
  type AbortResultPayload,
  type ExtractResultPayload,
  type NormalizedPage,
  type PingResultPayload,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../infra/workerProtocol';
import { createScannerError, toScannerError } from './errors';

export type ScannerResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

/** Injectable worker boundary; production wraps ProcessManager, tests inject a fake. */
export interface ScannerWorkerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload>;
}

/** Production adapter: maps scanner operations onto the shared worker protocol. */
export class ProcessManagerScannerWorker implements ScannerWorkerAdapter {
  constructor(private readonly manager: ProcessManager) {}

  start(): Promise<void> {
    return this.manager.start();
  }

  stop(): Promise<void> {
    return this.manager.stop();
  }

  getState(): string {
    return this.manager.getState();
  }

  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload> {
    return this.manager.request(command, timeoutMs);
  }
}

export interface ExtractOptions {
  timeoutMs?: number;
  followRedirects?: boolean;
  allowedContentTypes?: string[];
  maxRedirects?: number;
}

export class ScannerWorkerClient {
  private readonly adapter: ScannerWorkerAdapter;
  private readonly log: ReturnType<typeof logger.child>;

  constructor(adapter: ScannerWorkerAdapter) {
    this.adapter = adapter;
    this.log = logger.child('scanner');
  }

  getState(): string {
    return this.adapter.getState();
  }

  /** Probe the worker handshake and browser availability (no download). */
  async ping(): Promise<ScannerResult<PingResultPayload>> {
    try {
      await this.adapter.start();
      const result = await this.adapter.request({ command: 'ping' });
      if (result.command !== 'ping') {
        return { ok: false, error: createScannerError('INVALID_URL', { message: 'Worker returned an unexpected ping result.' }) };
      }
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: toScannerError(error) };
    }
  }

  /** Navigate to `url` and return a normalized page extraction. */
  async extract(sessionId: string, url: string, options: ExtractOptions = {}): Promise<ScannerResult<NormalizedPage>> {
    try {
      const result = await this.adapter.request({
        command: 'extract',
        sessionId,
        url,
        timeoutMs: options.timeoutMs ?? 30_000,
        followRedirects: options.followRedirects ?? true,
        allowedContentTypes: options.allowedContentTypes,
        maxRedirects: Math.min(options.maxRedirects ?? MAX_EXTRACT_REDIRECTS, MAX_EXTRACT_REDIRECTS)
      });
      const payload = result as ExtractResultPayload;
      if (payload.command !== 'extract') {
        return {
          ok: false,
          error: createScannerError('INVALID_URL', { message: 'Worker returned an unexpected extract result.' })
        };
      }
      return { ok: true, data: payload.page };
    } catch (error) {
      this.log.warn('Extraction failed', { error: String(error) });
      return { ok: false, error: toScannerError(error) };
    }
  }

  /** Cancel an in-flight extraction for a session. */
  async abort(sessionId: string): Promise<ScannerResult<true>> {
    try {
      const result = await this.adapter.request({ command: 'abort', sessionId });
      const payload = result as AbortResultPayload;
      if (payload.command !== 'abort') {
        return { ok: false, error: createScannerError('USER_CANCELLED', { message: 'Unexpected abort result.' }) };
      }
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: toScannerError(error) };
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.adapter.stop();
    } catch (error) {
      this.log.warn('Scanner worker shutdown failed', { error: String(error) });
    }
  }
}

/**
 * Build the default scanner worker client for the current environment. Outside
 * the Tauri runtime (browser preview, unit tests) this returns `null` so the
 * application simply skips it, mirroring `createDefaultBrowserRuntime`.
 */
export async function createDefaultScannerWorkerClient(): Promise<ScannerWorkerClient | null> {
  const { isTauriRuntime } = await import('../ipc/tauri');
  if (!isTauriRuntime()) {
    logger.child('scanner').debug('Skipping scanner worker outside the Tauri shell.');
    return null;
  }

  const { ProcessManager } = await import('../infra/processManager');
  const { TauriProcessSpawner } = await import('../infra/tauriProcessSpawner');
  const workerPathsModule = '../../workers/crawler/workerPaths';
  const { resolveWorkerEntrypoint } = (await import(/* @vite-ignore */ workerPathsModule)) as {
    resolveWorkerEntrypoint: () => { command: string; args: string[]; cwd: string };
  };

  const entry = resolveWorkerEntrypoint();
  const manager = new ProcessManager({
    name: 'crawler',
    spawner: new TauriProcessSpawner(),
    spawn: {
      command: entry.command,
      args: entry.args,
      cwd: entry.cwd
    }
  });

  return new ScannerWorkerClient(new ProcessManagerScannerWorker(manager));
}
