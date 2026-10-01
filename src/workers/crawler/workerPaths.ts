/**
 * Worker entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated crawler worker (`src/workers/crawler/
 * index.ts`) with the local Node.js runtime. Kept separate from the runtime so
 * the path logic is unit-testable and the Rust spawner receives a plain
 * `{ command, args, cwd }` triple.
 *
 * The worker is TypeScript executed through Node's native type stripping (Node
 * >= 22.6 / 24). The `--experimental-strip-types` flag is passed explicitly so
 * the behaviour is identical on Node 22 and 24.
 *
 * SECURITY: `command` is always `node` (on the Rust allowlist) and `args` is an
 * array - there is never a shell string. The worker path is derived from the
 * module location, not from user input.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface WorkerEntrypoint {
  command: string;
  args: string[];
  cwd: string;
}

/** Absolute path to the worker entrypoint (`src/workers/crawler/index.ts`). */
export function resolveWorkerScriptPath(): string {
  // This module lives in the same directory as the worker entrypoint.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'index.ts');
}

/** Build the spawn descriptor for the crawler worker. */
export function resolveWorkerEntrypoint(): WorkerEntrypoint {
  const script = resolveWorkerScriptPath();
  return {
    command: process.platform === 'win32' ? 'node.exe' : 'node',
    args: ['--experimental-strip-types', script],
    cwd: dirname(script)
  };
}
