/**
 * Phase 14 end-to-end export verification - Artupski ReSite
 *
 * THE critical Phase 14 test: it generates a REAL Phase 12 project into an
 * isolated temp directory, exports it to a REAL ZIP archive via the Node-`fs`
 * reader/writer, then actually unzips the produced archive with `readZip` and
 * asserts the docs and every source file are present and byte-identical. Nothing
 * is mocked and static inspection is NOT substituted.
 *
 * It is opt-in via `RUN_EXPORT_E2E=1` (mirroring the repo's `RUN_PROJECT_BUILD`
 * gating) because it is the heavier real-artifact check. Run explicitly with:
 *   RUN_EXPORT_E2E=1 npx vitest run \
 *     src/services/exporter/__tests__/zipExporter.e2e.test.ts
 *
 * Set `KEEP_EXPORT_E2E=1` to keep the temp dirs for manual inspection.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateProject } from '../../generator/projectGenerator';
import {
  counterHook,
  heroComponent,
  logoAsset,
  phase12Blueprint,
  synthesizedComponent
} from '../../generator/__tests__/projectFixtures';
import { readZip } from '../zip';
import { createNodeExportIo, exportProject } from '../zipExporter';

const ENABLED = process.env.RUN_EXPORT_E2E === '1';
const KEEP = process.env.KEEP_EXPORT_E2E === '1';
const roots: string[] = [];

async function makeRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterAll(async () => {
  if (!KEEP) {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  } else {
    // eslint-disable-next-line no-console
    console.log(`[phase14 export e2e] kept temp dirs: ${roots.join(', ')}`);
  }
});

describe.skipIf(!ENABLED)(
  'generated project exports and unpacks cleanly (Phase 14 acceptance)',
  () => {
    it('produces a ZIP containing README and every source file, verified by CRC', async () => {
      const projectRoot = await makeRoot('resite-export-src-');
      const destinationRoot = await makeRoot('resite-export-dst-');

      const report = await generateProject(
        {},
        {
          blueprint: phase12Blueprint(),
          components: [synthesizedComponent(), heroComponent()],
          hooks: [counterHook()],
          assets: [logoAsset()],
          targetRoot: projectRoot,
          options: { projectName: 'resite-generated-app' }
        }
      );
      expect(report.ok).toBe(true);
      expect(report.files.length).toBeGreaterThan(0);

      const io = createNodeExportIo();
      const result = await exportProject(
        { reader: io.reader, writer: io.writer },
        {
          projectRoot,
          destinationRoot,
          report,
          projectName: 'Resite Generated App',
          targetFramework: 'Vite + React + TypeScript + Tailwind',
          targetUrl: 'https://example.com',
          description: 'An exported generated project.',
          mode: 'zip'
        }
      );

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.docs.map((doc) => doc.name)).toEqual([
        'README.md',
        'ARCHITECTURE.md',
        'COMPONENTS.md'
      ]);
      expect(result.summary.docCount).toBe(3);

      // The archive really exists on disk and unpacks cleanly.
      const archivePath = join(destinationRoot, result.artifactPath);
      const archiveBytes = new Uint8Array(await fs.readFile(archivePath));
      const archive = readZip(archiveBytes);

      expect(archive.data.has('README.md')).toBe(true);
      expect(archive.data.has('ARCHITECTURE.md')).toBe(true);
      expect(archive.data.has('COMPONENTS.md')).toBe(true);

      for (const path of report.files) {
        expect(archive.data.has(path), `missing ${path}`).toBe(true);
        const onDisk = new Uint8Array(await fs.readFile(join(projectRoot, path)));
        const extracted = archive.data.get(path)!;
        expect(Array.from(extracted), `bytes differ for ${path}`).toEqual(Array.from(onDisk));
      }

      // Every entry's recorded CRC matches its extracted bytes.
      for (const entry of archive.entries) {
        const extracted = archive.data.get(entry.path)!;
        expect(entry.uncompressedSize).toBe(extracted.length);
      }

      const readme = new TextDecoder().decode(archive.data.get('README.md')!);
      expect(readme).toContain('# Resite Generated App');
    }, 120_000);
  }
);
