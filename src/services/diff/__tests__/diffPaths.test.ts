import { describe, expect, it } from 'vitest';
import { resolveGeneratedServePath } from '../diffPaths';
import {
  resolveGeneratedServeRoot,
  startGeneratedServer,
  stopGeneratedServer
} from '../generatedServer';
import type { GeneratedServerAdapter } from '../generatedServer';
import type { WorkerCommandPayload, WorkerResultPayload } from '../../infra/workerProtocol';

describe('resolveGeneratedServePath (root confinement)', () => {
  const root = '/data/generated/p1/dist';

  it('allows an in-root file', () => {
    const resolved = resolveGeneratedServePath('/assets/index-abc.js', root);
    expect(resolved.ok).toBe(true);
    expect(resolved.relative).toBe('assets/index-abc.js');
  });

  it('resolves a directory request to index.html', () => {
    const resolved = resolveGeneratedServePath('/', root);
    expect(resolved.ok).toBe(true);
    expect(resolved.relative).toBe('index.html');
  });

  it('rejects parent traversal', () => {
    expect(resolveGeneratedServePath('/../../etc/passwd', root).ok).toBe(false);
  });

  it('rejects an encoded traversal', () => {
    expect(resolveGeneratedServePath('/..%2f..%2fsecret', root).ok).toBe(false);
  });

  it('rejects a NUL byte', () => {
    expect(resolveGeneratedServePath('/index.html\0.png', root).ok).toBe(false);
  });

  it('rejects a backslash override', () => {
    expect(resolveGeneratedServePath('/..\\..\\secret', root).ok).toBe(false);
  });

  it('rejects an empty root', () => {
    expect(resolveGeneratedServePath('/index.html', '').ok).toBe(false);
  });
});

describe('resolveGeneratedServeRoot', () => {
  it('serves the built dist directory of a generated project', () => {
    expect(resolveGeneratedServeRoot('C:\\data\\p1')).toBe('C:/data/p1/dist');
    expect(resolveGeneratedServeRoot('/data/p1/')).toBe('/data/p1/dist');
  });
});

/** A minimal in-memory adapter that records the commands it receives. */
function fakeAdapter(overrides: Partial<GeneratedServerAdapter> = {}): GeneratedServerAdapter & {
  commands: WorkerCommandPayload[];
} {
  const commands: WorkerCommandPayload[] = [];
  let state = 'stopped';
  return {
    commands,
    async start() {
      state = 'ready';
    },
    async stop() {
      state = 'stopped';
    },
    getState: () => state,
    async request(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
      commands.push(command);
      if (command.command === 'serveClone') {
        return { command: 'serveClone', url: 'http://127.0.0.1:9', port: 9, root: command.root };
      }
      return { command: 'stopClone', stopped: true };
    },
    ...overrides
  };
}

describe('generatedServer lifecycle', () => {
  it('starts the loopback server and returns its handle', async () => {
    const adapter = fakeAdapter();
    const result = await startGeneratedServer('/data/p1/dist', { adapter });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe('http://127.0.0.1:9');
      expect(result.data.port).toBe(9);
    }
    expect(adapter.commands[0]?.command).toBe('serveClone');
  });

  it('stops the server when it was running', async () => {
    const adapter = fakeAdapter();
    const result = await stopGeneratedServer({ adapter });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });

  it('reports a structured error when start throws (never throws)', async () => {
    const adapter = fakeAdapter({
      start: async () => {
        throw new Error('spawn failed');
      }
    });
    const result = await startGeneratedServer('/data/p1/dist', { adapter });
    expect(result.ok).toBe(false);
  });
});
