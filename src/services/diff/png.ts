/**
 * Minimal PNG codec - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-13-impl-plan.md section 17 (deviation 1).
 *
 * Phase 13 must decode the PNGs the crawler worker already produces (Phase 7
 * `captureViewport`) and encode the colour-coded diff image, WITHOUT adding a
 * runtime image dependency (`pngjs`/`pixelmatch`). This module is a small,
 * well-tested, dependency-free implementation covering exactly what the project
 * needs: 8-bit, non-interlaced, RGB (colour type 2) or RGBA (colour type 6).
 *
 * Compression uses the platform `CompressionStream`/`DecompressionStream`
 * (`deflate` = zlib wrapper), available in the Tauri webview and in Node ≥ 18
 * (the Vitest environment). Anything outside the supported subset is REJECTED
 * with a bounded message - never silently mis-decoded.
 */
import { MAX_DIFF_IMAGE_BYTES, MAX_DIFF_PIXELS, type RgbaImage } from '../../types/visualDiff';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** A decode/encode failure with a bounded, non-secret message. */
export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

/* -------------------------------------------------------------------------- */
/* CRC-32 (PNG chunk checksums)                                               */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Deflate (zlib) - self-contained, environment-independent                   */
/* -------------------------------------------------------------------------- */

/**
 * Innermost DEFLATE decoder. A self-contained, dependency-free inflate so the
 * codec works identically in the Tauri webview, Node, and jsdom (where
 * `Blob.stream()` may be absent). Supports stored, fixed-Huffman, and dynamic-
 * Huffman blocks - i.e. everything a standard PNG encoder emits.
 */
function inflateRaw(input: Uint8Array): Uint8Array {
  const MAX_BITS = 15;
  let bitBuffer = 0;
  let bitCount = 0;
  let position = 0;

  const ensureBits = (count: number): void => {
    while (bitCount < count) {
      const byte = position < input.length ? input[position]! : 0;
      bitBuffer |= byte << bitCount;
      bitCount += 8;
      position += 1;
      if (position > input.length + 8) {
        throw new PngError('PNG image data is corrupt.');
      }
    }
  };

  const readBits = (count: number): number => {
    if (count === 0) {
      return 0;
    }
    ensureBits(count);
    const value = bitBuffer & ((1 << count) - 1);
    bitBuffer >>>= count;
    bitCount -= count;
    return value;
  };

  const alignToByte = (): void => {
    bitBuffer >>>= bitCount % 8;
    bitCount -= bitCount % 8;
  };

  /** Decode one symbol using a canonical Huffman code built from `lengths`. */
  const decodeSymbol = (lengths: number[]): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= MAX_BITS; length += 1) {
      code |= readBits(1);
      const count = lengths[length] ?? 0;
      if (code - first < count) {
        return index + (code - first);
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new PngError('PNG image data has an invalid Huffman code.');
  };

  const out: number[] = [];

  const fixedLiteralLengths = (): number[] => {
    const lengths = new Array<number>(288).fill(0);
    for (let i = 0; i < 144; i += 1) lengths[i] = 8;
    for (let i = 144; i < 256; i += 1) lengths[i] = 9;
    for (let i = 256; i < 280; i += 1) lengths[i] = 7;
    for (let i = 280; i < 288; i += 1) lengths[i] = 8;
    return lengths;
  };
  const FIXED_DISTANCE_LENGTHS = new Array<number>(30).fill(5);

  const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258
  ];
  const LENGTH_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  ];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
    3073, 4097, 6145, 8193, 12289, 16385, 24577
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  ];

  const readDynamicTables = (): { literal: number[]; distance: number[] } => {
    const hlit = readBits(5) + 257;
    const hdist = readBits(5) + 1;
    const hclen = readBits(4) + 4;
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const codeLengths = new Array<number>(19).fill(0);
    for (let i = 0; i < hclen; i += 1) {
      codeLengths[order[i]!] = readBits(3);
    }
    const total = hlit + hdist;
    const lengths: number[] = [];
    while (lengths.length < total) {
      const symbol = decodeSymbol(codeLengths);
      if (symbol < 16) {
        lengths.push(symbol);
      } else if (symbol === 16) {
        const previous = lengths[lengths.length - 1] ?? 0;
        const repeat = 3 + readBits(2);
        for (let i = 0; i < repeat; i += 1) lengths.push(previous);
      } else if (symbol === 17) {
        const repeat = 3 + readBits(3);
        for (let i = 0; i < repeat; i += 1) lengths.push(0);
      } else {
        const repeat = 11 + readBits(7);
        for (let i = 0; i < repeat; i += 1) lengths.push(0);
      }
    }
    return { literal: lengths.slice(0, hlit), distance: lengths.slice(hlit) };
  };

  let final = 0;
  do {
    final = readBits(1);
    const type = readBits(2);
    if (type === 0) {
      alignToByte();
      const length = input[position]! | (input[position + 1]! << 8);
      position += 4; // skip LEN + NLEN
      for (let i = 0; i < length; i += 1) {
        out.push(input[position + i]!);
      }
      position += length;
    } else if (type === 1) {
      decodeBlock(fixedLiteralLengths(), FIXED_DISTANCE_LENGTHS);
    } else if (type === 2) {
      const tables = readDynamicTables();
      decodeBlock(tables.literal, tables.distance);
    } else {
      throw new PngError('PNG uses an unsupported deflate block.');
    }
  } while (final !== 1);

  function decodeBlock(literalLengths: number[], distanceLengths: number[]): void {
    for (;;) {
      const symbol = decodeSymbol(literalLengths);
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      if (symbol === 256) {
        return;
      }
      const lengthIndex = symbol - 257;
      const length = LENGTH_BASE[lengthIndex]! + readBits(LENGTH_EXTRA[lengthIndex]!);
      const distanceSymbol = decodeSymbol(distanceLengths);
      const distance = DIST_BASE[distanceSymbol]! + readBits(DIST_EXTRA[distanceSymbol]!);
      const start = out.length - distance;
      if (start < 0) {
        throw new PngError('PNG image data references before the start.');
      }
      for (let i = 0; i < length; i += 1) {
        out.push(out[start + i]!);
      }
    }
  }

  return Uint8Array.from(out);
}

/** Strip the 2-byte zlib header and, when present, the 4-byte Adler-32 trailer. */
function inflateZlib(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2) {
    throw new PngError('PNG image data is too short.');
  }
  const cmf = bytes[0]!;
  const flg = bytes[1]!;
  if ((cmf & 0x0f) !== 8) {
    throw new PngError('PNG does not use deflate compression.');
  }
  if ((cmf * 256 + flg) % 31 !== 0) {
    throw new PngError('PNG has a corrupt zlib header.');
  }
  let start = 2;
  if ((flg & 0x20) !== 0) {
    start += 4; // FDICT present; skip the dictionary id.
  }
  const raw = inflateRaw(bytes.subarray(start));
  // Validate the Adler-32 when the trailer is present and correct.
  if (bytes.length >= start + raw.length + 4) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < raw.length; i += 1) {
      a = (a + raw[i]!) % 65521;
      b = (b + a) % 65521;
    }
    const expected = ((b << 16) | a) >>> 0;
    const trailerLength = bytes.length - start - raw.length;
    const adlerStart = start + raw.length + Math.max(0, trailerLength - 4);
    const actual =
      ((bytes[adlerStart]! << 24) |
        (bytes[adlerStart + 1]! << 16) |
        (bytes[adlerStart + 2]! << 8) |
        bytes[adlerStart + 3]!) >>>
      0;
    if (trailerLength === 4 && actual !== expected) {
      throw new PngError('PNG image data failed its checksum.');
    }
  }
  return raw;
}

/**
 * Minimal DEFLATE encoder that emits a valid zlib stream of STORED (uncompressed)
 * blocks. This keeps the codec dependency-free and environment-independent; the
 * diff canvas is a validation artifact, so compression ratio is not a concern.
 */
function deflateZlib(bytes: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01]; // zlib header: deflate, default window
  const MAX_BLOCK = 0xffff;
  let offset = 0;
  do {
    const remaining = bytes.length - offset;
    const length = Math.min(remaining, MAX_BLOCK);
    const isFinal = offset + length >= bytes.length ? 1 : 0;
    blocks.push(isFinal);
    blocks.push(length & 0xff, (length >>> 8) & 0xff);
    blocks.push(~length & 0xff, (~length >>> 8) & 0xff);
    for (let i = 0; i < length; i += 1) {
      blocks.push(bytes[offset + i]!);
    }
    offset += length;
  } while (offset < bytes.length);

  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  blocks.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(blocks);
}

/* -------------------------------------------------------------------------- */
/* Decode                                                                     */
/* -------------------------------------------------------------------------- */

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

interface PngHeader {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  interlace: number;
}

function parseHeader(bytes: Uint8Array): PngHeader {
  if (bytes.length < 33) {
    throw new PngError('PNG is truncated.');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new PngError('Not a PNG file.');
    }
  }
  const length = readUint32(bytes, 8);
  if (length !== 13) {
    throw new PngError('PNG has an invalid IHDR chunk.');
  }
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (type !== 'IHDR') {
    throw new PngError('PNG is missing its IHDR chunk.');
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const interlace = bytes[28]!;
  if (width <= 0 || height <= 0) {
    throw new PngError('PNG has invalid dimensions.');
  }
  if (width * height > MAX_DIFF_PIXELS) {
    throw new PngError('PNG exceeds the maximum decodable size.');
  }
  if (bitDepth !== 8) {
    throw new PngError('Only 8-bit PNGs are supported.');
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new PngError('Only RGB and RGBA PNGs are supported.');
  }
  if (interlace !== 0) {
    throw new PngError('Interlaced PNGs are not supported.');
  }
  return { width, height, colorType, bitDepth, interlace };
}

/** Gather the concatenated IDAT payload of a PNG. */
function collectIdat(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new PngError('PNG chunk exceeds the file length.');
    }
    if (type === 'IDAT') {
      parts.push(bytes.subarray(dataStart, dataEnd));
    }
    if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (parts.length === 0) {
    throw new PngError('PNG has no image data.');
  }
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** Reverse PNG scanline filters into contiguous RGBA8 pixel data. */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number
): Uint8ClampedArray {
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new PngError('PNG image data is incomplete.');
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[src + x]!;
      const left = x >= channels ? line[x - channels]! : 0;
      const up = prev[x]!;
      const upLeft = x >= channels ? prev[x - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new PngError('PNG uses an unsupported filter.');
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s]!;
      out[d + 1] = line[s + 1]!;
      out[d + 2] = line[s + 2]!;
      out[d + 3] = channels === 4 ? line[s + 3]! : 255;
    }
    prev.set(line);
  }
  return out;
}

/**
 * Decode a PNG into RGBA8. Rejects anything outside the supported subset or
 * above the byte/pixel caps with a bounded `PngError`.
 */
export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new PngError('PNG bytes are empty.');
  }
  if (bytes.length > MAX_DIFF_IMAGE_BYTES) {
    throw new PngError('PNG exceeds the maximum accepted byte size.');
  }
  const header = parseHeader(bytes);
  const channels = header.colorType === 6 ? 4 : 3;
  const idat = collectIdat(bytes);
  const inflated = inflateZlib(idat);
  const data = unfilter(inflated, header.width, header.height, channels);
  return { width: header.width, height: header.height, data };
}

/* -------------------------------------------------------------------------- */
/* Encode                                                                     */
/* -------------------------------------------------------------------------- */

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    typeBytes[i] = type.charCodeAt(i);
  }
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUint32(out, 8 + data.length, crc32(crcInput));
  return out;
}

/** Encode an RGBA8 image as a non-interlaced 8-bit RGBA PNG. */
export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new PngError('Cannot encode an invalid RGBA image.');
  }
  if (width * height > MAX_DIFF_PIXELS) {
    throw new PngError('Image exceeds the maximum encodable size.');
  }

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const compressed = deflateZlib(raw);

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = new Uint8Array(PNG_SIGNATURE);
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  out.set(signature, cursor);
  cursor += signature.length;
  out.set(ihdrChunk, cursor);
  cursor += ihdrChunk.length;
  out.set(idatChunk, cursor);
  cursor += idatChunk.length;
  out.set(iendChunk, cursor);
  return out;
}
