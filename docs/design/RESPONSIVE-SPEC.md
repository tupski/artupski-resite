# Responsive Layout & Viewport Analysis Specification

## 1. Viewport Profiles & Emulation Parameters

Multi-viewport scanner renders target pages across standardized device profiles to capture responsive layout variations, breakpoint rules, and viewport-dependent component structures.

```
+-----------------------------------------------------------------------------------+
|                           Multi-Viewport Scan Trigger                             |
+-----------------------------------------+-----------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
+---------------+                 +---------------+                 +---------------+
|    Desktop    |                 |    Tablet     |                 |    Mobile     |
| (1920x1080)   |                 |  (768x1024)   |                 |   (375x812)   |
+-------+-------+                 +-------+-------+                 +-------+-------+
        |                                 |                                 |
        +---------------------------------+---------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                     Playwright Viewport Context Emulation                         |
|     (width, height, deviceScaleFactor, isMobile, hasTouch, userAgent override)    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               Differential DOM Bounding Box & CSS Computed Comparer               |
|  (Calculates Layout Shifts, Visibility Changes, Navigation State Transformations)  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                      Structured Responsive Rule Synthesizer                       |
|           (Outputs Responsive Rules Schema for Website Blueprint)                |
+-----------------------------------------------------------------------------------+
```

### 1.1 Viewport Profile Matrix

| Profile Name | Target Resolution | Aspect Ratio | Device Scale | `isMobile` | `hasTouch` | Target Devices |
|---|---|---|---|---|---|---|
| `desktop_large` | 1920 x 1080 | 16:9 | 1.0 | `false` | `false` | 1080p Desktop / Monitor |
| `desktop_standard` | 1440 x 900 | 16:10 | 1.0 | `false` | `false` | Standard Laptops / MacBooks |
| `tablet_portrait` | 768 x 1024 | 3:4 | 2.0 | `true` | `true` | iPad / Android Tablets (Portrait) |
| `tablet_landscape` | 1024 x 768 | 4:3 | 2.0 | `true` | `true` | iPad / Android Tablets (Landscape) |
| `mobile_standard` | 375 x 812 | ~9:19.5 | 3.0 | `true` | `true` | iPhone 13/14/15 Mini / Standard Mobile |
| `mobile_large` | 390 x 844 | ~9:19.5 | 3.0 | `true` | `true` | iPhone 14/15/16 Pro / Modern Android |

---

## 2. Responsive Rule Inference Algorithms

### 2.1 Multi-Viewport Comparison Pipeline

```
Algorithm: Responsive Difference Inference
Input: Page URL u, ViewportSet V = { Desktop, Tablet, Mobile }

1. For each viewport v in V:
     a. Context_v <- Browser.NewContext(EmulationConfig(v))
     b. Page_v <- Context_v.NewPage()
     c. Page_v.Navigate(u, WaitUntil = 'networkidle')
     d. DOMTree_v <- ExtractDOMSnapshot(Page_v)
     e. Screenshots[v] <- CaptureFullPageScreenshot(Page_v)
     f. Context_v.Close()

2. AnchorNodeSet <- FindCommonDOMNodes(DOMTree_Desktop, DOMTree_Mobile)

3. For each node n in AnchorNodeSet:
     a. Layout_Desktop <- GetLayout(n, DOMTree_Desktop)
     b. Layout_Tablet  <- GetLayout(n, DOMTree_Tablet)
     c. Layout_Mobile  <- GetLayout(n, DOMTree_Mobile)

     d. If Layout_Desktop.visible != Layout_Mobile.visible:
          RegisterVisibilityTransformationRule(n, Layout_Desktop.visible, Layout_Mobile.visible)

     e. If DetectColumnToStack(Layout_Desktop, Layout_Mobile):
          RegisterLayoutTransformationRule(n, type = 'grid_to_stacked')

     f. If IsNavigationContainer(n) and DetectNavToHamburger(n, DOMTree_Desktop, DOMTree_Mobile):
          RegisterNavTransformationRule(n, type = 'navbar_to_drawer')

     g. DetectTypographyScaling(n, ComputedStyle_Desktop, ComputedStyle_Mobile)
     h. DetectSpacingAdaptations(n, ComputedStyle_Desktop, ComputedStyle_Mobile)

4. Return SynthesizedResponsiveRules()
```

### 2.2 Inference Heuristics

1. **Layout Transformation Detection (Multi-Column to Stacked)**:
   - **Condition**: Parent container has siblings positioned horizontally in desktop ($\text{y}_1 \approx \text{y}_2$, $\text{x}_2 > \text{x}_1 + \text{width}_1$), but vertically stacked in mobile ($\text{x}_1 \approx \text{x}_2$, $\text{y}_2 > \text{y}_1 + \text{height}_1$).
   - **Inferred Blueprint Rule**: Grid or Flex row transforms to flex column below breakpoint (`md:flex-row flex-col`).
2. **Navigation Bar Transformation**:
   - **Condition**: Header container in Desktop contains visible link list (`<nav>`, `<ul>`, `<a>`), but in Mobile link list is hidden (`display: none` / `visibility: hidden`) and button with hamburger icon / aria-label becomes visible.
   - **Inferred Blueprint Rule**: Desktop horizontal navbar transforms to mobile hamburger drawer/sheet (`hidden md:flex`).
3. **Visibility Changes**:
   - **Condition**: Node exists in DOM tree, but `visible: false` in mobile while `visible: true` in desktop.
   - **Inferred Blueprint Rule**: Breakpoint visibility utility (`hidden md:block` or `hidden lg:inline-flex`).
4. **Typography & Spacing Scaling**:
   - Compares computed `font-size`, `line-height`, `padding`, `margin`, `gap` between viewports.
   - Maps ratios to Tailwind responsive scale increments (e.g., `text-2xl md:text-4xl`, `p-4 md:p-8`).

---

## 3. Media Query Extraction & CSS Comparison

1. **Stylesheet Media Query Aggregation**:
   - Extracts all `@media` conditions from CSS rules across all loaded stylesheets.
   - Parses min-width / max-width conditions:
     - `@media (min-width: 640px)` -> `sm` (640px)
     - `@media (min-width: 768px)` -> `md` (768px)
     - `@media (min-width: 1024px)` -> `lg` (1024px)
     - `@media (min-width: 1280px)` -> `xl` (1280px)
     - `@media (min-width: 1536px)` -> `2xl` (1536px)
2. **Computed Style Differential Analysis**:
   - Compares computed style properties for every visible element across `desktop`, `tablet`, `mobile`.
   - Isolates responsive delta properties: `display`, `flex-direction`, `grid-template-columns`, `width`, `max-width`, `font-size`, `padding-left`, `padding-right`, `margin-top`.

---

## 4. Responsive Rule Blueprint Schema

```typescript
export type BreakpointKey = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ResponsiveBreakpointConfig {
  name: BreakpointKey;
  minWidthPx: number;
  extractedFromCSS: boolean;
}

export interface ComponentResponsiveRule {
  componentId: string;
  selector: string;
  tagName: string;
  layoutTransformation?: {
    desktopPattern: 'flex-row' | 'grid-3-col' | 'grid-4-col' | 'sidebar-layout';
    mobilePattern: 'flex-col' | 'grid-1-col' | 'stacked';
    breakpoint: BreakpointKey;
  };
  navigationTransformation?: {
    type: 'desktop_nav_to_mobile_drawer' | 'desktop_nav_to_bottom_tabs' | 'none';
    triggerSelector?: string;
    targetDrawerSelector?: string;
    breakpoint: BreakpointKey;
  };
  visibilityRules: Array<{
    breakpoint: BreakpointKey;
    visibleOnDesktop: boolean;
    visibleOnTablet: boolean;
    visibleOnMobile: boolean;
    inferredUtility: string; // e.g. "hidden md:flex"
  }>;
  typographyAdaptations: Array<{
    property: 'fontSize' | 'lineHeight' | 'fontWeight';
    mobileValue: string;
    tabletValue?: string;
    desktopValue: string;
    inferredTailwindClasses: string; // e.g. "text-lg md:text-2xl lg:text-4xl"
  }>;
  spacingAdaptations: Array<{
    property: 'padding' | 'margin' | 'gap';
    mobileValue: string;
    desktopValue: string;
    inferredTailwindClasses: string; // e.g. "p-4 md:p-8 gap-2 md:gap-6"
  }>;
}

export interface ResponsiveAnalysisReport {
  pageId: string;
  scannedViewports: Array<{
    profile: string;
    width: number;
    height: number;
    screenshotId: string;
  }>;
  detectedBreakpoints: ResponsiveBreakpointConfig[];
  componentRules: ComponentResponsiveRule[];
}
```

---

## 5. Implementation Notes (as built)

This phase is delivered as **multi-viewport capture** on top of the Phase 4 crawler. No new process manager, browser runtime, or crawler was created; the worker protocol was extended additively and `WORKER_PROTOCOL_VERSION` stays `1`.

1. **Profiles**: the canonical matrix is `RESPONSIVE_VIEWPORT_PROFILES` in `src/services/infra/workerProtocol.ts` — `desktop` (1440×900, scale 1), `tablet` (768×1024, scale 2, touch), `mobile` (375×812, scale 3, touch). Dimensions are capped at 4320 and validated on the wire (`isViewportProfile`).
2. **Capture**: the worker `captureViewport` command opens a **fresh isolated context per profile** (so emulation never leaks into the scan session), navigates, reads a bounded visible-element map + the page's applied media-query breakpoints via a read-only in-page probe, and returns a full-page PNG. The screenshot is capped at 12 MiB of base64 and dropped (`truncated: true`) beyond that; an unresolved session (if one was injected) is replayed in-memory only.
3. **Persistence**: migration `006_responsive_captures` (version 6) adds `responsive_captures` (one row per page + profile). Screenshots are written to disk via a narrow sandboxed Rust `asset_write`/`asset_delete` module confined to `<app_local_data_dir>/assets` (absolute paths and `..` are rejected), so the database holds only `screenshot_path` + metadata. `ResponsiveCaptureRepository` owns all its SQL.
4. **Service/UI**: `src/services/scanner/responsiveScanner.ts` runs after a completed crawl, gated by `scanService.runScan({ viewportProfiles })`. The Scan screen's viewport toggles are enabled, and the `ViewportPreview` gallery renders the persisted captures with honest states.
5. **Documented limitation**: the **Tailwind responsive-rule synthesizer** of section 4 (inferred `hidden md:flex` utility classes; `desktopPattern`/`mobilePattern` classification) is **deferred to a later phase**. This phase delivers the acceptance criterion's "distinct screenshots and visible element maps for each breakpoint" plus the detected CSS media-query breakpoints; it does not infer Tailwind classes.
