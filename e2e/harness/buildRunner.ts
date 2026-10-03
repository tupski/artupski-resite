/**
 * Opt-in generated-project build runner - Artupski ReSite (Phase 16 E2E)
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 9.1, 9.2 and the
 * Phase 12 build-E2E precedent (`projectGenerator.build.e2e.test.ts`).
 *
 * Runs the generated project's OWN `npm install` + `npm run build` and reports an
 * honest outcome. Nothing is mocked. A host-level npm `allow-scripts` config
 * (npm 11) is neutralized for the child so the generated project installs as a
 * clean standalone project.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface RunOutcome {
  code: number;
  output: string;
}

/** Run a command in `cwd`, streaming output; resolves with `{ code, output }`. */
export function run(command: string, args: string[], cwd: string): Promise<RunOutcome> {
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

/** The platform npm binary. */
export function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Whether an executable can be resolved on PATH (best-effort, cross-platform). */
export async function hasCommand(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const outcome = await run(probe, [command], process.cwd());
  return outcome.code === 0;
}

/**
 * Install + build a generated project. Returns `{ ok, reason, install, build }`.
 * `ok` is false (with an honest reason) when npm or the build is unavailable;
 * the caller reports BLOCKED rather than a false PASS.
 */
export async function installAndBuild(
  root: string
): Promise<{ ok: boolean; reason?: string; install: RunOutcome; build: RunOutcome }> {
  const npm = npmCommand();
  if (!(await hasCommand(npm))) {
    return {
      ok: false,
      reason: `${npm} is not available on PATH.`,
      install: { code: 1, output: '' },
      build: { code: 1, output: '' }
    };
  }
  const install = await run(npm, ['install', '--no-audit', '--no-fund'], root);
  if (install.code !== 0) {
    return { ok: false, reason: 'npm install failed.', install, build: { code: 1, output: '' } };
  }
  const build = await run(npm, ['run', 'build'], root);
  if (build.code !== 0) {
    return { ok: false, reason: 'npm run build failed.', install, build };
  }
  return { ok: true, install, build };
}

/** True when the generated project produced a `dist/index.html`. */
export async function hasDistIndexHtml(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(join(root, 'dist', 'index.html'));
    return stat.isFile();
  } catch {
    return false;
  }
}
