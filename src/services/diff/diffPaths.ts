/**
 * Visual diff path safety - Artupski ReSite
 * Source of truth: docs/security/SECURITY.md (local filesystem / traversal),
 * docs/impl-plan/phase-13-impl-plan.md sections 8, 10.
 *
 * The generated preview server must serve ONLY files inside the generated
 * project root. Rather than re-implement the Phase 8 traversal rules, this
 * module reuses the single pure policy already used by the clone preview server
 * (`src/services/clone/serverPathPolicy.ts`) so the confinement rules can never
 * drift between the two servers. This module is the thin, tested seam that ties
 * diff requests to that shared policy.
 */
import { normalizeRoot, resolveServePath, type ResolvedServePath } from '../clone/serverPathPolicy';

export { normalizeRoot };
export type { ResolvedServePath };

/**
 * Resolve a request URL pathname to a safe, root-relative POSIX path beneath the
 * generated project root. Returns `{ ok: false }` for anything that could escape
 * the root (`..`, absolute overrides, NUL bytes, backslashes, malformed
 * percent-encoding) - identical guarantees to the clone preview server.
 */
export function resolveGeneratedServePath(rawPathname: string, root: string): ResolvedServePath {
  if (typeof root !== 'string' || normalizeRoot(root).length === 0) {
    return { ok: false, reason: 'empty_root' };
  }
  return resolveServePath(rawPathname, root);
}
