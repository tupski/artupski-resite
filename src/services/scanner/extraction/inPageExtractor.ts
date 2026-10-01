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
  var MAX_SCRIPT_SRCS = 200;
  var MAX_META_TAGS = 64;
  var MAX_META_VALUE = 512;
  var MAX_DOM_MARKERS = 100;
  var MAX_HTML_SNIPPET = 8192;
  var MAX_BODY_SNIPPET = 2048;

  // Known custom-element / distinctive markers that identify an engine. Probed
  // by selector only - nothing is executed and no page script is invoked.
  var DOM_MARKER_SELECTORS = [
    'astro-island', 'astro-slot', 'next-route-announcer', '__next', '#__next',
    'nuxt-link', '#__nuxt', '[data-nuxt]', '[data-reactroot]', '[data-reactid]',
    'gatsby-image', '[data-gatsby]', '#__gatsby', '[data-svelte]', '[data-solid]',
    '#app[data-v-app]', '[data-v-]', 'shopify-section', '[data-shopify]',
    'stencil-component', 'ion-app', '[data-wf-page]', '[data-wf-site]',
    'turbo-frame', '[data-turbo]', '[data-hydrate]'
  ];

  // Well-known JS global presence probes. Only the BOOLEAN presence is recorded;
  // no value is read or returned, so no site code is evaluated.
  var JS_GLOBAL_PROBES = [
    '__NEXT_DATA__', '__NUXT__', '__remixContext', '__svelte', '__solid',
    '__GATSBY', 'React', 'Vue', 'angular', 'Alpine', 'jQuery', 'Swiper',
    'gsap', 'Chart', 'd3', '_'
  ];

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

  var scriptSrcs = [];
  var scriptEls = document.querySelectorAll('script[src]');
  for (var s = 0; s < scriptEls.length && scriptSrcs.length < MAX_SCRIPT_SRCS; s++) {
    var scriptSrc = scriptEls[s].getAttribute('src');
    if (scriptSrc && scriptSrc.length > 0) scriptSrcs.push(scriptSrc);
  }

  var metaTags = {};
  var metaCount = 0;
  var metaEls = document.querySelectorAll('meta');
  for (var m = 0; m < metaEls.length && metaCount < MAX_META_TAGS; m++) {
    var metaEl = metaEls[m];
    var metaKey = metaEl.getAttribute('name') || metaEl.getAttribute('property') || metaEl.getAttribute('http-equiv');
    if (!metaKey) continue;
    var metaValue = metaEl.getAttribute('content');
    if (metaValue === null) continue;
    var key = metaKey.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(metaTags, key)) continue;
    metaTags[key] = metaValue.length > MAX_META_VALUE ? metaValue.slice(0, MAX_META_VALUE) : metaValue;
    metaCount++;
  }

  var domMarkers = [];
  for (var d = 0; d < DOM_MARKER_SELECTORS.length && domMarkers.length < MAX_DOM_MARKERS; d++) {
    var selector = DOM_MARKER_SELECTORS[d];
    try {
      if (document.querySelector(selector)) domMarkers.push(selector);
    } catch (e) {
      // An invalid selector must never break extraction.
    }
  }

  var jsGlobals = {};
  for (var g = 0; g < JS_GLOBAL_PROBES.length; g++) {
    var globalName = JS_GLOBAL_PROBES[g];
    try {
      jsGlobals[globalName] = typeof window[globalName] !== 'undefined' && window[globalName] !== null;
    } catch (e) {
      jsGlobals[globalName] = false;
    }
  }

  // Structural signature only: <head> plus the opening of <body> (enough for
  // id="__next"/data-reactroot style markers). Body text is not targeted and the
  // whole snippet is length-capped.
  var headHtml = document.head ? document.head.innerHTML : '';
  var bodyHtml = document.body ? document.body.innerHTML : '';
  if (bodyHtml.length > MAX_BODY_SNIPPET) bodyHtml = bodyHtml.slice(0, MAX_BODY_SNIPPET);
  var htmlSnippet = headHtml + bodyHtml;
  if (htmlSnippet.length > MAX_HTML_SNIPPET) htmlSnippet = htmlSnippet.slice(0, MAX_HTML_SNIPPET);

  var domNodeCount = document.querySelectorAll('*').length;

  // Auth-wall DOM signals (AUTH-SCANNING.md section 3.1). Presence probes only;
  // no value is read and no script is executed. The redirect-to-login signal is
  // computed worker-side from the requested/final URLs, so it is not produced here.
  var hasPasswordField = false;
  try {
    hasPasswordField = document.querySelector('input[type="password"]') !== null;
  } catch (e) {
    hasPasswordField = false;
  }
  var hasCaptcha = false;
  try {
    var captchaSelectors = [
      '.g-recaptcha', '[data-sitekey]', '#cf-challenge-running', '#challenge-form',
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]',
      '[class*="turnstile"]'
    ];
    for (var c = 0; c < captchaSelectors.length; c++) {
      if (document.querySelector(captchaSelectors[c])) {
        hasCaptcha = true;
        break;
      }
    }
  } catch (e) {
    hasCaptcha = false;
  }

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
    loginSignals: {
      hasPasswordField: hasPasswordField,
      hasCaptcha: hasCaptcha
    },
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
    tech: {
      // Response headers and cookies are captured worker-side (they live on the
      // Playwright response, not in the DOM); seeds here keep the shape stable.
      responseHeaders: {},
      cookieNames: [],
      scriptSrcs: scriptSrcs,
      metaTags: metaTags,
      domMarkers: domMarkers,
      jsGlobals: jsGlobals,
      htmlSnippet: htmlSnippet
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

/**
 * Self-contained login-wall probe used by the `detectLogin` worker command.
 * It is a pure presence check (password input / sign-in form / CAPTCHA marker)
 * and executes no page script of its own. Kept separate from the full extractor
 * so a session-verification pass does not pay for a whole page extraction.
 */
export const LOGIN_PROBE_EXPRESSION = `(() => {
  var hasPasswordField = false;
  var hasLoginForm = false;
  var hasCaptcha = false;
  try { hasPasswordField = document.querySelector('input[type="password"]') !== null; } catch (e) {}
  try { hasLoginForm = document.querySelector('form[action*="login" i], form[action*="signin" i], form[action*="auth" i]') !== null; } catch (e) {}
  try {
    var sels = ['.g-recaptcha', '[data-sitekey]', '#cf-challenge-running', '#challenge-form',
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]', '[class*="turnstile"]'];
    for (var i = 0; i < sels.length; i++) { if (document.querySelector(sels[i])) { hasCaptcha = true; break; } }
  } catch (e) {}
  return { hasPasswordField: hasPasswordField || hasLoginForm, hasCaptcha: hasCaptcha };
})()`;
