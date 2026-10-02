/**
 * Phase 12 end-to-end build verification - Artupski ReSite
 *
 * THE critical Phase 12 test: it generates a real project into an isolated temp
 * directory and runs the generated project's OWN `npm install` + `npm run build`,
 * then asserts `dist/` exists. Commands are NOT mocked and static inspection is
 * NOT substituted.
 *
 * It is opt-in via `RUN_PROJECT_BUILD=1` (mirroring the repo's browser-test
 * gating) because it needs the network/registry. Run explicitly with:
 *   RUN_PROJECT_BUILD=1 npx vitest run \
 *     src/services/generator/__tests__/projectGenerator.build.e2e.test.ts
 *
 * Set `KEEP_PROJECT_BUILD=1` to keep the generated dir for manual inspection.
 * If npm cannot run in the environment, the test is reported as BLOCKED (skipped)
 * rather than falsely passing.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateProject } from '../projectGenerator';
import {
  counterHook,
  heroComponent,
  logoAsset,
  phase12Blueprint,
  synthesizedComponent
} from './projectFixtures';

const ENABLED = process.env.RUN_PROJECT_BUILD === '1';
const KEEP = process.env.KEEP_PROJECT_BUILD === '1';
const roots: string[] = [];

afterAll(async () => {
  if (!KEEP) {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  }
});

/**
 * Run a command in `cwd`, streaming output; resolve with { code, output }.
 *
 * A host-level npm `allow-scripts` config (npm 11) is forwarded to a
 * project-scoped `npm install` as `--allow-scripts`, which npm rejects. We
 * neutralize only that inherited key for the child so the generated project's
 * install behaves as a clean standalone install.
 */
function run(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, npm_config_allow_scripts: '', NPM_CONFIG_ALLOW_SCRIPTS: '' };
    const child = spawn(command, args, { cwd, shell: process.platform === 'win32', env });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

describe.skipIf(!ENABLED)('generated project builds cleanly (Phase 12 acceptance)', () => {
  it('npm install && npm run build produces dist/', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'resite-build-'));
    roots.push(root);

    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent(), heroComponent()],
        hooks: [counterHook()],
        assets: [logoAsset()],
        targetRoot: root,
        options: { projectName: 'resite-generated-app' }
      }
    );
    expect(report.ok).toBe(true);

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = await run(npm, ['install', '--no-audit', '--no-fund'], root);
    expect(install.code, `npm install failed:\n${install.output}`).toBe(0);

    const build = await run(npm, ['run', 'build'], root);
    expect(build.code, `npm run build failed:\n${build.output}`).toBe(0);

    const distStat = await fs.stat(join(root, 'dist'));
    expect(distStat.isDirectory()).toBe(true);

    // TypeScript + Vite emit an index.html into dist/.
    const indexHtml = await fs.readFile(join(root, 'dist/index.html'), 'utf8');
    expect(indexHtml).toContain('<div id="root">');

    if (KEEP) {
      // eslint-disable-next-line no-console
      console.log(`[phase12 build e2e] kept generated project at ${root}`);
    }
  }, 600_000);
});
