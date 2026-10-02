/**
 * Phase 14 export orchestrator suites - Artupski ReSite
 *
 * Covers zip + folder modes, the four resource limits, path-traversal and
 * duplicate rejection before any write, per-file failure isolation, abort
 * cleanup, event emission, destination confinement, and the unavailable-deps
 * contract. Uses an injected in-memory reader/writer: no filesystem, no network.
 */
import { describe, expect, it } from 'vitest';
import type { AppEvent } from '../../infra/eventBus';
import { readZip } from '../zip';
import { exportProject, type ExportProjectDeps } from '../zipExporter';
import { createMemoryIo, sampleReport } from './exportFixtures';

function baseRequest(report = sampleReport()) {
  return {
    projectRoot: '/tmp/project',
    destinationRoot: '/tmp/dest',
    report,
    projectName: 'Acme SaaS Platform',
    targetFramework: 'Vite + React + TypeScript + Tailwind',
    targetUrl: 'https://example.com',
    description: 'A generated project.',
    mode: 'zip' as const
  };
}

function collectEvents(): { events: AppEvent[]; sink: { emit: (event: AppEvent) => void } } {
  const events: AppEvent[] = [];
  return { events, sink: { emit: (event) => events.push(event) } };
}

describe('exportProject zip mode', () => {
  it('produces a parseable archive containing source files and the three docs', async () => {
    const report = sampleReport();
    const { reader, writer, written } = createMemoryIo(report);
    const result = await exportProject({ reader, writer }, baseRequest(report));

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('zip');
    expect(result.artifactPath).toBe('acme-saas-platform.zip');
    expect(result.docs.map((doc) => doc.name)).toEqual([
      'README.md',
      'ARCHITECTURE.md',
      'COMPONENTS.md'
    ]);

    const archiveBytes = written.get('acme-saas-platform.zip');
    expect(archiveBytes).toBeDefined();
    const archive = readZip(archiveBytes!);
    for (const path of report.files) {
      expect(archive.data.has(path)).toBe(true);
    }
    for (const name of ['README.md', 'ARCHITECTURE.md', 'COMPONENTS.md']) {
      expect(archive.data.has(name)).toBe(true);
    }
    expect(result.summary.docCount).toBe(3);
    expect(result.summary.entryCount).toBe(report.files.length + 3);
    expect(result.summary.partial).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('honors a supplied archiveName and appends the .zip suffix', async () => {
    const report = sampleReport();
    const { reader, writer, written } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { archiveName: 'bundle' } };
    const result = await exportProject({ reader, writer }, request);
    expect(result.ok).toBe(true);
    expect(result.artifactPath).toBe('bundle.zip');
    expect(written.has('bundle.zip')).toBe(true);
  });
});

describe('exportProject folder mode', () => {
  it('writes each entry beneath the folder name', async () => {
    const report = sampleReport();
    const { reader, writer, written } = createMemoryIo(report);
    const request = { ...baseRequest(report), mode: 'folder' as const };
    const result = await exportProject({ reader, writer }, request);

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('folder');
    expect(result.artifactPath).toBe('acme-saas-platform');
    for (const path of report.files) {
      expect(written.has(`acme-saas-platform/${path}`)).toBe(true);
    }
    expect(written.has('acme-saas-platform/README.md')).toBe(true);
    expect(result.summary.docCount).toBe(3);
  });
});

describe('exportProject resource limits', () => {
  it('rejects when the entry count exceeds the cap', async () => {
    const report = sampleReport();
    const { reader, writer } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { maxEntries: 3 } };
    const result = await exportProject({ reader, writer }, request);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_ENTRY_LIMIT_EXCEEDED');
  });

  it('rejects when a single entry exceeds the byte cap', async () => {
    const report = sampleReport();
    const { reader, writer } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { maxEntryBytes: 1 } };
    const result = await exportProject({ reader, writer }, request);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_ENTRY_SIZE_LIMIT_EXCEEDED');
  });

  it('rejects when the total exceeds the byte cap', async () => {
    const report = sampleReport();
    const { reader, writer } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { maxTotalBytes: 1 } };
    const result = await exportProject({ reader, writer }, request);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_TOTAL_SIZE_LIMIT_EXCEEDED');
  });

  it('rejects a path that exceeds the depth cap', async () => {
    const report = sampleReport({ files: ['a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q.ts'] });
    const { reader, writer } = createMemoryIo(report);
    const result = await exportProject({ reader, writer }, baseRequest(report));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_PATH_UNSAFE');
  });

  it('writes nothing when a limit is breached', async () => {
    const report = sampleReport();
    const { reader, writer, written } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { maxEntries: 3 } };
    await exportProject({ reader, writer }, request);
    expect(written.size).toBe(0);
  });
});

describe('exportProject path safety (before any write)', () => {
  const traversals: [string, string][] = [
    ['parent traversal', '../evil.ts'],
    ['absolute path', '/etc/passwd'],
    ['backslash', 'src\\evil.ts'],
    ['drive letter', 'C:/evil.ts'],
    ['NUL byte', 'src/evil\u0000.ts']
  ];

  for (const [label, path] of traversals) {
    it(`rejects a ${label} entry`, async () => {
      const report = sampleReport({ files: [path] });
      const { reader, writer, written } = createMemoryIo(report);
      const result = await exportProject({ reader, writer }, baseRequest(report));
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('EXPORT_PATH_UNSAFE');
      expect(written.size).toBe(0);
    });
  }

  it('rejects case-colliding entries', async () => {
    const report = sampleReport({ files: ['src/a.ts', 'src/A.ts'] });
    const { reader, writer, written } = createMemoryIo(report);
    const result = await exportProject({ reader, writer }, baseRequest(report));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_DUPLICATE_ENTRY');
    expect(written.size).toBe(0);
  });

  it('rejects an unsafe artifact name (destination confinement)', async () => {
    const report = sampleReport();
    const { reader, writer } = createMemoryIo(report);
    const request = { ...baseRequest(report), options: { archiveName: '../escape.zip' } };
    const result = await exportProject({ reader, writer }, request);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_PATH_UNSAFE');
  });
});

describe('exportProject failure isolation', () => {
  it('skips a single unreadable file and marks the run partial', async () => {
    const report = sampleReport();
    const io = createMemoryIo(report);
    io.failReads.add('src/main.tsx');
    const result = await exportProject(
      { reader: io.reader, writer: io.writer },
      baseRequest(report)
    );

    expect(result.ok).toBe(true);
    expect(result.summary.partial).toBe(true);
    expect(result.skipped.some((entry) => entry.id === 'src/main.tsx')).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('records a write failure as an actionable error', async () => {
    const report = sampleReport();
    const io = createMemoryIo(report);
    io.failWrites.add('acme-saas-platform.zip');
    const result = await exportProject(
      { reader: io.reader, writer: io.writer },
      baseRequest(report)
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_ARCHIVE_WRITE_FAILED');
  });
});

describe('exportProject abort', () => {
  it('returns aborted:true and cleans up the partial artifact', async () => {
    const report = sampleReport();
    const io = createMemoryIo(report);
    const controller = new AbortController();
    const originalRead = io.reader.read.bind(io.reader);
    io.reader.read = async (root, path) => {
      const data = await originalRead(root, path);
      controller.abort();
      return data;
    };

    const deps: ExportProjectDeps = {
      reader: io.reader,
      writer: io.writer,
      signal: controller.signal
    };
    const result = await exportProject(deps, baseRequest(report));

    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('USER_CANCELLED');
    expect(io.removed).toContain('acme-saas-platform.zip');
  });
});

describe('exportProject events', () => {
  it('emits export.started, doc_generated x3, entry_written, completed', async () => {
    const report = sampleReport();
    const { reader, writer } = createMemoryIo(report);
    const { events, sink } = collectEvents();
    const result = await exportProject({ reader, writer, events: sink }, baseRequest(report));
    expect(result.ok).toBe(true);

    const types = events.map((event) => event.type);
    expect(types[0]).toBe('export.started');
    expect(types.filter((type) => type === 'export.doc_generated')).toHaveLength(3);
    expect(types).toContain('export.entry_written');
    expect(types[types.length - 1]).toBe('export.completed');
    for (const event of events) {
      expect(event.payload.domain).toBe('export');
    }
    const started = events.find((event) => event.type === 'export.started');
    expect(started?.payload).toMatchObject({ mode: 'zip' });
  });

  it('emits export.failed on a validation error', async () => {
    const report = sampleReport({ files: ['../evil.ts'] });
    const { reader, writer } = createMemoryIo(report);
    const { events, sink } = collectEvents();
    await exportProject({ reader, writer, events: sink }, baseRequest(report));
    expect(events.map((event) => event.type)).toContain('export.failed');
  });
});

describe('exportProject unavailable deps', () => {
  it('refuses to run without an injected reader/writer', async () => {
    const result = await exportProject({}, baseRequest());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXPORT_UNAVAILABLE');
  });

  it('never throws for a malformed request', async () => {
    const { reader, writer } = createMemoryIo(sampleReport());
    await expect(
      exportProject({ reader, writer }, { ...baseRequest(), projectName: '' })
    ).resolves.toMatchObject({ ok: false });
  });
});
