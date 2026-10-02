/**
 * Visual diff type contracts - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 13) and
 * docs/impl-plan/phase-13-impl-plan.md sections 7, 9-11.
 *
 * These are the ONLY public Phase 13 shapes a caller sees. They are deliberately
 * small and honest: a pure comparison result that always carries what was
 * compared, how many pixels mismatched, a similarity percentage, an optional
 * colour-coded diff image, and a bounded list of discrepancies that the evidence
 * actually supports. Nothing is fabricated: an unreadable image is reported, not
 * guessed.
 */

/* -------------------------------------------------------------------------- */
/* Limits (bounded to keep comparison memory/CPU safe)                        */
/* -------------------------------------------------------------------------- */

/** Hard cap on decoded pixels per image (16M px ≈ 4096×4096). */
export const MAX_DIFF_PIXELS = 16 * 1024 * 1024;
/** Hard cap on a single PNG byte length accepted for decode (32 MiB). */
export const MAX_DIFF_IMAGE_BYTES = 32 * 1024 * 1024;
/** Upper bound on reported discrepancies (bounded log-style evidence). */
export const MAX_DIFF_DISCREPANCIES = 200;
/** Viewports compared in a single run (matches the responsive profile set). */
export const MAX_DIFF_VIEWPORTS = 8;

/**
 * Normalized per-channel colour distance (0-255 scale) above which two pixels
 * are considered a mismatch. Nonzero so imperceptible antialiasing noise is not
 * reported as a layout discrepancy, mirroring the pixelmatch `threshold` idea
 * without a dependency.
 */
export const DEFAULT_DIFF_THRESHOLD = 32;

/* -------------------------------------------------------------------------- */
/* Pure core inputs/outputs                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A decoded RGBA8 image, top-left origin, row-major. `data.length` MUST equal
 * `width * height * 4`. This is the pure core's only image input so the engine
 * never needs an image library.
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface VisualDiffOptions {
  /** Per-channel mismatch threshold (0-255); defaults to `DEFAULT_DIFF_THRESHOLD`. */
  threshold?: number;
  /**
   * When true, images with different dimensions are compared on a padded common
   * canvas (transparent fill) and the size difference is reported as a
   * discrepancy. When false (default) a size mismatch is an error.
   */
  allowSizeMismatch?: boolean;
}

export type DiffDiscrepancyKind =
  'dimension_mismatch' | 'pixel_mismatch' | 'missing_font' | 'layout_shift' | 'missing_image';

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One honest discrepancy. `kind` is only ever set from what the evidence
 * supports; a generic `pixel_mismatch` is used when no stronger signal applies.
 * `message` is a short, human-readable, non-secret explanation.
 */
export interface DiffDiscrepancy {
  kind: DiffDiscrepancyKind;
  message: string;
  /** Bounding box of the affected area in the diff canvas, when known. */
  region?: DiffRegion;
  severity: 'info' | 'warning';
}

/** The pure, synchronous comparison result. Never thrown. */
export interface VisualDiffResult {
  ok: boolean;
  width: number;
  height: number;
  totalPixels: number;
  mismatchedPixels: number;
  /** 0-100, rounded to two decimals; `100` means a pixel-perfect match. */
  similarityPercent: number;
  /** Colour-coded RGBA diff canvas, or `null` when the comparison failed. */
  diffImage: RgbaImage | null;
  discrepancies: DiffDiscrepancy[];
  /** Present only when `ok === false`. */
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Service-level contracts                                                    */
/* -------------------------------------------------------------------------- */

/** One viewport comparison request: an original capture and a generated render. */
export interface ViewportComparisonInput {
  /** Emulated viewport name (e.g. `desktop`), used for matching and reporting. */
  profile: string;
  width: number;
  height: number;
  /** Raw PNG bytes of the original captured page (from the sandboxed capture). */
  originalPng: Uint8Array | null;
  /** Raw PNG bytes of the generated page render (from the local dev server). */
  generatedPng: Uint8Array | null;
}

export interface ViewportComparison {
  profile: string;
  /** True when both images decoded and were compared. */
  compared: boolean;
  width: number;
  height: number;
  mismatchedPixels: number;
  totalPixels: number;
  similarityPercent: number;
  discrepancies: DiffDiscrepancy[];
  /** Non-null when this viewport was skipped (missing/unreadable image). */
  skippedReason: string | null;
  /** Raw PNG bytes of the colour-coded diff image, when produced. */
  diffPng: Uint8Array | null;
}

export interface VisualDiffReportSummary {
  viewports: number;
  compared: number;
  skipped: number;
  /** Mean similarity across compared viewports, rounded to two decimals. */
  averageSimilarityPercent: number;
  mismatchedPixels: number;
  totalPixels: number;
  /** True when any viewport was skipped or showed a dimension mismatch. */
  partial: boolean;
}

/** The aggregate result of a visual diff run. Always returned, never thrown. */
export interface VisualDiffReport {
  ok: boolean;
  /** Per-viewport comparisons in requested order. */
  comparisons: ViewportComparison[];
  summary: VisualDiffReportSummary;
  aborted: boolean;
  /** Present only when `ok === false` (invalid input, io error, server failure). */
  error?: { code: string; message: string; suggestedAction: string };
}
