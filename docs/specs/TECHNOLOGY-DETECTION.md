# Technology & Library Detection Specification

## 1. Engine Architecture

Rule-based technology detection engine identifies frameworks, CMS engines, database backends, analytics suites, CDNs, UI component libraries, and build tools from captured scan artifacts.

```
+-----------------------------------------------------------------------------------+
|                            Scan Artifact Provider                                 |
| (HTML Meta, DOM Elements, JS Globals, Script URLs, Headers, CSS Classes, Network) |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                            Rule Matcher & Evaluator                               |
|        Evaluates Fingerprint Signals against Rule Database (JSON Rules)           |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                           Confidence Scoring Engine                               |
|       Aggregates Weighted Signal Scores, Deduplicates & Resolves Conflicts       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                          Version Extraction Regex Parser                          |
|         Extracts Version Strings from Matched Signal Captures / Fallbacks         |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        Structured Detection Report Output                         |
|      (Category, Technology Name, Confidence Score, Version, Evidence List)       |
+-----------------------------------------------------------------------------------+
```

---

## 2. Fingerprinting Categories

1. **Frontend Framework**: React, Vue.js, Angular, Svelte, SolidJS, Alpine.js, Ember, Backbone, Preact, Qwik.
2. **Meta-Framework & SSR Engine**: Next.js, Nuxt.js, Remix, Astro, Gatsby, SvelteKit.
3. **Backend Framework & Server**: Express, NestJS, Django, Ruby on Rails, Laravel, Spring Boot, ASP.NET, Fastify, Go Fiber.
4. **CMS (Content Management System)**: WordPress, Shopify, Webflow, Framer, Wix, Squarespace, Drupal, Strapi, Ghost, Contentful.
5. **Database & ORM**: PostgreSQL, MySQL, MongoDB, Firebase Realtime/Firestore, Supabase, Prisma, GraphQL.
6. **Analytics & Tracking**: Google Analytics (GA4), Segment, Mixpanel, Hotjar, PostHog, Plausible, Amplitude.
7. **CDN & Infrastructure**: Cloudflare, Vercel, Netlify, AWS CloudFront, Fastly, Akamai, BunnyCDN.
8. **Hosting & PaaS**: Vercel, Netlify, AWS, Render, Fly.io, Railway, DigitalOcean, Heroku.
9. **Security & Authentication**: Auth0, Clerk, Firebase Auth, NextAuth / Auth.js, Supabase Auth, reCAPTCHA, Cloudflare Turnstile.
10. **Payment Gateway**: Stripe, PayPal, Square, Razorpay, Paddle, Klarna.
11. **Font Provider**: Google Fonts, Typekit / Adobe Fonts, Font Awesome, Fontshare.
12. **JS Library & UI Utilities**: Lodash, jQuery, Axios, RxJS, Swiper, Lucide, Framer Motion, GSAP, Chart.js, D3.js.
13. **CSS Framework & Component UI**: Tailwind CSS, Bootstrap, MUI (Material-UI), Shadcn UI, Chakra UI, Ant Design, Bulma, Styled-Components, Emotion.
14. **DevOps & Build Tools**: Vite, Webpack, Turbopack, Parcel, Rollup, Babel, esbuild.

---

## 3. Detection Signal Vectors

Engine inspects 9 signal vectors per scanned page:

1. **Meta Tags (`meta`)**: `<meta name="generator" content="...">`, `<meta name="next-head-count">`.
2. **Script URLs (`scriptSrc`)**: `<script src="...">` pattern matching (e.g., `_next/static/`, `wp-content/themes/`).
3. **JS Window Globals (`jsGlobals`)**: Evaluated in page runtime context (e.g., `window.__NEXT_DATA__`, `window.Vue`, `window.React`).
4. **HTTP Headers (`headers`)**: Response headers (e.g., `Server: Vercel`, `X-Powered-By: Express`, `cf-ray`).
5. **Cookies (`cookies`)**: Cookie names and value formats (e.g., `wordpress_logged_in_*`, `PHPSESSID`, `_ga`).
6. **HTML Patterns (`htmlRegex`)**: Raw HTML string regex (e.g., `<div id="__next">`, `data-reactroot`).
7. **CSS Class Patterns (`cssClasses`)**: Utility or scoped selector patterns (e.g., `flex min-h-screen bg-background` -> Tailwind, `css-175oi2r` -> Styled-Components).
8. **DOM Element Markers (`domElements`)**: Specific elements or custom elements (e.g., `<astro-island>`, `<next-route-announcer>`).
9. **Network Request Endpoints (`networkRequests`)**: Intercepted API calls or tracking pings (e.g., `https://www.google-analytics.com/g/collect`).

---

## 4. Confidence Scoring Model

### 4.1 Scoring Formula

Each detection rule specifies array of signal patterns with individual weight values $w_i \in (0.0, 1.0]$. Aggregate confidence score $C \in [0.0, 1.0]$ for technology $T$ is computed:

$$C(T) = 1 - \prod_{i \in MatchedSignals} (1 - w_i)$$

Where:
- $w_i$: Confidence weight of single matched signal rule.
- If $C(T) \ge 1.0$, $C(T) = 1.0$.
- Threshold: Technology classified as **Detected** if $C(T) \ge 0.50$.
- Status:
  - $C(T) \ge 0.75$: **Detected** (High Confidence)
  - $0.50 \le C(T) < 0.75$: **Probable**
  - $0.20 \le C(T) < 0.50$: **Unknown / Low Confidence Candidate** (Suppressed from final report)
  - $C(T) < 0.20$: Not detected.

### 4.2 Signal Weight Allocations

| Signal Vector | Weight ($w_i$) Range | Justification |
|---|---|---|
| `jsGlobals` (runtime check) | 0.80 - 1.00 | High specificity; window globals rarely spoofed |
| `meta` (generator tag) | 0.90 - 1.00 | Direct assertion from engine generator |
| `scriptSrc` | 0.60 - 0.90 | Specific framework asset paths |
| `domElements` | 0.70 - 0.90 | Distinct tag names and custom elements |
| `headers` | 0.50 - 0.80 | Server headers (can be masked by reverse proxy) |
| `htmlRegex` | 0.40 - 0.70 | Structural HTML markers |
| `cssClasses` | 0.50 - 0.80 | Tailwind / UI library atomic class matches |
| `cookies` | 0.60 - 0.80 | Session engine cookie prefixes |
| `networkRequests` | 0.60 - 0.85 | External API and tracking script hosts |

### 4.3 Evidence Data Structure

```typescript
export interface TechnologyDetectionEvidence {
  technologyId: string;
  name: string;
  category: TechnologyCategory;
  confidenceScore: number;
  confidenceStatus: 'detected' | 'probable' | 'unknown';
  extractedVersion: string | null;
  versionStatus: 'exact' | 'major_only' | 'unavailable';
  matchedSignals: Array<{
    vector: 'meta' | 'scriptSrc' | 'jsGlobals' | 'headers' | 'cookies' | 'htmlRegex' | 'cssClasses' | 'domElements' | 'networkRequests';
    pattern: string;
    matchedValue: string;
    weight: number;
  }>;
}
```

---

## 5. Version Extraction Regex & Fallbacks

### 5.1 Version Regex Patterns

Detection rules include `versionRegex` patterns matching capture groups `(?<version>\d+(\.\d+)*)` from matched signal values.

1. **Meta Generator Version**:
   - Signal: `<meta name="generator" content="WordPress 6.4.2">`
   - Regex: `(?:WordPress|WP)\s+(?<version>\d+\.\d+(?:\.\d+)?)`
   - Output: `6.4.2`
2. **Script URL Version**:
   - Signal: `/wp-includes/js/jquery/jquery.min.js?ver=3.7.1`
   - Regex: `[?&]ver=(?<version>\d+\.\d+(?:\.\d+)?)`
   - Output: `3.7.1`
3. **JS Global Version Property**:
   - Signal: `window.React.version` -> `"18.2.0"`
   - Extracted direct from runtime evaluation.

### 5.2 Version Status Matrix

- **Detected + Version**: $C(T) \ge 0.75$ and version string successfully parsed.
- **Detected (Version Unavailable)**: $C(T) \ge 0.75$ but no version pattern matched.
- **Probable**: $0.50 \le C(T) < 0.75$.
- **Unknown**: $C(T) < 0.50$.

---

## 6. Offline Rules Database Format (JSON)

Rules DB stored locally in JSON format at `src/services/detector/rules/technologies.json`.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "version": "1.0.0",
  "technologies": [
    {
      "id": "react",
      "name": "React",
      "category": "Frontend Framework",
      "website": "https://react.dev",
      "description": "JavaScript library for building user interfaces.",
      "signals": [
        {
          "vector": "jsGlobals",
          "pattern": "React.version",
          "weight": 1.0,
          "versionProperty": "React.version"
        },
        {
          "vector": "htmlRegex",
          "pattern": "data-reactroot|data-reactid",
          "weight": 0.85
        },
        {
          "vector": "scriptSrc",
          "pattern": "react(?:-dom)?\\.(?:production|development)\\.js",
          "weight": 0.75,
          "versionRegex": "react@(?<version>\\d+\\.\\d+\\.\\d+)"
        }
      ]
    },
    {
      "id": "nextjs",
      "name": "Next.js",
      "category": "Meta-Framework & SSR Engine",
      "website": "https://nextjs.org",
      "description": "React framework for web applications.",
      "signals": [
        {
          "vector": "jsGlobals",
          "pattern": "__NEXT_DATA__",
          "weight": 1.0,
          "versionProperty": "__NEXT_DATA__.buildId"
        },
        {
          "vector": "scriptSrc",
          "pattern": "/_next/static/",
          "weight": 0.90
        },
        {
          "vector": "meta",
          "pattern": "next-head-count",
          "weight": 0.85
        },
        {
          "vector": "headers",
          "headerName": "x-nextjs-page",
          "pattern": ".*",
          "weight": 0.90
        }
      ]
    },
    {
      "id": "tailwind-css",
      "name": "Tailwind CSS",
      "category": "CSS Framework & Component UI",
      "website": "https://tailwindcss.com",
      "description": "Utility-first CSS framework.",
      "signals": [
        {
          "vector": "cssClasses",
          "pattern": "\\b(flex|grid|hidden|block|inline-block|relative|absolute|sticky|items-center|justify-between|min-h-screen|max-w-\\w+|px-\\d+|py-\\d+|space-[xy]-\\d+)\\b",
          "weight": 0.75
        },
        {
          "vector": "htmlRegex",
          "pattern": "class=\"[^\"]*\\b(sm:|md:|lg:|xl:|2xl:|hover:|focus:|dark:)[^\"]*\"",
          "weight": 0.85
        }
      ]
    }
  ]
}
```

### 6.1 Extensibility Guidelines

- New detection rules can be added by placing individual JSON files in `src/services/detector/rules/custom/`.
- Engine auto-merges core rules and user custom rules during runtime start.
- Conflicting rule IDs override core rules if custom rule `override: true` flag set.
