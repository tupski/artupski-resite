/**
 * CSS rewriting - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md section 4.
 *
 * Rewrites a captured stylesheet so its `url(...)` references point at the local
 * asset copies, and removes duplicate `@charset` declarations (a concatenated
 * stylesheet may carry several). It is intentionally conservative: it rewrites
 * only `url(...)` tokens it can map and leaves everything else byte-for-byte.
 */
import type { AssetMap } from '../../types/clone';

export interface CssRewriteOptions {
  assetMap: AssetMap;
  /** Local path of the CSS file (e.g. `css/styles.css`) inside the clone tree. */
  cssPath: string;
}

/** Compute a stylesheet's relative reference to a target local path. */
function relativeFromCssFile(cssPath: string, target: string): string {
  const depth = cssPath.split('/').length - 1;
  if (depth <= 0) {
    return target;
  }
  return `${'../'.repeat(depth)}${target}`;
}

/**
 * Rewrite a stylesheet. Pure and idempotent for already-local references.
 */
export function rewriteCss(css: string, options: CssRewriteOptions): string {
  let output = css;

  // Collapse duplicate @charset declarations; keep at most the first.
  let seenCharset = false;
  output = output.replace(/@charset\s+("[^"]*"|'[^']*')\s*;/gi, (match) => {
    if (seenCharset) {
      return '';
    }
    seenCharset = true;
    return match;
  });

  // Rewrite url(...) references (quoted or bare).
  output = output.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed.startsWith('data:') || trimmed.startsWith('#')) {
        return match;
      }
      const mapped =
        options.assetMap[trimmed] ??
        options.assetMap[trimmed.replace(/^\//, '')] ??
        options.assetMap[trimmed.replace(/^\.\//, '')];
      if (!mapped) {
        return match;
      }
      const local = relativeFromCssFile(options.cssPath, mapped);
      const q = quote || "'";
      return `url(${q}${local}${q})`;
    }
  );

  return output;
}
