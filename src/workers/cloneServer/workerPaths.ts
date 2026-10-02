/**
 * Clone server entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated clone preview server
 * (`src/workers/cloneServer/index.ts`) with the local Node.js runtime, mirroring
 * `src/workers/crawler/workerPaths.ts`. SECURITY: `command` is always `node` (on
 * the Rust allowlist) and `args` is an array - there is never a shell string.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface WorkerEntrypoint {
  command: string;
  args: string[];
  cwd: string;
}

/** Absolute path to the clone server entrypoint. */
export function resolveCloneServerScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'index.ts');
}

/** Build the spawn descriptor for the clone preview server. */
export function resolveCloneServerEntrypoint(): WorkerEntrypoint {
  const script = resolveCloneServerScriptPath();
  return {
    command: process.platform === 'win32' ? 'node.exe' : 'node',
    args: ['--experimental-strip-types', script],
    cwd: dirname(script)
  };
}
