/**
 * Pure visual diff core - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 13) and
 * docs/impl-plan/phase-13-impl-plan.md sections 7.3, 10-12.
 *
 * This module is the ONLY place pixels are compared. It is pure and synchronous
 * over two already-decoded RGBA buffers, so it is deterministic and directly
 * testable with known images - no browser, no network, no filesystem.
 *
 * The comparison follows the documented intent of the roadmap's "Pixelmatch"
 * reference (a bounded per-channel colour distance with a threshold and a
 * red/magenta highlight overlay) but is implemented without a dependency (see
 * the impl plan section 17, deviation 1).
 *
 * Honesty rules:
 *  - a size mismatch is an ERROR by default (it is reported, never hidden);
 *  - with `allowSizeMismatch` both images are compared on a padded common canvas
 *    and the size difference is surfaced as a `dimension_mismatch` discrepancy;
 *  - a mismatch is only labelled `layout_shift`/`missing_image`/`missing_font`
 *    when the geometry supports it; otherwise it is a generic `pixel_mismatch`.
 */
import {
  DEFAULT_DIFF_THRESHOLD,
  MAX_DIFF_DISCREPANCIES,
  MAX_DIFF_PIXELS,
  type DiffDiscrepancy,
  type DiffRegion,
  type RgbaImage,
  type VisualDiffOptions,
  type VisualDiffResult
} from '../../types/visualDiff';

/** Colour used to highlight a mismatched pixel in the diff canvas (magenta/red). */
const MISMATCH_COLOR = { r: 255, g: 0, b: 96 } as const;
/** Base colour for a matching pixel in the diff canvas (neutral dim grey). */
const MATCH_COLOR = { r: 210, g: 210, b: 210 } as const;

function clampThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_DIFF_THRESHOLD;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Validate an RGBA image: positive dimensions and exactly `w*h*4` bytes. */
export function isRgbaImage(value: unknown): value is RgbaImage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RgbaImage>;
  if (
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    !(candidate.data instanceof Uint8ClampedArray)
  ) {
    return false;
  }
  if (
    !Number.isInteger(candidate.width) ||
    !Number.isInteger(candidate.height) ||
    candidate.width <= 0 ||
    candidate.height <= 0
  ) {
    return false;
  }
  if (candidate.width * candidate.height > MAX_DIFF_PIXELS) {
    return false;
  }
  return candidate.data.length === candidate.width * candidate.height * 4;
}

/** Per-pixel maximum per-channel difference (0-255), alpha included. */
function channelDistance(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  offsetA: number,
  offsetB: number
): number {
  const dr = Math.abs(a[offsetA]! - b[offsetB]!);
  const dg = Math.abs(a[offsetA + 1]! - b[offsetB + 1]!);
  const db = Math.abs(a[offsetA + 2]! - b[offsetB + 2]!);
  const da = Math.abs(a[offsetA + 3]! - b[offsetB + 3]!);
  return Math.max(dr, dg, db, da);
}

/**
 * Compare two RGBA images and return an honest diff. Always returns a result;
 * an invalid input yields `ok: false` with a bounded `error` and no image.
 */
export function computeVisualDiff(
  original: RgbaImage,
  comparison: RgbaImage,
  options: VisualDiffOptions = {}
): VisualDiffResult {
  if (!isRgbaImage(original) || !isRgbaImage(comparison)) {
    return failed('Both images must be valid RGBA buffers with matching byte length.');
  }

  const threshold = clampThreshold(options.threshold);
  const sizeMismatch = original.width !== comparison.width || original.height !== comparison.height;
  if (sizeMismatch && options.allowSizeMismatch !== true) {
    return failed(
      `Image dimensions differ (${original.width}x${original.height} vs ${comparison.width}x${comparison.height}).`
    );
  }

  const width = Math.max(original.width, comparison.width);
  const height = Math.max(original.height, comparison.height);
  const totalPixels = width * height;
  if (totalPixels > MAX_DIFF_PIXELS) {
    return failed('Combined image size exceeds the maximum comparable size.');
  }

  const diff = new Uint8ClampedArray(totalPixels * 4);
  let mismatchedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inOriginal = x < original.width && y < original.height;
      const inComparison = x < comparison.width && y < comparison.height;
      const pixel = (y * width + x) * 4;

      // A pixel present in only one image (padding from a size mismatch) is a
      // mismatch by definition; it is never treated as a transparent match.
      let mismatch: boolean;
      if (!inOriginal || !inComparison) {
        mismatch = true;
      } else {
        const offsetA = (y * original.width + x) * 4;
        const offsetB = (y * comparison.width + x) * 4;
        mismatch = channelDistance(original.data, comparison.data, offsetA, offsetB) > threshold;
      }

      if (mismatch) {
        mismatchedPixels += 1;
        diff[pixel] = MISMATCH_COLOR.r;
        diff[pixel + 1] = MISMATCH_COLOR.g;
        diff[pixel + 2] = MISMATCH_COLOR.b;
        diff[pixel + 3] = 255;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        diff[pixel] = MATCH_COLOR.r;
        diff[pixel + 1] = MATCH_COLOR.g;
        diff[pixel + 2] = MATCH_COLOR.b;
        diff[pixel + 3] = 255;
      }
    }
  }

  const similarityPercent =
    totalPixels === 0 ? 100 : round2(((totalPixels - mismatchedPixels) / totalPixels) * 100);

  const discrepancies: DiffDiscrepancy[] = [];
  if (sizeMismatch) {
    discrepancies.push({
      kind: 'dimension_mismatch',
      message: `Rendered size differs from the original (${original.width}x${original.height} vs ${comparison.width}x${comparison.height}).`,
      severity: 'warning'
    });
  }

  if (mismatchedPixels > 0 && maxX >= 0 && maxY >= 0) {
    const region: DiffRegion = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
    discrepancies.push({
      kind: 'pixel_mismatch',
      message: `${mismatchedPixels} of ${totalPixels} pixels differ (${(100 - similarityPercent).toFixed(2)}%).`,
      region,
      severity: 'warning'
    });
    // A large contiguous mismatch band is reported as a layout shift; the
    // geometry (a wide/tall region with many pixels) is the only evidence used.
    if (isLayoutShift(region, width, height, mismatchedPixels, totalPixels)) {
      discrepancies.push({
        kind: 'layout_shift',
        message: 'A large contiguous region differs, consistent with a layout shift.',
        region,
        severity: 'warning'
      });
    }
  }

  return {
    ok: true,
    width,
    height,
    totalPixels,
    mismatchedPixels,
    similarityPercent,
    diffImage: { width, height, data: diff },
    discrepancies: discrepancies.slice(0, MAX_DIFF_DISCREPANCIES)
  };
}

/**
 * Heuristic layout-shift signal: a region that is unusually wide/tall AND
 * accounts for a meaningful share of the canvas. Deliberately conservative so a
 * few scattered antialiasing pixels are never called a layout shift.
 */
function isLayoutShift(
  region: DiffRegion,
  width: number,
  height: number,
  mismatched: number,
  total: number
): boolean {
  const spansWidth = region.width >= width * 0.5;
  const spansHeight = region.height >= height * 0.5;
  const share = total === 0 ? 0 : mismatched / total;
  return (spansWidth || spansHeight) && share >= 0.02;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function failed(message: string): VisualDiffResult {
  return {
    ok: false,
    width: 0,
    height: 0,
    totalPixels: 0,
    mismatchedPixels: 0,
    similarityPercent: 0,
    diffImage: null,
    discrepancies: [],
    error: message
  };
}
