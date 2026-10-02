import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, PngError } from '../png';
import type { RgbaImage } from '../../../types/visualDiff';

function image(width: number, height: number, seed = 0): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = (i * 7 + seed) % 256;
    data[i * 4 + 1] = (i * 13 + seed) % 256;
    data[i * 4 + 2] = (i * 29 + seed) % 256;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('png codec', () => {
  it('round-trips an RGBA image byte-for-byte', async () => {
    const original = image(7, 5, 3);
    const png = await encodePng(original);
    const decoded = await decodePng(png);
    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(5);
    expect(Array.from(decoded.data)).toEqual(Array.from(original.data));
  });

  it('produces a valid PNG signature and IHDR', async () => {
    const png = await encodePng(image(2, 2));
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    // IHDR length 13 and type 'IHDR'.
    expect(String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!)).toBe('IHDR');
  });

  it('preserves alpha channel values', async () => {
    const source = image(3, 1);
    source.data[3] = 128;
    source.data[7] = 0;
    const decoded = await decodePng(await encodePng(source));
    expect(decoded.data[3]).toBe(128);
    expect(decoded.data[7]).toBe(0);
  });

  it('rejects an empty buffer', async () => {
    await expect(decodePng(new Uint8Array(0))).rejects.toBeInstanceOf(PngError);
  });

  it('rejects a non-PNG buffer', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(
      PngError
    );
  });

  it('rejects a truncated PNG', async () => {
    const png = await encodePng(image(4, 4));
    const truncated = png.subarray(0, 20);
    await expect(decodePng(truncated)).rejects.toBeInstanceOf(PngError);
  });

  it('rejects an image whose data does not match its declared size', async () => {
    await expect(
      encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(4) })
    ).rejects.toBeInstanceOf(PngError);
  });
});
