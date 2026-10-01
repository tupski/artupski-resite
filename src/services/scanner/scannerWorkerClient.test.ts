import { describe, expect, it } from 'vitest';
import { ScannerWorkerClient, type ScannerWorkerAdapter } from './scannerWorkerClient';
import type { WorkerCommandPayload, WorkerResultPayload, NormalizedPage } from '../infra/workerProtocol';
import { createProcessError } from '../infra/processErrors';

function samplePage(): NormalizedPage {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    title: 'Home',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [{ level: 1, text: 'Home' }],
    internalLinks: [],
    externalLinks: [],
    images: [],
    metrics: { loadTimeMs: 1, domContentLoadedTimeMs: 1, domNodeCount: 1 },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z'
  };
}

class FakeScannerWorker implements ScannerWorkerAdapter {
  startCount = 0;
  stopCount = 0;
  readonly commands: WorkerCommandPayload[] = [];
  private state = 'not_started';

  constructor(private readonly fail?: { code: string; message: string }) {}

  start(): Promise<void> {
    this.startCount += 1;
    this.state = 'ready';
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopCount += 1;
    this.state = 'stopped';
    return Promise.resolve();
  }

  getState(): string {
    return this.state;
  }

  async request(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
    this.commands.push(command);
    if (this.fail) {
      throw createProcessError('PLAYWRIGHT_CRASHED', { message: this.fail.message });
    }
    switch (command.command) {
      case 'ping':
        return { command: 'ping', pong: true, workerVersion: '0.2.0' };
      case 'extract':
        return { command: 'extract', sessionId: command.sessionId, page: samplePage() };
      case 'abort':
        return { command: 'abort', sessionId: command.sessionId };
      default:
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', { message: 'unexpected' });
    }
  }
}

describe('ScannerWorkerClient', () => {
  it('pings the worker', async () => {
    const worker = new FakeScannerWorker();
    const client = new ScannerWorkerClient(worker);
    const result = await client.ping();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pong).toBe(true);
    }
  });

  it('returns a normalized page from extract', async () => {
    const worker = new FakeScannerWorker();
    const client = new ScannerWorkerClient(worker);
    const result = await client.extract('session-1', 'https://example.com/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe('Home');
      expect(result.data.httpStatus).toBe(200);
    }
    const extract = worker.commands.find((c) => c.command === 'extract');
    expect(extract).toBeDefined();
    if (extract && extract.command === 'extract') {
      expect(extract.timeoutMs).toBeLessThanOrEqual(30_000);
      expect(extract.maxRedirects).toBeLessThanOrEqual(5);
    }
  });

  it('caps a caller-supplied redirect count', async () => {
    const worker = new FakeScannerWorker();
    const client = new ScannerWorkerClient(worker);
    await client.extract('s', 'https://example.com/', { maxRedirects: 99 });
    const extract = worker.commands.find((c) => c.command === 'extract');
    if (extract && extract.command === 'extract') {
      expect(extract.maxRedirects).toBeLessThanOrEqual(5);
    }
  });

  it('surfaces a typed error when the worker fails', async () => {
    const worker = new FakeScannerWorker({ code: 'PLAYWRIGHT_CRASHED', message: 'boom' });
    const client = new ScannerWorkerClient(worker);
    const result = await client.extract('s', 'https://example.com/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAYWRIGHT_CRASHED');
    }
  });

  it('aborts an in-flight extraction', async () => {
    const worker = new FakeScannerWorker();
    const client = new ScannerWorkerClient(worker);
    const result = await client.abort('session-1');
    expect(result.ok).toBe(true);
  });

  it('shuts the worker down', async () => {
    const worker = new FakeScannerWorker();
    const client = new ScannerWorkerClient(worker);
    await client.shutdown();
    expect(worker.stopCount).toBe(1);
  });
});
