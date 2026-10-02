/**
 * Generated-project path safety & derivation - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md sections 4.4, 4.6, 4.7.
 *
 * Pure, side-effect-free helpers. This is the ONLY place generated file paths are
 * built and verified, so the traversal-safety rules are enforced once and tested
 * directly. Every produced path is RELATIVE and uses `/` separators; resolution
 * against the target root is re-verified so no path can escape it.
 *
 * Platform note: ReSite is developed on Windows, so the rules explicitly reject
 * Windows drive paths (`C:\...`), UNC paths (`\\server\share`), backslashes, NUL
 * and other control characters - not just POSIX `..` traversal.
 */
import { sanitizeFileName } from './componentSynthesizer';

/** Windows drive prefix, e.g. `C:` or `c:/`. */
const DRIVE_PREFIX = /^[A-Za-z]:/;
/** Control characters (0x00-0x1F) and DEL (0x7F) are never valid in a path. */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * True when a POSIX-relative path is safe to resolve beneath a target root.
 * Rejects: empty paths, absolute POSIX paths, Windows drive paths, UNC paths,
 * backslashes, control characters, `.`/`..` segments, and empty segments.
 */
export function isSafeProjectRelativePath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (path.startsWith('/') || path.startsWith('\\') || path.includes('\\')) {
    return false;
  }
  if (DRIVE_PREFIX.test(path)) {
    return false;
  }
  if (hasControlChars(path)) {
    return false;
  }
  return path
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Count path segments (depth). Callers bound this with `MAX_PROJECT_PATH_DEPTH`. */
export function pathDepth(path: string): number {
  return path.split('/').filter((segment) => segment.length > 0).length;
}

/** A filesystem-safe slug for one path segment; never empty (mirrors clonePaths). */
export function slugifyPathSegment(segment: string): string {
  const cleaned = segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'index';
}

/** A safe, lower-cased file extension (no dot) derived from a value; '' when none. */
export function safeExtension(value: string): string {
  const last = value.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) {
    return '';
  }
  const ext = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/** Map a MIME type to a conservative extension for assets missing one. */
export function extensionFromMime(mimeType: string | undefined): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico';
    case 'font/woff':
      return 'woff';
    case 'font/woff2':
      return 'woff2';
    case 'application/json':
      return 'json';
    default:
      return '';
  }
}

/** PascalCase identifier from a candidate string, guaranteed to start a letter. */
export function toPascalCase(value: string): string {
  const parts = value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const joined = parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
  if (joined.length === 0) {
    return 'Page';
  }
  return /^[A-Za-z]/.test(joined) ? joined : `Page${joined}`;
}

/**
 * Sanitize a component file name to a safe logical basename. Delegates to the
 * Phase 11 `sanitizeFileName` so the same rule is used in both phases, then
 * strips any residual path separators.
 */
export function safeComponentFileName(fileName: string, name: string): string {
  const base = sanitizeFileName(fileName, name).split('/').pop() ?? '';
  return base.length > 0 ? base : `${name}.tsx`;
}

/** Sanitize a hook file name to a safe `*.ts`/`*.tsx` basename under `src/hooks`. */
export function safeHookFileName(fileName: string, name: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim() ?? '';
  if (base === '' || !/\.tsx?$/.test(base) || !isSafeProjectRelativePath(base)) {
    return `${slugifyPathSegment(name)}.ts`;
  }
  return base;
}

/**
 * Derive a safe, collision-free asset path under `public/assets`. The caller
 * supplies a hint (BluePrint `local_path` or a logical name); the basename is
 * slugified and the extension is preserved or derived from the MIME type.
 */
export function safeAssetPath(
  hint: string,
  mimeType: string | undefined,
  used: Set<string>
): string {
  const rawBase = hint.split(/[\\/]/).pop()?.trim() ?? '';
  const hintExt = safeExtension(rawBase);
  const ext = hintExt || extensionFromMime(mimeType);
  const stemRaw =
    hintExt.length > 0 ? rawBase.slice(0, rawBase.length - hintExt.length - 1) : rawBase;
  const stem = slugifyPathSegment(stemRaw === '' ? 'asset' : stemRaw);
  let candidate = ext.length > 0 ? `public/assets/${stem}.${ext}` : `public/assets/${stem}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate =
      ext.length > 0 ? `public/assets/${stem}-${suffix}.${ext}` : `public/assets/${stem}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Resolve `relative` against `targetRoot` and assert the resolved absolute path
 * stays inside the root. Pure string/POSIX logic (no `node:path`) so it works in
 * the browser preview and is trivially testable; the writer additionally relies
 * on the OS for the final atomic write.
 *
 * Returns the absolute, POSIX-normalized path when safe, or `null` when the
 * relative path is unsafe or resolves outside `targetRoot`.
 */
export function resolveWithinRoot(targetRoot: string, relative: string): string | null {
  if (!isSafeProjectRelativePath(relative)) {
    return null;
  }
  const root = normalizeAbsolute(targetRoot);
  if (root === null) {
    return null;
  }
  const joined = `${root}/${relative}`;
  const normalized = normalizeSegments(joined);
  if (normalized === null || !isWithin(root, normalized)) {
    return null;
  }
  return normalized;
}

/** Normalize an absolute path to POSIX form (drive-letter aware), or null. */
function normalizeAbsolute(path: string): string | null {
  if (hasControlChars(path)) {
    return null;
  }
  let value = path.replace(/\\/g, '/');
  if (value.startsWith('//')) {
    // Preserve UNC `//server/share` semantics rather than collapsing to `/`.
    value = `//${value.slice(2).replace(/\/+/g, '/')}`;
  } else {
    value = value.replace(/\/+/g, '/');
  }
  const isAbsolute = value.startsWith('/') || DRIVE_PREFIX.test(value);
  if (!isAbsolute) {
    return null;
  }
  const normalized = normalizeSegments(value);
  if (normalized === null) {
    return null;
  }
  // Strip a trailing slash unless the path is exactly a root (`/` or `C:/`).
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

/** Collapse `.`/`..` segments; return null when a `..` escapes the root. */
function normalizeSegments(path: string): string | null {
  const uncPrefix = path.startsWith('//') ? '//' : '';
  const driveMatch = DRIVE_PREFIX.exec(path);
  const drive = driveMatch ? driveMatch[0] : '';
  const leadingSlash = !drive && !uncPrefix && path.startsWith('/') ? '/' : '';
  const prefix = uncPrefix || drive || leadingSlash;

  const body = path.slice(prefix.length);
  const out: string[] = [];
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (out.length === 0) {
        return null;
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const suffix = out.join('/');
  const driveNeedsSlash = drive !== '' && suffix.length > 0 ? '/' : '';
  return `${prefix}${driveNeedsSlash}${suffix}` || prefix || '/';
}

/** True when `target` is the root itself or nested beneath it. */
function isWithin(root: string, target: string): boolean {
  if (target === root) {
    return true;
  }
  const rootWithSep = root.endsWith('/') ? root : `${root}/`;
  return target.startsWith(rootWithSep);
}
