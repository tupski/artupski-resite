/**
 * In-page extraction script - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 3 and 5.
 *
 * The extractor runs INSIDE the page's JavaScript context via
 * `page.evaluate()`. It therefore must be fully self-contained: it cannot close
 * over host variables, imports, or helpers. We ship it as a source string and
 * evaluate it with an explicit function name so it is never string-concatenated
 * with any dynamic input (no injection surface).
 *
 * It collects metadata and structure ONLY. It does not serialize the DOM,
 * compute styles, record network traffic, or take screenshots - those belong to
 * later phases.
 */

/** Name of the function defined by `PAGE_EXTRACTOR_SOURCE`. */
export const PAGE_EXTRACTOR_FUNCTION_NAME = '__artupskiExtractPage';

/**
 * Self-contained page extractor. Returns an object matching the raw-evidence
 * subset of `PageExtraction` (the worker adds requestedUrl/finalUrl/httpStatus).
 */
export const PAGE_EXTRACTOR_SOURCE = `
function ${PAGE_EXTRACTOR_FUNCTION_NAME}() {
  var MAX_HEADINGS = 300;
  var MAX_LINKS = 800;
  var MAX_IMAGES = 500;
  var MAX_TEXT = 4000;

  function textOf(el) {
    if (!el) return '';
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  }

  function metaContent(selector) {
    var el = document.querySelector(selector);
    if (!el) return null;
    var value = el.getAttribute('content');
    return value === null ? null : value;
  }

  var warnings = [];
  var title = typeof document.title === 'string' ? document.title : '';
  if (title.trim().length === 0) warnings.push('missing_title');

  var headings = [];
  var headingEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var i = 0; i < headingEls.length && headings.length < MAX_HEADINGS; i++) {
    var h = headingEls[i];
    var level = parseInt(h.tagName.substring(1), 10);
    var text = textOf(h);
    if (text.length > 0) headings.push({ level: level, text: text });
  }
  if (headings.length === 0) warnings.push('missing_headings');

  var links = [];
  var anchorEls = document.querySelectorAll('a[href]');
  for (var j = 0; j < anchorEls.length && links.length < MAX_LINKS; j++) {
    var href = anchorEls[j].getAttribute('href');
    if (href && href.length > 0) links.push(href);
  }

  var images = [];
  var imageEls = document.querySelectorAll('img');
  for (var k = 0; k < imageEls.length && images.length < MAX_IMAGES; k++) {
    var img = imageEls[k];
    var src = img.getAttribute('src') || img.currentSrc || '';
    if (src && src.length > 0) {
      images.push({ src: src, alt: img.getAttribute('alt') || '' });
    }
  }

  var canonicalEl = document.querySelector('link[rel="canonical"]');
  var canonicalUrl = canonicalEl ? canonicalEl.getAttribute('href') : null;

  var domNodeCount = document.querySelectorAll('*').length;

  var loadTimeMs = 0;
  var domContentLoadedTimeMs = 0;
  try {
    var navEntries = performance.getEntriesByType('navigation');
    if (navEntries && navEntries.length > 0) {
      var nav = navEntries[0];
      loadTimeMs = Math.round(nav.loadEventEnd || nav.duration || 0);
      domContentLoadedTimeMs = Math.round(nav.domContentLoadedEventEnd || 0);
    }
  } catch (e) {
    loadTimeMs = 0;
    domContentLoadedTimeMs = 0;
  }

  return {
    title: title,
    metaDescription: metaContent('meta[name="description"]'),
    canonicalUrl: canonicalUrl,
    robotsMeta: metaContent('meta[name="robots"]'),
    headings: headings,
    links: links,
    images: images,
    metrics: {
      loadTimeMs: loadTimeMs,
      domContentLoadedTimeMs: domContentLoadedTimeMs,
      domNodeCount: domNodeCount
    },
    warnings: warnings
  };
}
`;

/**
 * The single evaluable expression passed to `page.evaluate`. It defines the
 * extractor and immediately returns its result, so it works in one page
 * execution (a bare function definition would not persist between calls).
 */
export const PAGE_EXTRACTOR_EXPRESSION = `(() => { ${PAGE_EXTRACTOR_SOURCE} return ${PAGE_EXTRACTOR_FUNCTION_NAME}(); })()`;

/** Build the evaluable expression used by `page.evaluate`. */
export function buildExtractorExpression(): string {
  return PAGE_EXTRACTOR_EXPRESSION;
}
