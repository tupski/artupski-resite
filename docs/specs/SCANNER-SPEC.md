# Scanner & Reverse Engineering Specification - Crawler & Analyzer Pipeline

## 1. Architecture Overview

Scanner pipeline extract complete DOM, CSS, JavaScript, network interactions, assets, and visual snapshots from web pages using headless browser automation.

```
+-----------------------------------------------------------------------------------+
|                                  PageCrawler                                      |
|  (Queue Scheduler, Frontier Manager, Concurrency Pool, Rate Limiter, Lifecycle)   |
+--------+------------------+-------------------+-------------------+---------------+
         |                  |                   |                   |
         v                  v                   v                   v
+----------------+  +---------------+   +---------------+   +-----------------------+
|  DOMAnalyzer   |  |  CSSAnalyzer  |   |  JSAnalyzer   |   |   NetworkAnalyzer     |
| (Tree, Layout) |  | (Rules, Media)|   | (Globals, AST)|   | (HAR, Headers, Paylds)|
+--------+-------+  +-------+-------+   +-------+-------+   +-----------+-----------+
         |                  |                   |                       |
         +------------------+---------+---------+-----------------------+
                                      |
                                      v
                      +-------------------------------+
                      |        AssetCollector         |
                      | (Media, Fonts, Scripts, SVGs) |
                      +---------------+---------------+
                                      |
                                      v
                      +-------------------------------+
                      |       ScreenshotEngine        |
                      | (Multi-Viewport View Capture) |
                      +-------------------------------+
```

### 1.1 Pipeline Components

1. **PageCrawler**: Controls page lifecycle, browser context instantiation, crawl frontier (queue/stack), crawl limits (depth, page cap, domain boundaries), rate limiting, and pause/resume logic.
2. **DOMAnalyzer**: Serializes DOM tree into clean semantic hierarchy, extracts layout bounding boxes, identifies form structures, landmarks, interactive triggers, and accessibility trees.
3. **CSSAnalyzer**: Collects external stylesheets, inline styles, CSS custom properties (variables), media queries, computed styles for selected nodes, font definitions, and animations.
4. **JSAnalyzer**: Evaluates runtime JavaScript environment, extracts runtime `window` globals, framework runtime signatures, attached event listeners, inline scripts, and external bundle references.
5. **NetworkAnalyzer**: Intercepts HTTP requests/responses, builds HAR recording, captures dynamic XHR/fetch endpoints, API payloads, response headers, status codes, cookies, and MIME types.
6. **AssetCollector**: Discovers, hashes, and registers all static assets (images, web fonts, vector SVGs, audio/video, stylesheets, script files) for static cloning and local replay.
7. **ScreenshotEngine**: Orchestrates multi-viewport full-page and element-level visual captures using device emulation and scroll-stitching.

---

## 2. Page Discovery & Crawling Algorithms

### 2.1 Frontier Queue & Discovery Strategy

Scanner supports both Breadth-First Search (BFS, default) and Depth-First Search (DFS) crawl strategies.

```
Algorithm: Crawl Frontier Processing (BFS)
Input: Seed URL s, MaxDepth D, MaxPages N, AllowedDomains A, ExcludedPatterns E

1. Initialize Queue Q <- [ { url: Normalize(s), depth: 0 } ]
2. Initialize VisitedSet V <- { Canonicalize(Normalize(s)) }
3. Initialize ScannedPages P <- []
4. While Q is not empty and |P| < N:
     a. Dequeue current item { u, d } from Q
     b. If IsPaused(): Await ResumeSignal()
     c. Apply RateLimiter delay
     d. PageInstance <- BrowserContext.NewPage()
     e. Execute PreNavigationHooks(PageInstance, u)
     f. Response <- PageInstance.Navigate(u, Timeout)
     g. If Response.Status in [301, 302, 307, 308]:
          TargetURL <- Normalize(Response.Header("Location"))
          If ShouldCrawl(TargetURL, d, A, E, V):
             V.Add(Canonicalize(TargetURL))
             Q.Enqueue({ url: TargetURL, depth: d })
          Close PageInstance and continue
     h. Execute Pipeline Analyzers (DOM, CSS, JS, Network, Asset, Screenshot)
     i. P.Add(ScannedPageResult)
     j. If d < D:
          ExtractedLinks <- ExtractAnchorLinks(PageInstance)
          SitemapLinks <- (d == 0 ? FetchSitemapLinks(u) : [])
          For each rawLink in (ExtractedLinks union SitemapLinks):
             normalizedLink <- NormalizeUrl(rawLink, BaseURL = u)
             canonicalKey <- Canonicalize(normalizedLink)
             If ShouldCrawl(normalizedLink, d + 1, A, E, V):
                 V.Add(canonicalKey)
                 Q.Enqueue({ url: normalizedLink, depth: d + 1 })
     k. Execute PostNavigationHooks(PageInstance, u)
     l. Close PageInstance
5. Return ScannedPages P
```

### 2.2 URL Normalization & Filtering Rules

1. **Protocol Resolution**: Protocol-relative URLs (`//cdn.example.com/lib.js`) resolve to active page scheme (`https:`).
2. **Path Normalization**:
   - Strip URL fragments (`#section-1` -> stripped).
   - Normalize trailing slashes based on project settings (default: strip trailing slash for non-root paths).
   - Resolve relative path segments (`./`, `../`).
   - Lowercase hostnames (`EXAMPLE.COM` -> `example.com`).
3. **Query Parameter Handling**:
   - Retain functional query params (`?id=123&page=2`).
   - Strip marketing/tracking parameters (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_eid`, `_ga`).
   - Alphabetically sort query parameters to prevent duplicate crawls (`?b=2&a=1` -> `?a=1&b=2`).
4. **Canonical Link Tag Verification**:
   - Inspect `<link rel="canonical" href="...">`.
   - If canonical points to different valid internal URL, map current page as alias to canonical target.
5. **Internal vs External URL Classification**:
   - **Internal**: Exact domain match, subdomains if `includeSubdomains: true`, base path scope match.
   - **External**: Cross-domain URLs. External URLs are cataloged as external references but not enqueued for recursive scanning.
6. **Sitemap Inspection**:
   - Inspect `/sitemap.xml`, `/sitemap_index.xml`, and `robots.txt` `Sitemap:` directives during seed initialization.
   - Enqueue discovered URLs into frontier queue subject to max page and depth constraints.

---

## 3. Data Models

```typescript
export type CrawlStatus = 'pending' | 'scanning' | 'completed' | 'failed' | 'skipped' | 'timeout';

export interface ScannedPageModel {
  id: string;
  projectId: string;
  url: string;
  finalUrl: string;
  httpStatus: number;
  title: string;
  depth: number;
  status: CrawlStatus;
  canonicalUrl?: string;
  metaTags: Record<string, string>;
  domTreeSnapshotId: string;
  screenshotIds: {
    desktop: string;
    tablet: string;
    mobile: string;
    fullPageDesktop?: string;
  };
  metrics: {
    loadTimeMs: number;
    domContentLoadedTimeMs: number;
    domNodeCount: number;
    resourceTransferBytes: number;
  };
  discoveredLinks: {
    internal: string[];
    external: string[];
  };
  authStatus: 'public' | 'authenticated' | 'auth_required' | 'blocked';
  createdAt: string;
  updatedAt: string;
}

export interface DOMNodeSnapshot {
  nodeId: number;
  backendNodeId: number;
  nodeType: number; // 1 = Element, 3 = Text, 8 = Comment
  nodeName: string;
  nodeValue?: string;
  attributes: Record<string, string>;
  childNodeIds: number[];
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  };
  computedStyleRefId?: string;
}

export interface ScriptResourceModel {
  id: string;
  pageId: string;
  src?: string;
  isInline: boolean;
  contentHash: string;
  async: boolean;
  defer: boolean;
  moduleType: 'classic' | 'module' | 'importmap';
  rawSizeBytes: number;
  content?: string;
}

export interface StyleResourceModel {
  id: string;
  pageId: string;
  href?: string;
  isInline: boolean;
  mediaQuery?: string;
  contentHash: string;
  rawSizeBytes: number;
  cssRulesCount: number;
  importedUrls: string[];
  content?: string;
}

export interface NetworkRequestModel {
  id: string;
  pageId: string;
  requestId: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  resourceType: 'document' | 'stylesheet' | 'script' | 'image' | 'font' | 'xhr' | 'fetch' | 'media' | 'websocket' | 'other';
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus: number;
  responseStatusText: string;
  responseHeaders: Record<string, string>;
  responseBodyHash?: string;
  responseSizeBytes: number;
  mimeType: string;
  protocol: string;
  timing: {
    startTime: number;
    durationMs: number;
  };
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
}

export interface AssetModel {
  id: string;
  projectId: string;
  originUrl: string;
  localRelativePath: string;
  mimeType: string;
  category: 'image' | 'font' | 'stylesheet' | 'script' | 'media' | 'svg' | 'icon';
  contentHash: string; // SHA-256
  sizeBytes: number;
  isInlineDataUri: boolean;
}

export interface ConsoleLogModel {
  id: string;
  pageId: string;
  type: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  timestamp: string;
}
```

---

## 4. Pipeline Execution & Lifecycle Controls

### 4.1 Lifecycle States & State Transitions

```
                 +-------------+
                 |   IDLE      |
                 +------+------+
                        | Start(config)
                        v
                 +-------------+
        +------->|   RUNNING   |<-------+
        |        +------+------+        |
        | Pause()       |               | Resume()
        |               v               |
 +------+------+  Stop()  +-------------+------+
 |   PAUSED    |--------->|     STOPPING       |
 +-------------+          +-------------+------+
                                |
                                v
                          +-------------+
                          |  COMPLETED  |
                          +-------------+
```

### 4.2 Concurrency & Throttling Parameters

```typescript
export interface ScannerExecutionConfig {
  maxConcurrency: number;           // Default: 2 parallel browser contexts (max: 6)
  requestsPerSecond: number;        // Rate limit across contexts (e.g., 5 req/sec)
  navigationTimeoutMs: number;      // Default: 30,000ms
  idleTimeoutMs: number;            // NetworkIdle wait timeout (default: 5,000ms)
  maxDepth: number;                 // Maximum distance from seed URL (default: 3)
  maxPages: number;                 // Maximum pages crawled per project (default: 50)
  respectRobotsTxt: boolean;        // Default: true
  viewportProfiles: ('desktop' | 'tablet' | 'mobile')[];
  userAgentMode: 'modern-desktop' | 'mobile-safari' | 'custom';
  customUserAgent?: string;
  authStorageStatePath?: string;
  extractScreenshots: boolean;
  extractNetworkHar: boolean;
  allowExternalAssets: boolean;
}
```

### 4.3 Lifecycle Hooks

- `onCrawlStart(config: ScannerExecutionConfig): Promise<void>`
- `onPageDiscovered(url: string, depth: number): Promise<boolean>` (return `false` to skip)
- `beforeNavigate(page: Playwright.Page, url: string): Promise<void>`
- `onDOMContentLoaded(page: Playwright.Page, url: string): Promise<void>`
- `onPageScanned(pageResult: ScannedPageModel): Promise<void>`
- `onPageFailed(url: string, error: Error): Promise<void>`
- `onCrawlPaused(): Promise<void>`
- `onCrawlResumed(): Promise<void>`
- `onCrawlComplete(stats: CrawlStatsSummary): Promise<void>`

---

## 5. Playwright Page Evaluation & Extraction Patterns

### 5.1 DOM & Computed Layout Extraction Script

Injected via `page.evaluate()` after `networkidle` or `load` event:

```javascript
/**
 * Evaluates semantic tree and bounding boxes within page execution context.
 */
function extractDOMSnapshot() {
  let nodeIdCounter = 1;
  const nodes = [];

  function walk(node) {
    if (!node) return null;
    const currentId = nodeIdCounter++;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ? node.textContent.trim() : '';
      if (!text) return null;
      const textNode = {
        nodeId: currentId,
        backendNodeId: currentId,
        nodeType: 3,
        nodeName: '#text',
        nodeValue: text,
        attributes: {},
        childNodeIds: []
      };
      nodes.push(textNode);
      return currentId;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const isVisible = style.display !== 'none' && 
                      style.visibility !== 'hidden' && 
                      style.opacity !== '0' && 
                      rect.width > 0 && 
                      rect.height > 0;

    const attributes = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attributes[attr.name] = attr.value;
    }

    const childIds = [];
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      const childId = walk(children[i]);
      if (childId !== null) childIds.push(childId);
    }

    const elementNode = {
      nodeId: currentId,
      backendNodeId: currentId,
      nodeType: 1,
      nodeName: el.tagName.toLowerCase(),
      attributes: attributes,
      childNodeIds: childIds,
      layout: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: isVisible
      }
    };

    nodes.push(elementNode);
    return currentId;
  }

  const rootId = walk(document.documentElement);
  return { rootId, nodes };
}
```

### 5.2 CSS Custom Properties & Style Rule Extractor

```javascript
/**
 * Extracts all active CSS custom variables and media rules.
 */
function extractStyleEnvironment() {
  const customProperties = {};
  const mediaQueries = new Set();
  const fontFaces = [];

  // Root CSS custom properties
  const rootComputed = window.getComputedStyle(document.documentElement);
  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      const sheet = document.styleSheets[i];
      const rules = sheet.cssRules || sheet.rules;
      if (!rules) continue;

      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j];
        if (rule instanceof CSSMediaRule) {
          mediaQueries.add(rule.conditionText || rule.media.mediaText);
        } else if (rule instanceof CSSFontFaceRule) {
          fontFaces.push(rule.cssText);
        } else if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'html')) {
          const style = rule.style;
          for (let k = 0; k < style.length; k++) {
            const prop = style[k];
            if (prop.startsWith('--')) {
              customProperties[prop] = rootComputed.getPropertyValue(prop).trim();
            }
          }
        }
      }
    } catch (e) {
      // Cross-origin stylesheet access blocked
    }
  }

  return {
    customProperties,
    mediaQueries: Array.from(mediaQueries),
    fontFaces
  };
}
```

### 5.3 Global Runtime JS Environment Extractor

```javascript
/**
 * Extracts window properties, global variables, and framework instances.
 */
function extractRuntimeGlobals() {
  const standardWindowKeys = new Set([
    'window', 'self', 'document', 'name', 'location', 'customElements', 'history',
    'locationbar', 'menubar', 'personalbar', 'scrollbars', 'statusbar', 'toolbar',
    'status', 'closed', 'frames', 'length', 'top', 'opener', 'parent', 'frameElement',
    'navigator', 'origin', 'external', 'screen', 'innerWidth', 'innerHeight',
    'scrollX', 'pageXOffset', 'scrollY', 'pageYOffset', 'visualViewport', 'screenX',
    'screenY', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'clientInformation',
    'screenLeft', 'screenTop', 'defaultStatus', 'defaultstatus', 'styleMedia', 'onanimationstart'
  ]);

  const customGlobals = {};
  const currentKeys = Object.getOwnPropertyNames(window);

  for (const key of currentKeys) {
    if (!standardWindowKeys.has(key) && !key.startsWith('on') && !key.startsWith('webkit')) {
      try {
        const val = window[key];
        const valType = typeof val;
        if (valType === 'string' || valType === 'number' || valType === 'boolean') {
          customGlobals[key] = val;
        } else if (val !== null && valType === 'object') {
          customGlobals[key] = `[Object: ${Object.keys(val).slice(0, 8).join(', ')}]`;
        } else if (valType === 'function') {
          customGlobals[key] = `[Function: ${val.name || 'anonymous'}]`;
        }
      } catch (e) {
        customGlobals[key] = '[Inaccessible]';
      }
    }
  }

  return customGlobals;
}
```

---

## 6. Error Recovery & Anti-Bot Evasion

1. **User Agent Emulation**: Rotate between valid Chromium/Firefox/WebKit desktop and mobile user agents; synchronize `navigator.userAgent`, `navigator.appVersion`, `navigator.platform`, and Client Hints HTTP headers (`Sec-CH-UA`).
2. **WebDriver Property Masking**: Execute init script on every new document:
   ```javascript
   Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
   ```
3. **Navigation Timeout Fallback**:
   - Primary: `waitUntil: 'networkidle'` (Timeout: 10s).
   - Secondary Fallback: Catch timeout, switch to `waitUntil: 'load'` (Timeout: 15s).
   - Tertiary Fallback: Catch timeout, proceed with `waitUntil: 'domcontentloaded'` and extract available DOM.
4. **Infinite Scroll Handling**:
   - Scroll incrementally down page height (`window.scrollBy(0, window.innerHeight)`).
   - Cap auto-scroll limit at max 5 viewports or max 5 seconds elapsed.

---

## 7. Phase 4 Implementation Notes (as built)

Phase 4 delivers a **page crawler and metadata/structure extractor**, not the full analyzer pipeline sketched in sections 1 and 5. This section records what is actually implemented so the rest of the document is read as the long-term target, not the current behavior.

### 7.1 Crawl scope & traversal (as built)
- **Strategy**: sequential breadth-first (`maxConcurrency` is `1`). The worker holds a single abort controller per browser session, so concurrent extractions on one session are unsafe. See `src/services/scanner/frontier.ts`.
- **Scope**: internal means same **origin** (scheme + host + port) as the seed, optionally including subdomains and constrained to a base path (`src/services/scanner/crawlScope.ts`). Scheme/port differences are treated as cross-origin/external. External links are catalogued but never enqueued.
- **Normalization**: fragments stripped; tracking params (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_eid`, `_ga`) removed; remaining query params sorted; trailing slashes stripped for non-root paths (`src/services/scanner/normalization.ts`).
- **Limits**: every limit is clamped into documented hard bounds by `src/services/scanner/crawlLimits.ts` (maxPages ≤ 200, maxDepth ≤ 6, navigation timeout ≤ 30 s, redirects ≤ 5, retries ≤ 3).
- **Not implemented from section 2.2**: sitemap/`robots.txt` discovery, `robots.txt` honoring, and the pause/resume lifecycle from section 4.1.

### 7.2 Extraction schema (as built)
Extraction produces a bounded `NormalizedPage` (`src/services/scanner/extraction/types.ts`): `requestedUrl`, `finalUrl`, `httpStatus`, `title`, `metaDescription`, `canonicalUrl`, `robotsMeta`, `headings[]`, `internalLinks[]`, `externalLinks[]`, `images[]` (src + alt + internal flag), `metrics` (load / DOMContentLoaded / DOM node count), per-page `status` (`completed | failed | timeout | skipped`), `errorCode`, `errorMessage`, `warnings[]`, and `capturedAt`. Hard size caps live in `src/services/scanner/extraction/limits.ts`.

**Deliberately NOT extracted in Phase 4** (later phases): serialized DOM snapshots, computed styles/CSS rules, runtime JS globals, HAR/network records, screenshots, and downloaded assets. The `ScannedPageModel`/`DOMNodeSnapshot`/`ScriptResourceModel`/`StyleResourceModel`/`NetworkRequestModel`/`AssetModel` shapes in section 3 remain the target for those phases.

### 7.3 Network-access policy (as built)
Every navigation boundary the architecture can observe is validated by `src/services/scanner/security/` (schemes, credentials, ports, URL length, IP-range classification incl. non-canonical IPv4 / IPv6 mappings, DNS resolution with any-prohibited-address rejection, and a trusted-seed-origin rule). The worker re-validates the final URL after redirects and pins sub-resource routing against prohibited IPs. The residual limitations are documented in `docs/security/SECURITY.md` section 6.5.

### 7.4 Lifecycle, cancellation & persistence (as built)
- A pure state machine (`src/services/scanner/lifecycle.ts`) over `scans.status` (`pending → in_progress → completed | failed | cancelled`); one crawl at a time (`SCAN_ALREADY_RUNNING`).
- `src/services/scanner/crawlerService.ts` orchestrates frontier + worker client + persistence + events; page results are buffered and written in bounded batches; a scan is marked `completed` only after the final batch is written.
- Cancellation aborts the in-flight extraction, keeps partial progress, and records `cancelled`.
- Page results persist to the `scan_pages` table (migration `002`); see `docs/architecture/DATABASE.md` section 2.2.
- The UI drives this through `src/services/scanner/scanService.ts` (workstream 3); see `docs/design/UI-SPEC.md` section 6.

### 7.5 Deviations from this specification
- Sections 1, 5, and 6 describe the eventual DOM/CSS/JS/network/asset/screenshot pipeline and anti-bot evasion; Phase 4 implements only the crawl + metadata extraction subset above.
- Multi-viewport capture (section 4.2 `viewportProfiles`) is **now honored** (Phase 7): the worker `captureViewport` command renders a page under desktop/tablet/mobile profiles and returns a full-page screenshot + visible-element map + detected media-query breakpoints; see `docs/design/RESPONSIVE-SPEC.md` section 5. The Scan UI enables the viewport controls and shows a capture gallery.
- HAR is a later phase. Screenshots are captured per viewport (Phase 7) but not yet diffed into Tailwind rules.

### 7.7 Authentication & session scanning (as built)

Authenticated crawling reuses the same BFS frontier, limits, timeouts, URL policy, and redirect revalidation as an unauthenticated crawl. The only additions:

- **Injection**: `CrawlerService` receives the session via `scanService`, which loads/decrypts it and passes it to `BrowserRuntime.launchSession({ authState })`; the worker applies it to an isolated context. The crawler itself never sees the cookies.
- **Classification**: every page is assigned `authStatus` (`public` / `authenticated` / `auth_required` / `blocked` / `unknown`) by `src/services/scanner/authClassifier.ts` and persisted on `scan_pages.auth_status`. A wall is always `auth_required`, even with a session injected (a wall proves the session did not hold). `authenticated` reports that the page was reached **with a session in effect**, not independently verified protection; distinguishing a public page from a protected page would require a forbidden unauthenticated comparison request.
- **Capture (as built)**: `BrowserRuntime.launchCaptureSession()` / `captureSessionState()` / `cancelCapture()` implement `AUTH-SCANNING.md` section 2.1's headed interactive capture through the same worker; the worker's `captureState` command returns a host-scoped snapshot for encryption. See `docs/architecture/WORKER-PROTOCOL.md` section 3.2.
- **Gating**: a page classified `auth_required`/`blocked` is not treated as a completed page - its links are not enqueued - and when the caller set `requireAuthentication`, the scan is recorded `failed` (with `pagesAuthRequired`/`pagesBlocked` reported), never `completed`.
- **Unchanged**: an unauthenticated scan behaves exactly as before (`authStatus` is `public` or `auth_required`; terminal status is unaffected).
- **Deferred**: `authStorageStatePath` (a file path) is intentionally not used - the session is stored encrypted in SQLite, not as a file.

### 7.6 Phase 5 extension - technology-detection evidence
Technology detection (`docs/specs/TECHNOLOGY-DETECTION.md`) runs over evidence the crawler already collects. Because Phase 4 persisted page metadata/structure only, the extraction contract was extended with a bounded `PageTechEvidence` record carried on each normalized page:
- **Response headers** (lower-cased names + values, capped) - captured worker-side from the Playwright response.
- **Cookie names only** - derived from `set-cookie`; values are never retained.
- **Script `src` URLs**, **technology-relevant `<meta>` tags**, **distinctive DOM markers**, and **boolean JS-global presence probes** - captured in the in-page extractor; no page script is executed.
- **Structural HTML snippet** - a length-capped `<head>` + truncated `<body>` string used for `htmlRegex`/`cssClasses` signatures only.

All fields are bounded by `EXTRACTION_LIMITS`. Detection is deterministic, runs on the host (never in the worker), and introduces no new network access.
