/**
 * Clone path derivation - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md sections 2-3.
 *
 * Pure, side-effect-free helpers that map a crawled URL / asset to a local path
 * inside the clone tree. They are the ONLY place local clone paths are built, so
 * the traversal-safety rules are enforced once and unit-tested directly:
 *
 * - every produced path is RELATIVE and uses `/` separators;
 * - a URL path segment may never contain `..` or a path separator (a hostile or
 *   malformed URL cannot escape the clone root);
 * - the asset name is content-hashed (`name_<hash>.<ext>`) so identical payloads
 *   map to one file and name collisions are impossible.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The extension (without dot) from a URL pathname, lower-cased; '' when none. */
export function extensionFromUrl(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const last = pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0 || dot === last.length - 1) {
      return '';
    }
    const ext = last.slice(dot + 1).toLowerCase();
    return SAFE_SEGMENT.test(ext) ? ext : '';
  } catch {
    return '';
  }
}

/** A filesystem-safe slug for a URL path segment; never empty. */
export function slugifySegment(segment: string): string {
  const cleaned = segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'index';
}

/**
 * Local page file for a crawled URL. The seed/root page maps to `index.html`;
 * every other route maps under `pages/<slug>.html` (CLONE-SPEC section 2).
 */
export function pagePathForUrl(url: string, sourceOrigin: string): string {
  let pathname = '/';
  try {
    const parsed = new URL(url);
    if (parsed.origin !== sourceOrigin) {
      // Out-of-origin pages are not part of the clone; still produce a safe name.
      pathname = parsed.pathname;
    } else {
      pathname = parsed.pathname;
    }
  } catch {
    pathname = '/';
  }

  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  if (trimmed.length === 0) {
    return 'index.html';
  }
  const segments = trimmed
    .split('/')
    .filter((segment) => segment.length > 0)
    // Reject any traversal attempt outright: a `..` segment can never form a path.
    .map((segment) => (segment === '..' || segment === '.' ? 'x' : slugifySegment(segment)));
  if (segments.length === 0) {
    return 'index.html';
  }
  return `pages/${segments.join('_')}.html`;
}

/** The assets subdirectory a given asset kind is written to (CLONE-SPEC section 2). */
export function assetDirForType(assetType: string): string {
  switch (assetType) {
    case 'image':
      return 'assets/images';
    case 'font':
      return 'assets/fonts';
    case 'video':
    case 'audio':
      return 'assets/media';
    default:
      return 'assets';
  }
}

/**
 * Local path for a captured asset: `<assets dir>/<name>_<sha8>.<ext>`. The
 * content hash guarantees a stable, collision-free name.
 */
export function assetPathFor(sourceUrl: string, assetType: string, sha256: string): string {
  const dir = assetDirForType(assetType);
  const ext = extensionFromUrl(sourceUrl) || 'bin';
  let base = 'asset';
  try {
    const last = new URL(sourceUrl).pathname.split('/').pop() ?? 'asset';
    const dot = last.lastIndexOf('.');
    base = slugifySegment(dot > 0 ? last.slice(0, dot) : last);
  } catch {
    base = 'asset';
  }
  const shortHash = sha256.slice(0, 8) || '00000000';
  return `${dir}/${base}_${shortHash}.${ext}`;
}

/**
 * Compute a page's relative reference to a target local path, accounting for
 * the page's directory depth (CLONE-SPEC section 3.1 `getRelativePath`). A page
 * at the root (`index.html`) references `assets/x.png` directly; a page under
 * `pages/` references `../assets/x.png`.
 */
export function relativeFromPage(pagePath: string, targetPath: string): string {
  const depth = pagePath.split('/').length - 1;
  if (depth <= 0) {
    return targetPath;
  }
  return `${'../'.repeat(depth)}${targetPath}`;
}

/**
 * Rewrite the CSS `url(...)` reference from a stylesheet that lives at
 * `css/styles.css`, so a cloned CSS file references assets one level up
 * (`../assets/...`). Returns the target unchanged when it is already relative
 * or a data URL.
 */
export function relativeFromCss(targetPath: string): string {
  if (/^(data:|https?:|mailto:|tel:|#|\/\/)/i.test(targetPath)) {
    return targetPath;
  }
  return `../${targetPath}`;
}

/** True when a relative clone path is safe to hand to the sandboxed writer. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) {
    return false;
  }
  return path
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '..' && segment !== '.');
}
