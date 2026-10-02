/**
 * Phase 14 exporter test fixtures - Artupski ReSite
 *
 * Deterministic in-memory fixtures: a `ProjectGenerationReport` builder plus an
 * in-memory `ExportFileReader` / `ExportFileWriter` pair so the exporter suites
 * need neither a real filesystem nor a Tauri shell. No network, no filesystem
 * side effects.
 */
import type { ProjectGenerationReport } from '../../../types/projectGen';
import type { ExportFileReader, ExportFileWriter } from '../zipExporter';

/** A canonical Phase 12-shaped report with routes, components, assets, files. */
export function sampleReport(
  overrides: Partial<ProjectGenerationReport> = {}
): ProjectGenerationReport {
  const files = overrides.files ?? [
    'package.json',
    'index.html',
    'vite.config.ts',
    'src/main.tsx',
    'src/App.tsx',
    'src/router.tsx',
    'src/components/Button.tsx',
    'src/components/Hero.tsx',
    'src/pages/HomePage.tsx',
    'src/pages/AboutPage.tsx',
    'src/hooks/useCounter.ts',
    'public/assets/logo.png'
  ];
  return {
    ok: true,
    targetRoot: '/tmp/project',
    files,
    routes: [
      {
        path: '/',
        component: 'HomePage',
        fileName: 'HomePage.tsx',
        authRequired: false,
        index: true
      },
      {
        path: '/about',
        component: 'AboutPage',
        fileName: 'AboutPage.tsx',
        authRequired: false,
        index: false
      }
    ],
    droppedRoutes: [{ path: '/missing', reason: 'missing_page' }],
    components: [
      { name: 'Button', path: 'src/components/Button.tsx' },
      { name: 'Hero', path: 'src/components/Hero.tsx' }
    ],
    assets: [{ id: 'asset_logo', path: 'public/assets/logo.png' }],
    skipped: [],
    summary: {
      filesWritten: files.length,
      bytesWritten: 2048,
      componentsWritten: 2,
      assetsWritten: 1,
      routesWritten: 2,
      routesDropped: 1,
      partial: false,
      aborted: false
    },
    ...overrides
  };
}

/** An in-memory reader/writer with deterministic content for every report file. */
export function createMemoryIo(report: ProjectGenerationReport): {
  reader: ExportFileReader;
  writer: ExportFileWriter;
  written: Map<string, Uint8Array>;
  removed: string[];
  failReads: Set<string>;
  failWrites: Set<string>;
} {
  const contents = new Map<string, Uint8Array>();
  for (const path of report.files) {
    contents.set(path, new TextEncoder().encode(`contents of ${path}`));
  }
  const written = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const failReads = new Set<string>();
  const failWrites = new Set<string>();

  const reader: ExportFileReader = {
    async list(): Promise<string[]> {
      return [...contents.keys()].sort();
    },
    async read(_root: string, relativePath: string): Promise<Uint8Array | null> {
      if (failReads.has(relativePath)) {
        return null;
      }
      return contents.get(relativePath) ?? null;
    }
  };

  const writer: ExportFileWriter = {
    async write(_root: string, relativePath: string, data: Uint8Array): Promise<void> {
      if (failWrites.has(relativePath)) {
        throw new Error(`simulated write failure for ${relativePath}`);
      }
      written.set(relativePath, data);
    },
    async mkdir(_root: string, _relativePath: string): Promise<void> {
      // No-op: the in-memory writer tracks written paths only.
    },
    async remove(_root: string, relativePath: string): Promise<void> {
      removed.push(relativePath);
      written.delete(relativePath);
    }
  };

  return { reader, writer, written, removed, failReads, failWrites };
}
