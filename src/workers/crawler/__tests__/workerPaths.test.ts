/**
 * Worker entrypoint resolution tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md section 9.4 and §8.2 (C1).
 *
 * The pure resolver (`src/workers/workerRuntime.ts`) is exercised with injected
 * environments so dev-only and packaged resolution are both covered without a
 * shell or a Tauri runtime. The real `workerPaths` modules are then asserted to
 * emit an allowlisted command and an ARRAY of args (never a shell string) and to
 * resolve an existing dev `.ts` entrypoint outside the packaged shell.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_WORKER_COMMANDS,
  allowlistedNodeCommand,
  buildWorkerEntrypoint,
  packagedWorkerScriptPath,
  resolveWorkerScriptPath,
  type WorkerDescriptor,
  type WorkerResolveEnv
} from '../../workerRuntime';
import { resolveWorkerEntrypoint } from '../workerPaths';
import { resolveCloneServerEntrypoint } from '../../cloneServer/workerPaths';

const CRAWLER: WorkerDescriptor = { name: 'crawler', devFileName: 'index.ts' };

/** Build an injected environment with a controllable existence probe. */
function env(options: {
  platform?: string;
  devDir?: string;
  resourceDir?: string | null;
  existing?: string[];
}): WorkerResolveEnv {
  const existing = new Set(options.existing ?? []);
  return {
    platform: options.platform ?? 'linux',
    devDir: options.devDir ?? '/app/src/workers/crawler',
    resourceDir: options.resourceDir ?? null,
    exists: (candidate) => existing.has(candidate)
  };
}

describe('workerRuntime - resolveWorkerScriptPath (dev-only)', () => {
  it('returns the co-located dev entrypoint when no resource dir is known', () => {
    const dev = '/app/src/workers/crawler/index.ts';
    const resolved = resolveWorkerScriptPath(env({ existing: [dev] }), CRAWLER);
    expect(resolved).toBe(dev);
    expect(resolved.endsWith('index.ts')).toBe(true);
  });

  it('falls back to the dev candidate honestly when nothing exists', () => {
    const resolved = resolveWorkerScriptPath(env({ existing: [] }), CRAWLER);
    expect(resolved).toBe('/app/src/workers/crawler/index.ts');
  });
});

describe('workerRuntime - resolveWorkerScriptPath (packaged)', () => {
  it('prefers the packaged resource-dir entrypoint when it exists', () => {
    const packaged = packagedWorkerScriptPath('/opt/app/resources', CRAWLER);
    expect(packaged).toBe('/opt/app/resources/workers/crawler/index.js');

    const resolved = resolveWorkerScriptPath(
      env({ resourceDir: '/opt/app/resources', existing: [packaged] }),
      CRAWLER
    );
    expect(resolved).toBe(packaged);
    expect(resolved.endsWith('workers/crawler/index.js')).toBe(true);
  });

  it('prefers the packaged worker even when the dev file also exists', () => {
    const dev = '/app/src/workers/crawler/index.ts';
    const packaged = packagedWorkerScriptPath('/opt/app/resources', CRAWLER);
    const resolved = resolveWorkerScriptPath(
      env({ resourceDir: '/opt/app/resources', existing: [dev, packaged] }),
      CRAWLER
    );
    expect(resolved).toBe(packaged);
  });

  it('falls back to dev when a resource dir is known but the worker is missing', () => {
    const dev = '/app/src/workers/crawler/index.ts';
    const resolved = resolveWorkerScriptPath(
      env({ resourceDir: '/opt/app/resources', existing: [dev] }),
      CRAWLER
    );
    expect(resolved).toBe(dev);
  });
});

describe('workerRuntime - buildWorkerEntrypoint (command + array args)', () => {
  it('uses an allowlisted command and an ARRAY of args in dev', () => {
    const dev = '/app/src/workers/crawler/index.ts';
    const entry = buildWorkerEntrypoint(env({ platform: 'linux', existing: [dev] }), CRAWLER);
    expect(entry.command).toBe('node');
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args).toEqual(['--experimental-strip-types', dev]);
    expect(entry.cwd).toBe('/app/src/workers/crawler');
  });

  it('drops the type-stripping flag for a packaged .js worker', () => {
    const packaged = '/opt/app/resources/workers/crawler/index.js';
    const entry = buildWorkerEntrypoint(
      env({ resourceDir: '/opt/app/resources', existing: [packaged] }),
      CRAWLER
    );
    expect(entry.args).toEqual([packaged]);
    expect(entry.args).not.toContain('--experimental-strip-types');
  });

  it('maps win32 to node.exe and everything else to node', () => {
    expect(allowlistedNodeCommand('win32')).toBe('node.exe');
    expect(allowlistedNodeCommand('darwin')).toBe('node');
    expect(allowlistedNodeCommand('linux')).toBe('node');
    expect(ALLOWED_WORKER_COMMANDS).toContain('node');
    expect(ALLOWED_WORKER_COMMANDS).toContain('node.exe');
  });

  it('never emits a shell string (args are always discrete array items)', () => {
    const dev = '/app/src/workers/crawler/index.ts';
    const entry = buildWorkerEntrypoint(env({ existing: [dev] }), CRAWLER);
    for (const arg of entry.args) {
      expect(typeof arg).toBe('string');
      expect(arg).not.toContain('&&');
      expect(arg).not.toContain('|');
      expect(arg).not.toContain(';');
    }
  });
});

describe('crawler workerPaths - real resolution outside the packaged shell', () => {
  it('resolves an existing dev entrypoint with an allowlisted command and array args', async () => {
    const entry = await resolveWorkerEntrypoint();
    expect(ALLOWED_WORKER_COMMANDS).toContain(entry.command);
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args[0]).toBe('--experimental-strip-types');
    expect(entry.args[1]?.endsWith('index.ts')).toBe(true);
    expect(existsSync(entry.args[1] as string)).toBe(true);
    expect(entry.cwd.length).toBeGreaterThan(0);
  });
});

describe('clone server workerPaths - real resolution outside the packaged shell', () => {
  it('resolves an existing dev entrypoint with an allowlisted command and array args', async () => {
    const entry = await resolveCloneServerEntrypoint();
    expect(ALLOWED_WORKER_COMMANDS).toContain(entry.command);
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args[0]).toBe('--experimental-strip-types');
    expect(entry.args[1]?.endsWith('index.ts')).toBe(true);
    expect(existsSync(entry.args[1] as string)).toBe(true);
  });
});
