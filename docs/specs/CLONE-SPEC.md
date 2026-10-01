# Static Clone Engine Specification - Artupski ReSite

Technical specification for producing standalone, offline-runnable static clones of reverse-engineered websites.

---

## 1. Architectural Distinction Matrix

Artupski ReSite distinguishes clearly between three tier output artifacts:

| Feature Dimension | Tier 1: Static Clone (`CLONE-SPEC`) | Tier 2: Website Blueprint (`BLUEPRINT-SPEC`) | Tier 3: Full Project (`PROJECT-GENERATOR-SPEC`) |
| :--- | :--- | :--- | :--- |
| **Primary Artifact** | Raw static folder (`index.html`, `css/`, `js/`, `assets/`) | Single schema-validated `blueprint.json` document | Full multi-file repository (`package.json`, React/Laravel source) |
| **Execution Context** | Standalone browser / local HTTP static server | Intermediate data payload for AI & Generators | `npm run dev` / `composer run dev` server |
| **Backend Dependency** | Zero. Client-side JS stubs intercept local interactions | Framework agnostic metadata | Database ORM, API routes, Server Components |
| **Fidelity Target** | Visual & DOM 1:1 pixel match of captured state | Normalized component hierarchy & design tokens | Maintainable production code built with clean framework standards |

---

## 2. Static Clone Directory Structure

A generated static clone emits a self-contained web root ready for direct offline opening or static web hosting:

```
clone-output/
├── index.html                  # Root landing page (URL: /)
├── pages/                      # Secondary crawled routes
│   ├── pricing.html
│   ├── about.html
│   └── auth-login.html
├── css/
│   ├── styles.css              # Consolidated stylesheet bundle
│   └── fonts.css               # Local webfont font-face rules
├── js/
│   ├── vendor.js               # Cleaned static UI scripts
│   └── mock-client.js          # Navigation & form interaction stubs
├── assets/
│   ├── images/                 # Downloaded PNG, JPG, WebP, SVG files
│   ├── fonts/                  # WOFF2 / WOFF local font files
│   └── media/                  # Video / audio clips
└── manifest.json               # Local clone metadata & original route map
```

---

## 3. HTML Rewriting & Asset Remapping Engine

The Clone Engine parses raw HTML AST generated during Playwright network capture, applying strict transformation pipeline rules.

### 3.1 Pipeline Rule Specifications

1. **Absolute & Protocol-Relative URL Remapping**:
   - Rewrite `https://example.com/assets/logo.png` -> `assets/images/logo_a1b2c3.png`.
   - Rewrite `/css/app.css` -> `css/styles.css`.
2. **Anchor Link Navigation Translation**:
   - Internal links (`<a href="/pricing">`) remapped to local relative pages (`<a href="pages/pricing.html">`).
   - Hash fragments (`<a href="/#features">`) preserved and mapped to `index.html#features`.
   - Out-of-scope external domain links transformed to explicit `target="_blank" rel="noopener noreferrer"`.
3. **Script & Embed Sandboxing**:
   - Strip external tracking scripts (Google Tag Manager, Segment, Facebook Pixel, Hotjar).
   - Strip CORS-blocking third-party API fetch calls that fail offline.
   - Inject local lightweight runtime stub script (`js/mock-client.js`).
4. **Base Tag Stripping**:
   - Remove any `<base href="...">` tags to prevent relative path breakage inside offline file system contexts.

### 3.2 Rewriter Pipeline Implementation

```typescript
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { selectAll, selectOne } from 'css-select';
import * as ElementType from 'domelementtype';

export interface AssetMap {
  [originalUrl: string]: string; // Maps absolute URL -> local relative path
}

export interface RouteMap {
  [originalPath: string]: string; // Maps /about -> pages/about.html
}

export class HtmlRewriterPipeline {
  constructor(
    private assetMap: AssetMap,
    private routeMap: RouteMap,
    private currentPath: string
  ) {}

  rewriteHtml(rawHtml: string): string {
    const dom = parseDocument(rawHtml);

    // 1. Rewrite Images
    const images = selectAll('img[src]', dom);
    for (const img of images) {
      const src = img.attribs['src'];
      if (src && this.assetMap[src]) {
        img.attribs['src'] = this.getRelativePath(this.assetMap[src]);
      }
      // Handle srcset attributes
      if (img.attribs['srcset']) {
        img.attribs['srcset'] = this.rewriteSrcSet(img.attribs['srcset']);
      }
    }

    // 2. Rewrite Stylesheet Links
    const styleLinks = selectAll('link[rel~="stylesheet"]', dom);
    for (const link of styleLinks) {
      const href = link.attribs['href'];
      if (href && this.assetMap[href]) {
        link.attribs['href'] = this.getRelativePath(this.assetMap[href]);
      }
    }

    // 3. Rewrite Internal Navigation Links
    const anchors = selectAll('a[href]', dom);
    for (const a of anchors) {
      const href = a.attribs['href'];
      if (href) {
        if (this.routeMap[href]) {
          a.attribs['href'] = this.getRelativePath(this.routeMap[href]);
        } else if (href.startsWith('http://') || href.startsWith('https://')) {
          a.attribs['target'] = '_blank';
          a.attribs['rel'] = 'noopener noreferrer';
        }
      }
    }

    // 4. Inject Mock Interaction Client Script
    const head = selectOne('head', dom);
    if (head) {
      const scriptNode = {
        type: ElementType.Script,
        name: 'script',
        attribs: { src: this.getRelativePath('js/mock-client.js') },
        children: []
      };
      head.children.push(scriptNode as any);
    }

    return render(dom);
  }

  private rewriteSrcSet(srcset: string): string {
    return srcset
      .split(',')
      .map((entry) => {
        const [url, descriptor] = entry.trim().split(/\s+/);
        const mapped = this.assetMap[url];
        const newUrl = mapped ? this.getRelativePath(mapped) : url;
        return descriptor ? `${newUrl} ${descriptor}` : newUrl;
      })
      .join(', ');
  }

  private getRelativePath(targetLocalPath: string): string {
    // Calculates relative path traversal based on current page directory depth
    const depth = (this.currentPath.match(/\//g) || []).length;
    if (depth === 0) return targetLocalPath;
    const prefix = '../'.repeat(depth);
    return `${prefix}${targetLocalPath}`;
  }
}
```

---

## 4. CSS Extraction & Asset Bundling

1. **Inline CSS Processing**:
   - Parse all `<style>` block rules and computed stylesheet rules.
   - Extract `url('...')` font and image references.
   - Download referenced assets, assign content-hashed file names (`asset_8f9a2b.woff2`), and rewrite CSS declarations to local paths (`url('../assets/fonts/asset_8f9a2b.woff2')`).
2. **Stylesheet Bundling & Deduplication**:
   - Merge multiple external CSS files into single clean `styles.css`.
   - Strip duplicate `@charset` and duplicate `@font-face` declarations.
   - Ensure media queries are grouped cleanly at the end of the file.

---

## 5. Client-Side Mock Script (`mock-client.js`)

To ensure the static clone feels interactive without backend server requirements, a tiny client script (`js/mock-client.js`) is injected into every page:

```javascript
(function () {
  console.log('[Artupski Static Clone] Mock Interaction Client Active.');

  // 1. Intercept Form Submissions
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    console.log('[Artupski Mock] Intercepted Form Submission:', data);

    // Render non-destructive toast feedback
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: #0f172a; color: #38bdf8; padding: 12px 20px;
      border-radius: 8px; border: 1px solid #0284c7; font-family: monospace;
      font-size: 13px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
    `;
    toast.textContent = '✓ Static Clone: Form submit captured locally (see browser console).';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  });

  // 2. Mock Dynamic Tab Switches
  document.querySelectorAll('[data-toggle="tab"], [role="tab"]').forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      const targetId = tab.getAttribute('aria-controls') || tab.getAttribute('href');
      if (targetId && targetId.startsWith('#')) {
        e.preventDefault();
        const pane = document.querySelector(targetId);
        if (pane && pane.parentElement) {
          Array.from(pane.parentElement.children).forEach(c => c.style.display = 'none');
          pane.style.display = 'block';
        }
      }
    });
  });
})();
```

---

## 6. Verification & Export Pipeline

1. **Local Disk Writer**:
   - Writes clone files using atomic file stream writes inside `<PROJECT_DIR>/clones/v1/`.
2. **ZIP Archiver**:
   - Uses Rust native `zip` crate via Tauri command to package the output directory into `<PROJECT_TITLE>_static_clone.zip`.
3. **Native Folder Explorer Trigger**:
   - Launches OS native file manager highlighting `index.html` via Tauri `shell.open`.
