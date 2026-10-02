/**
 * HTML rewriting pipeline - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md section 3.
 *
 * Rewrites a captured raw HTML body so every internal reference resolves to a
 * local relative path and every external/offline-hostile reference is removed or
 * neutralised. The rules implemented (CLONE-SPEC section 3.1):
 *
 * 1. absolute / protocol-relative asset URLs -> the local path in `assetMap`;
 * 2. internal anchor links -> the local page in `routeMap`; hash fragments kept;
 *    out-of-scope external links -> `target="_blank" rel="noopener noreferrer"`;
 * 3. known tracking scripts stripped; a local `mock-client.js` stub injected;
 * 4. `<base href>` tags removed.
 *
 * DELIBERATE DEVIATION (documented, see the impl plan): CLONE-SPEC's pseudocode
 * imports `htmlparser2`/`dom-serializer`/`css-select`. Those are not dependencies
 * of this project and adding a new parser dependency is out of Phase 8 scope, so
 * this module implements a small, bounded, dependency-free tokenizer that
 * rewrites only tag attributes and `<base>`/tracking-`<script>` elements. It is
 * intentionally conservative: anything it does not understand is left untouched.
 */
import { relativeFromPage } from './clonePaths';
import type { AssetMap, RouteMap } from '../../types/clone';

/** Known third-party tracking/analytics script hosts and markers to strip. */
const TRACKING_PATTERNS: readonly RegExp[] = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /segment\.(com|io)/i,
  /connect\.facebook\.net/i,
  /hotjar\.com/i,
  /fullstory\.com/i,
  /mixpanel\.com/i,
  /cdn\.mxpnl\.com/i
];

export interface HtmlRewriteOptions {
  assetMap: AssetMap;
  routeMap: RouteMap;
  /** The local page file this HTML will be written to (e.g. `pages/about.html`). */
  pagePath: string;
  /** Local path to the injected stub script, relative to the clone root. */
  mockClientPath: string;
  /**
   * The absolute URL of the page being rewritten. Reference attributes are
   * resolved against it so a root-relative reference (`/css/app.css`) matches the
   * absolute URL key the worker captured the asset under. When omitted,
   * root-relative references only match a literal map entry.
   */
  baseUrl?: string;
}

/** Resolve a reference attribute to an absolute URL (best-effort). */
function toAbsolute(value: string, baseUrl: string | undefined): string | null {
  if (!baseUrl) {
    return null;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

/** Resolve a raw attribute URL to its local path when the map knows it. */
function rewriteReference(value: string, options: HtmlRewriteOptions): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('#')) {
    return value;
  }
  // Protocol-relative (`//host/x`) and absolute URLs are matched as-is first.
  const direct = options.assetMap[trimmed];
  if (direct) {
    return relativeFromPage(options.pagePath, direct);
  }
  // Resolve relative references against the page URL, then look up.
  const absolute = toAbsolute(trimmed, options.baseUrl);
  if (absolute && options.assetMap[absolute]) {
    return relativeFromPage(options.pagePath, options.assetMap[absolute]);
  }
  // A page-relative reference (`/css/app.css`) may also map literally.
  const withoutLeadingSlash = trimmed.replace(/^\//, '');
  const mapped = options.assetMap[withoutLeadingSlash];
  if (mapped) {
    return relativeFromPage(options.pagePath, mapped);
  }
  return value;
}

/** Rewrite a `srcset` attribute's URLs, preserving their descriptors. */
function rewriteSrcSet(value: string, options: HtmlRewriteOptions): string {
  return value
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const url = parts.shift() ?? '';
      const rewritten = rewriteReference(url, options);
      return [rewritten, ...parts].join(' ');
    })
    .join(', ');
}

/** Rewrite a route reference (anchor `href`) to a local page when known. */
function rewriteRoute(
  value: string,
  options: HtmlRewriteOptions
): { href: string; external: boolean } {
  const trimmed = value.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return { href: value, external: false };
  }
  if (options.routeMap[trimmed]) {
    return { href: relativeFromPage(options.pagePath, options.routeMap[trimmed]), external: false };
  }
  // Resolve a relative anchor against the page URL so `/about` matches a route
  // keyed by its absolute URL.
  const absoluteHref = toAbsolute(trimmed, options.baseUrl);
  if (absoluteHref && options.routeMap[absoluteHref]) {
    return {
      href: relativeFromPage(options.pagePath, options.routeMap[absoluteHref]),
      external: false
    };
  }
  // Hash fragment on an internal route: "/#features" -> "index.html#features".
  const hashIndex = trimmed.indexOf('#');
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : '';
  if (base && options.routeMap[base]) {
    return {
      href: `${relativeFromPage(options.pagePath, options.routeMap[base])}${hash}`,
      external: false
    };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { href: value, external: true };
  }
  return { href: value, external: false };
}

/**
 * Rewrite one raw HTML document. Pure: the same input + options always produce
 * identical output. Never throws on malformed markup (best-effort, conservative).
 */
export function rewriteHtml(rawHtml: string, options: HtmlRewriteOptions): string {
  let output = rawHtml;

  // 4. Strip `<base href="...">` tags first so later relative resolution is sane.
  output = output.replace(/<base\b[^>]*>/gi, '');

  // 3a. Strip known tracking scripts (whole element, including a closing tag).
  output = output.replace(
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>\s*<\/script>/gi,
    (match, dq: string, sq: string, bare: string) => {
      const src = dq ?? sq ?? bare ?? '';
      return TRACKING_PATTERNS.some((pattern) => pattern.test(src)) ? '' : match;
    }
  );

  // 1 & 2. Rewrite `src`/`href`/`poster`/`srcset` attributes on every tag.
  output = output.replace(
    /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g,
    (_match, tag: string, attrs: string) => {
      const lowerTag = tag.toLowerCase();
      if (lowerTag === 'script' && /\bsrc\s*=/i.test(attrs)) {
        // A non-tracking script: rewrite the source to its local copy when known.
        attrs = attrs.replace(
          /(\bsrc\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
          (_m: string, prefix: string, _all: string, dq: string, sq: string, bare: string) => {
            const value = dq ?? sq ?? bare ?? '';
            return `${prefix}"${rewriteReference(value, options)}"`;
          }
        );
        return `<${tag}${attrs}>`;
      }

      if (lowerTag === 'a') {
        let external = false;
        attrs = attrs.replace(
          /(\bhref\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/i,
          (_m: string, prefix: string, _all: string, dq: string, sq: string, bare: string) => {
            const value = dq ?? sq ?? bare ?? '';
            const route = rewriteRoute(value, options);
            external = route.external;
            return `${prefix}"${route.href}"`;
          }
        );
        if (external && !/\btarget\s*=/i.test(attrs)) {
          attrs = `${attrs} target="_blank" rel="noopener noreferrer"`;
        }
        return `<${tag}${attrs}>`;
      }

      attrs = attrs.replace(
        /(\b(?:src|href|poster|data-src)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (_m: string, prefix: string, _all: string, dq: string, sq: string, bare: string) => {
          const value = dq ?? sq ?? bare ?? '';
          return `${prefix}"${rewriteReference(value, options)}"`;
        }
      );
      attrs = attrs.replace(
        /(\bsrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi,
        (_m: string, prefix: string, _all: string, dq: string, sq: string) => {
          const value = dq ?? sq ?? '';
          return `${prefix}"${rewriteSrcSet(value, options)}"`;
        }
      );
      return `<${tag}${attrs}>`;
    }
  );

  // 3b. Inject the local mock-client stub just before </head> (or </body>).
  const stub = `<script src="${relativeFromPage(options.pagePath, options.mockClientPath)}"></script>`;
  if (/<\/head>/i.test(output)) {
    output = output.replace(/<\/head>/i, `${stub}</head>`);
  } else if (/<\/body>/i.test(output)) {
    output = output.replace(/<\/body>/i, `${stub}</body>`);
  } else {
    output = `${output}${stub}`;
  }

  return output;
}
