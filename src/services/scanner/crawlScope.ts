/**
 * Crawl scope - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 2.2 (internal vs external).
 *
 * Scope decides which discovered links may be followed recursively. External
 * links are catalogued but never enqueued. Internal means same ORIGIN (scheme +
 * host + port) as the seed, optionally including subdomains, and within the
 * configured base path. Scheme/port differences are therefore treated as
 * cross-origin (external). This module is pure.
 */
// NOTE: the `.ts` extension is required so the dedicated Node worker (which
// runs these files via Node's native type stripping) can resolve the chain.
import { normalizeUrl } from './normalization.ts';

export interface CrawlScopeOptions {
  /** Whether subdomains of the seed host are considered internal. Default: false. */
  includeSubdomains?: boolean;
  /** Restrict crawling to this path prefix (e.g. `/docs`). Default: whole site. */
  basePath?: string;
}

export interface CrawlScope {
  /** Lowercased seed hostname. */
  host: string;
  /** Seed scheme, e.g. `https:`. */
  protocol: string;
  /** Effective seed port (explicit, or the scheme default). */
  port: number;
  includeSubdomains: boolean;
  /** Normalized base path prefix (always starts with `/`, no trailing slash). */
  basePath: string;
}

function effectivePort(parsed: URL): number {
  if (parsed.port.length > 0) {
    return Number(parsed.port);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

/** Derive a scope descriptor from a seed URL. Returns `null` for invalid input. */
export function createCrawlScope(seedUrl: string, options: CrawlScopeOptions = {}): CrawlScope | null {
  const normalized = normalizeUrl(seedUrl);
  if (!normalized) {
    return null;
  }
  const parsed = new URL(normalized);
  let basePath = options.basePath ?? '/';
  if (!basePath.startsWith('/')) {
    basePath = `/${basePath}`;
  }
  if (basePath.length > 1 && basePath.endsWith('/')) {
    basePath = basePath.replace(/\/+$/, '');
  }
  return {
    host: parsed.hostname.toLowerCase(),
    protocol: parsed.protocol,
    port: effectivePort(parsed),
    includeSubdomains: options.includeSubdomains ?? false,
    basePath
  };
}

/** True when `hostname` is the seed host or an allowed subdomain of it. */
export function isHostInScope(hostname: string, scope: CrawlScope): boolean {
  const host = hostname.toLowerCase();
  if (host === scope.host) {
    return true;
  }
  return scope.includeSubdomains && host.endsWith(`.${scope.host}`);
}

/** True when the URL's path is within the configured base path. */
export function isPathInScope(pathname: string, scope: CrawlScope): boolean {
  if (scope.basePath === '/' || scope.basePath === '') {
    return true;
  }
  return pathname === scope.basePath || pathname.startsWith(`${scope.basePath}/`);
}

export type LinkClassification = 'internal' | 'external' | 'invalid';

/** Classify a normalized URL as internal or external relative to the scope. */
export function classifyLink(url: string, scope: CrawlScope): LinkClassification {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== scope.protocol) {
    return 'external';
  }
  if (!isHostInScope(parsed.hostname, scope)) {
    return 'external';
  }
  if (effectivePort(parsed) !== scope.port) {
    return 'external';
  }
  if (!isPathInScope(parsed.pathname, scope)) {
    return 'external';
  }
  return 'internal';
}

/** True when a URL may be enqueued for recursive crawling. */
export function isUrlInScope(url: string, scope: CrawlScope): boolean {
  return classifyLink(url, scope) === 'internal';
}
