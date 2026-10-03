/**
 * Stage packaged worker bundles - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.2, 8.3 and
 * §14 (C1).
 *
 * A packaged Tauri app cannot run the co-located TypeScript workers: `vite build`
 * emits only the webview bundle into `dist/`, and there is no TypeScript source
 * on the end user's machine. This script produces the worker trees that the
 * bundler ships as Tauri `resources` (see `src-tauri/tauri.conf.json`):
 *
 *   src-tauri/resources/workers/crawler/index.js       (self-contained CJS bundle)
 *   src-tauri/resources/workers/cloneServer/index.js   (self-contained CJS bundle)
 *   src-tauri/resources/node_modules/playwright-core/  (external runtime dep)
 *
 * `playwright-core` is deliberately EXTERNAL (not inlined): it resolves its own
 * optional `chromium-bidi` modules at runtime, so inlining it breaks. It is
 * copied next to the workers so Node's CommonJS resolution finds it from
 * `<resourceDir>/workers/<name>/index.js` (walking up to
 * `<resourceDir>/node_modules`). The Playwright BROWSER BINARY is still the host
 * prerequisite (`npx playwright install chromium`); it is never bundled.
 *
 * The script is invoked by `npm run tauri:build` through
 * `build.beforeBuildCommand` and can be run directly:
 *   node scripts/stageWorkers.mjs
 *
 * Output is deterministic and safe to re-run (the resources tree is rebuilt).
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESOURCES = join(ROOT, 'src-tauri', 'resources');

/** Worker entrypoints to bundle. Keep names in sync with `workerRuntime.ts`. */
const WORKERS = [
  { name: 'crawler', entry: join(ROOT, 'src', 'workers', 'crawler', 'index.ts') },
  { name: 'cloneServer', entry: join(ROOT, 'src', 'workers', 'cloneServer', 'index.ts') }
];

/** Runtime dependencies that must sit next to the workers (never inlined). */
const EXTERNAL_PACKAGES = ['playwright-core'];

async function main() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    throw new Error(
      'esbuild is required to stage workers but could not be resolved. Run `npm install` first.'
    );
  }

  // Rebuild from scratch so a removed worker never lingers in the bundle.
  await rm(RESOURCES, { recursive: true, force: true });
  await mkdir(join(RESOURCES, 'workers'), { recursive: true });

  for (const worker of WORKERS) {
    if (!existsSync(worker.entry)) {
      throw new Error(`Worker entrypoint not found: ${worker.entry}`);
    }
    const outDir = join(RESOURCES, 'workers', worker.name);
    await mkdir(outDir, { recursive: true });
    await esbuild.build({
      entryPoints: [worker.entry],
      outfile: join(outDir, 'index.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      // Keep these as runtime requires so playwright-core's own resolution works.
      external: [...EXTERNAL_PACKAGES],
      legalComments: 'none',
      logLevel: 'warning'
    });
    // The bundle is CommonJS; the repo root package.json is `"type": "module"`,
    // so mark the worker directory explicitly as CommonJS.
    await writeFile(join(outDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
    console.log(`[stageWorkers] staged workers/${worker.name}/index.js`);
  }

  // Copy the external runtime dependencies beside the workers.
  const nodeModulesOut = join(RESOURCES, 'node_modules');
  await mkdir(nodeModulesOut, { recursive: true });
  for (const pkg of EXTERNAL_PACKAGES) {
    const source = join(ROOT, 'node_modules', pkg);
    if (!existsSync(source)) {
      throw new Error(
        `Runtime dependency "${pkg}" is not installed. Run \`npm install\` before packaging.`
      );
    }
    await cp(source, join(nodeModulesOut, pkg), { recursive: true });
    console.log(`[stageWorkers] staged node_modules/${pkg}`);
  }

  console.log(`[stageWorkers] done -> ${RESOURCES}`);
}

main().catch((error) => {
  console.error(`[stageWorkers] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
