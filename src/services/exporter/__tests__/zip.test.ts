/**
 * Phase 14 ZIP codec suites - Artupski ReSite
 *
 * Covers CRC-32 known-answer vectors, header/EOCD byte layout, round-trip
 * integrity via `readZip`, byte-for-byte determinism, corruption rejection,
 * ordering, and the empty archive. No filesystem, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  buildZip,
  crc32,
  readZip,
  ZipError,
  ZIP_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_DOS_DATE_1980_01_01,
  ZIP_DOS_TIME_MIDNIGHT,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_FLAG_UTF8,
  ZIP_LOCAL_FILE_HEADER_SIGNATURE
} from '../zip';

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('crc32 (known-answer vectors)', () => {
  it('matches the canonical IEEE vectors', () => {
    expect(crc32(bytesOf(''))).toBe(0);
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('returns an unsigned 32-bit value', () => {
    const value = crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('buildZip header layout', () => {
  it('writes local headers, a central directory, and an EOCD with the fixed fields', () => {
    const files = new Map<string, Uint8Array>([['hello.txt', bytesOf('hello')]]);
    const { bytes, entries } = buildZip(files);
    const view = viewOf(bytes);

    expect(view.getUint32(0, true)).toBe(ZIP_LOCAL_FILE_HEADER_SIGNATURE);
    expect(view.getUint16(6, true)).toBe(ZIP_FLAG_UTF8);
    expect(view.getUint16(10, true)).toBe(ZIP_DOS_TIME_MIDNIGHT);
    expect(view.getUint16(12, true)).toBe(ZIP_DOS_DATE_1980_01_01);
    expect(view.getUint32(14, true)).toBe(crc32(bytesOf('hello')));
    expect(view.getUint32(18, true)).toBe(5);
    expect(view.getUint32(22, true)).toBe(5);
    expect(view.getUint16(26, true)).toBe('hello.txt'.length);

    // EOCD is the final 22 bytes.
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
    expect(view.getUint16(eocd + 8, true)).toBe(1);
    expect(view.getUint16(eocd + 10, true)).toBe(1);

    // Central directory signature is recorded at the EOCD's offset.
    const centralOffset = view.getUint32(eocd + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(ZIP_CENTRAL_DIRECTORY_SIGNATURE);
    expect(view.getUint16(centralOffset + 8, true)).toBe(ZIP_FLAG_UTF8);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'hello.txt',
      compressedSize: 5,
      uncompressedSize: 5,
      method: 'store'
    });
  });
});

describe('buildZip / readZip round-trip', () => {
  it('restores every path and byte', () => {
    const files = new Map<string, Uint8Array>([
      ['a.txt', bytesOf('alpha')],
      ['dir/b.txt', bytesOf('beta')],
      ['dir/nested/c.bin', new Uint8Array([0, 1, 2, 3, 255])]
    ]);
    const { bytes, entries } = buildZip(files);
    const archive = readZip(bytes);

    expect(entries.map((entry) => entry.path)).toEqual(['a.txt', 'dir/b.txt', 'dir/nested/c.bin']);
    expect([...archive.data.keys()]).toEqual(['a.txt', 'dir/b.txt', 'dir/nested/c.bin']);
    for (const [path, data] of files) {
      expect(Array.from(archive.data.get(path)!)).toEqual(Array.from(data));
    }
    for (const entry of archive.entries) {
      expect(entry.crc32).toBe(crc32(files.get(entry.path)!));
    }
  });

  it('handles the empty archive', () => {
    const { bytes, entries } = buildZip(new Map());
    expect(entries).toEqual([]);
    const archive = readZip(bytes);
    expect(archive.entries).toEqual([]);
    expect(archive.data.size).toBe(0);
  });

  it('sorts entries by path ascending (byte order)', () => {
    const files = new Map<string, Uint8Array>([
      ['z.txt', bytesOf('z')],
      ['a.txt', bytesOf('a')],
      ['m/b.txt', bytesOf('m')]
    ]);
    const { entries } = buildZip(files);
    expect(entries.map((entry) => entry.path)).toEqual(['a.txt', 'm/b.txt', 'z.txt']);
  });

  it('is byte-for-byte deterministic across two builds', () => {
    const files = new Map<string, Uint8Array>([
      ['one', bytesOf('1')],
      ['two', bytesOf('2')]
    ]);
    const first = buildZip(files).bytes;
    const second = buildZip(files).bytes;
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('accepts a deflate request but deterministically stores (falls back)', () => {
    const files = new Map<string, Uint8Array>([['a.txt', bytesOf('compress me')]]);
    const stored = buildZip(files, { compression: 'store' });
    const deflated = buildZip(files, { compression: 'deflate' });
    expect(Array.from(deflated.bytes)).toEqual(Array.from(stored.bytes));
    expect(deflated.entries[0]!.method).toBe('store');
  });
});

describe('readZip corruption detection', () => {
  it('throws ZipError when the archive is truncated', () => {
    const { bytes } = buildZip(new Map([['a.txt', bytesOf('alpha')]]));
    expect(() => readZip(bytes.slice(0, bytes.length - 4))).toThrow(ZipError);
  });

  it('throws ZipError when a stored byte is flipped', () => {
    const { bytes } = buildZip(new Map([['a.txt', bytesOf('alpha')]]));
    const corrupted = bytes.slice();
    // Flip the first data byte (after the 30-byte header + 5-byte name).
    corrupted[35] = corrupted[35]! ^ 0xff;
    expect(() => readZip(corrupted)).toThrow(ZipError);
  });

  it('throws ZipError when the local header signature is corrupted', () => {
    const { bytes } = buildZip(new Map([['a.txt', bytesOf('alpha')]]));
    const corrupted = bytes.slice();
    corrupted[0] = 0x00;
    expect(() => readZip(corrupted)).toThrow(ZipError);
  });

  it('throws ZipError when no EOCD can be found', () => {
    expect(() => readZip(new Uint8Array(64))).toThrow(ZipError);
  });
});
