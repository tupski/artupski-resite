/**
 * Static clone domain types - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md sections 2-4.
 *
 * These are the pure, in-memory shapes the clone engine uses while rewriting a
 * captured page into a local, self-contained tree. They are NOT persisted; the
 * persisted clone metadata is `scan_assets` (see `CloneAsset`) and the raw HTML
 * path on `ScanPage`.
 */

/** Maps an original absolute (or page-relative) asset URL to its local path. */
export interface AssetMap {
  [originalUrl: string]: string;
}

/** Maps an original crawled route path to its local page file (e.g. `pages/about.html`). */
export interface RouteMap {
  [originalPath: string]: string;
}

/** Clone output subdirectories (CLONE-SPEC section 2). */
export interface CloneLayout {
  index: string;
  pagesDir: string;
  cssDir: string;
  jsDir: string;
  assetsDir: string;
  imagesDir: string;
  fontsDir: string;
  mediaDir: string;
  manifest: string;
}

/** The canonical CLONE-SPEC section 2 layout inside `<clones>/v1/`. */
export const CLONE_LAYOUT: CloneLayout = {
  index: 'index.html',
  pagesDir: 'pages',
  cssDir: 'css',
  jsDir: 'js',
  assetsDir: 'assets',
  imagesDir: 'assets/images',
  fontsDir: 'assets/fonts',
  mediaDir: 'assets/media',
  manifest: 'manifest.json'
};

/** One entry in the emitted `manifest.json` route map. */
export interface CloneManifestRoute {
  /** Original absolute URL. */
  url: string;
  /** Local file path inside the clone tree. */
  file: string;
  /** HTTP status observed when the page was captured (null when unknown). */
  status: number | null;
}

/** One entry in the emitted `manifest.json` asset list. */
export interface CloneManifestAsset {
  sourceUrl: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  assetType: string;
}

/** The emitted `manifest.json` document (CLONE-SPEC section 2). */
export interface CloneManifest {
  generatedAt: string;
  sourceOrigin: string;
  pageCount: number;
  assetCount: number;
  skippedPageCount: number;
  routes: CloneManifestRoute[];
  assets: CloneManifestAsset[];
}

/** Honest outcome of a clone run; never fabricated. */
export interface CloneReport {
  scanId: string;
  /** Pages rewritten into the clone tree. */
  generatedPages: number;
  /** Captured pages that had no raw HTML and were skipped. */
  skippedPages: number;
  /** Assets written (unique payloads). */
  assetsWritten: number;
  /** Referenced assets that failed to capture or exceeded a cap. */
  assetsSkipped: number;
  /** Non-fatal problems surfaced to the user. */
  warnings: string[];
}
