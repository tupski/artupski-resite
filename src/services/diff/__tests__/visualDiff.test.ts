import { describe, expect, it } from 'vitest';
import { computeVisualDiff, isRgbaImage } from '../visualDiff';
import type { RgbaImage } from '../../../types/visualDiff';

/** Build a solid RGBA image of `width`x`height` filled with one colour. */
function solid(
  width: number,
  height: number,
  [r, g, b, a]: [number, number, number, number]
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

function clone(image: RgbaImage): RgbaImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/** Paint one pixel a different colour. */
function setPixel(image: RgbaImage, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = rgba[0];
  image.data[offset + 1] = rgba[1];
  image.data[offset + 2] = rgba[2];
  image.data[offset + 3] = rgba[3];
}

describe('isRgbaImage', () => {
  it('accepts a well-formed image', () => {
    expect(isRgbaImage(solid(2, 2, [0, 0, 0, 255]))).toBe(true);
  });

  it('rejects a buffer whose length does not match the dimensions', () => {
    expect(
      isRgbaImage({ width: 2, height: 2, data: new Uint8ClampedArray(4) } as unknown as RgbaImage)
    ).toBe(false);
  });

  it('rejects non-positive dimensions and non-buffers', () => {
    expect(isRgbaImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBe(false);
    expect(isRgbaImage(null)).toBe(false);
    expect(isRgbaImage({ width: 1, height: 1, data: [] })).toBe(false);
  });
});

describe('computeVisualDiff', () => {
  it('reports a perfect match for identical images', () => {
    const image = solid(4, 3, [10, 20, 30, 255]);
    const result = computeVisualDiff(image, clone(image));
    expect(result.ok).toBe(true);
    expect(result.mismatchedPixels).toBe(0);
    expect(result.similarityPercent).toBe(100);
    expect(result.discrepancies).toEqual([]);
    expect(result.diffImage).not.toBeNull();
  });

  it('counts exactly the changed pixels and lowers the score', () => {
    const original = solid(4, 4, [0, 0, 0, 255]);
    const comparison = clone(original);
    setPixel(comparison, 1, 1, [255, 255, 255, 255]);
    setPixel(comparison, 2, 2, [255, 255, 255, 255]);
    const result = computeVisualDiff(original, comparison);
    expect(result.mismatchedPixels).toBe(2);
    expect(result.totalPixels).toBe(16);
    expect(result.similarityPercent).toBe(87.5);
    expect(result.discrepancies[0]?.kind).toBe('pixel_mismatch');
  });

  it('ignores imperceptible differences below the threshold', () => {
    const original = solid(2, 2, [100, 100, 100, 255]);
    const comparison = clone(original);
    setPixel(comparison, 0, 0, [110, 100, 100, 255]);
    const result = computeVisualDiff(original, comparison, { threshold: 32 });
    expect(result.mismatchedPixels).toBe(0);
    expect(result.similarityPercent).toBe(100);
  });

  it('flags a wide contiguous change as a layout shift', () => {
    const original = solid(100, 20, [0, 0, 0, 255]);
    const comparison = clone(original);
    // Repaint an entire row: spans the width and exceeds the share threshold.
    for (let x = 0; x < 100; x += 1) {
      setPixel(comparison, x, 10, [255, 255, 255, 255]);
    }
    const result = computeVisualDiff(original, comparison);
    expect(result.ok).toBe(true);
    expect(result.discrepancies.some((entry) => entry.kind === 'layout_shift')).toBe(true);
  });

  it('errors on a size mismatch by default', () => {
    const result = computeVisualDiff(solid(2, 2, [0, 0, 0, 255]), solid(3, 3, [0, 0, 0, 255]));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dimensions differ/i);
    expect(result.diffImage).toBeNull();
  });

  it('pads to a common canvas when size mismatches are allowed', () => {
    const result = computeVisualDiff(solid(2, 2, [0, 0, 0, 255]), solid(3, 3, [0, 0, 0, 255]), {
      allowSizeMismatch: true
    });
    expect(result.ok).toBe(true);
    expect(result.width).toBe(3);
    expect(result.height).toBe(3);
    // 9 total pixels, 4 match the overlapping area, 5 are padding mismatches.
    expect(result.mismatchedPixels).toBe(5);
    expect(result.discrepancies.some((entry) => entry.kind === 'dimension_mismatch')).toBe(true);
  });

  it('writes magenta highlights for mismatches and grey for matches', () => {
    const original = solid(2, 1, [0, 0, 0, 255]);
    const comparison = clone(original);
    setPixel(comparison, 1, 0, [255, 255, 255, 255]);
    const result = computeVisualDiff(original, comparison);
    const diff = result.diffImage!;
    // First pixel matched: grey.
    expect([diff.data[0], diff.data[1], diff.data[2]]).toEqual([210, 210, 210]);
    // Second pixel mismatched: magenta highlight.
    expect([diff.data[4], diff.data[5], diff.data[6]]).toEqual([255, 0, 96]);
  });

  it('rejects an invalid image without throwing', () => {
    const result = computeVisualDiff(
      { width: 1, height: 1, data: new Uint8ClampedArray(0) },
      solid(1, 1, [0, 0, 0, 255])
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
