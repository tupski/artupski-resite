/**
 * Local preview server path policy - Artupski ReSite
 * Source of truth: docs/security/SECURITY.md (local filesystem / traversal) and
 * docs/impl-plan/phase-8-impl-plan.md (open decision C5).
 *
 * The clone preview server must serve ONLY files inside the clone root. This
 * module is the single, pure place that decides whether a request path is
 * servable. It is used by the `cloneServer` worker and unit-tested directly so
 * the traversal rules cannot silently regress.
 *
 * Rules:
 * - the root is normalized to forward slashes and has no trailing slash;
 * - the request path is URL-decoded, its query/fragment dropped, and resolved to
 *   an absolute POSIX path under the root;
 * - any path that escapes the root (via `..`, an absolute override, a NUL byte,
 *   or a backslash) is REJECTED;
 * - a directory request resolves to `index.html`; a missing extension keeps the
 *   requested file (the caller decides 404).
 */

export interface ResolvedServePath {
  ok: boolean;
  /** Root-relative POSIX path (no leading slash) when ok. */
  relative?: string;
  /** Non-sensitive reason when rejected. */
  reason?: string;
}

/** Normalize a filesystem root for comparison (forward slashes, no trailing slash). */
export function normalizeRoot(root: string): string {
  const withSlashes = root.replace(/\\/g, '/');
  return withSlashes.endsWith('/') ? withSlashes.slice(0, -1) : withSlashes;
}

/**
 * Resolve a request URL pathname to a safe, root-relative POSIX file path.
 * Returns `{ ok: false }` for anything that could escape the root.
 */
export function resolveServePath(rawPathname: string, root: string): ResolvedServePath {
  if (typeof rawPathname !== 'string' || rawPathname.length === 0) {
    return { ok: false, reason: 'empty_path' };
  }
  if (rawPathname.includes('\0')) {
    return { ok: false, reason: 'nul_byte' };
  }

  // Drop the query string and fragment.
  let pathname = rawPathname;
  const hashIndex = pathname.indexOf('#');
  if (hashIndex >= 0) {
    pathname = pathname.slice(0, hashIndex);
  }
  const queryIndex = pathname.indexOf('?');
  if (queryIndex >= 0) {
    pathname = pathname.slice(0, queryIndex);
  }

  // Decode percent-encoding; a malformed encoding is rejected.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, reason: 'malformed_encoding' };
  }
  if (decoded.includes('\0')) {
    return { ok: false, reason: 'nul_byte' };
  }
  // Backslashes are treated as separators by Windows; reject outright.
  if (decoded.includes('\\')) {
    return { ok: false, reason: 'backslash' };
  }
  // A root-relative request is expected (`/...`). Anything else is rejected.
  if (!decoded.startsWith('/')) {
    return { ok: false, reason: 'not_absolute_path' };
  }

  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  const safeSegments: string[] = [];
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      return { ok: false, reason: 'traversal' };
    }
    safeSegments.push(segment);
  }

  if (safeSegments.length === 0) {
    // Root request -> index.html.
    return { ok: true, relative: 'index.html' };
  }

  const relative = safeSegments.join('/');
  // Re-verify containment even though segments were checked (defence in depth).
  const candidate = `${normalizeRoot(root)}/${relative}`;
  if (!candidate.startsWith(`${normalizeRoot(root)}/`)) {
    return { ok: false, reason: 'escape' };
  }
  return { ok: true, relative };
}

/** Minimal content-type map for the file extensions the clone tree contains. */
export function contentTypeFor(relative: string): string {
  const dot = relative.lastIndexOf('.');
  const ext = dot >= 0 ? relative.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'js':
    case 'mjs':
      return 'text/javascript; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'ico':
      return 'image/x-icon';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
