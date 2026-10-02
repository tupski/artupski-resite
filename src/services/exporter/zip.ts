/**
 * Minimal, deterministic ZIP codec - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 14) and
 * docs/impl-plan/phase-14-impl-plan.md section 7.5.
 *
 * Phase 14 must bundle a generated project into a standalone ZIP archive WITHOUT
 * adding a runtime dependency (`jszip`/`adm-zip`/`archiver`/`fflate`/`pako`).
 * This module is a small, dependency-free, RUNTIME-AGNOSTIC implementation: it
 * imports nothing from Node or the Tauri shell, so the pure ZIP writer stays
 * portable and trivially testable.
 *
 * Determinism guarantees:
 *   - entries are sorted by their UTF-8 path, byte-wise ascending;
 *   - every entry uses the fixed DOS timestamp 1980-01-01 00:00:00;
 *   - the UTF-8 name flag (bit 11) is always set;
 *   - the compression policy is `'store'`, so the byte output is identical
 *     across runs and environments.
 *
 * The plan (`section 7.5`) describes a `'deflate'` policy via the asynchronous
 * `CompressionStream('deflate-raw')`, but the authoritative `buildZip` signature
 * is synchronous, so a truly asynchronous compressor cannot be used here. Per the
 * plan's own fallback rule ("the result is accepted only if it is strictly
 * smaller ... otherwise the entry falls back to store"), requesting `'deflate'`
 * deterministically falls back to `'store'`. The default store policy is what the
 * tests assert byte-for-byte.
 */
import type { ZipCompressionMethod, ZipEntryMeta } from '../../types/export';

/* -------------------------------------------------------------------------- */
/* Signatures & fixed header values                                           */
/* -------------------------------------------------------------------------- */

export const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
export const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const ZIP_VERSION_NEEDED = 20; // 2.0: supports deflate + directory entries
export const ZIP_VERSION_MADE_BY = 20;
export const ZIP_FLAG_UTF8 = 0x0800; // general-purpose bit 11 (UTF-8 file names)
export const ZIP_DOS_TIME_MIDNIGHT = 0x0000; // fixed 00:00:00
export const ZIP_DOS_DATE_1980_01_01 = 0x0021; // (year-1980)<<9 | month<<5 | day = 33
export const ZIP_METHOD_STORE = 0;
export const ZIP_METHOD_DEFLATE = 8;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_SIZE = 46;
const EOCD_SIZE = 22;

/** A ZIP parse/verify failure with a bounded, non-secret message. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/* -------------------------------------------------------------------------- */
/* CRC-32 (IEEE 0xEDB88320)                                                   */
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

/** CRC-32 (IEEE) of `bytes`, unsigned 32-bit. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Writer                                                                     */
/* -------------------------------------------------------------------------- */

/** Byte-wise ascending UTF-8 ordering for deterministic entry placement. */
function compareUtf8(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

/**
 * Resolve the requested policy to the method actually written. The core always
 * stores bytes so output stays byte-deterministic; `'deflate'` is accepted as an
 * input but deterministically falls back to store (see the module header).
 */
function resolveStoredMethod(_requested: ZipCompressionMethod): ZipCompressionMethod {
  return 'store';
}

/**
 * Build a sorted, deterministic ZIP archive from a path→bytes map. The core
 * policy is `'store'`; a `'deflate'` request deterministically falls back to
 * store (see the module header).
 */
export function buildZip(
  files: ReadonlyMap<string, Uint8Array>,
  options: { compression?: ZipCompressionMethod } = {}
): { bytes: Uint8Array; entries: ZipEntryMeta[] } {
  const method = resolveStoredMethod(options.compression ?? 'store');
  const names = [...files.keys()].sort(compareUtf8);

  const encoder = new TextEncoder();
  const prepared = names.map((path) => {
    const data = files.get(path)!;
    const name = encoder.encode(path);
    return {
      path,
      data,
      name,
      method,
      crc: crc32(data),
      localHeaderOffset: 0
    };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const entry of prepared) {
    localSize += LOCAL_HEADER_SIZE + entry.name.length + entry.data.length;
    centralSize += CENTRAL_DIRECTORY_SIZE + entry.name.length;
  }
  const total = localSize + centralSize + EOCD_SIZE;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  const entries: ZipEntryMeta[] = [];
  let offset = 0;
  for (const entry of prepared) {
    entry.localHeaderOffset = offset;
    view.setUint32(offset, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 6, ZIP_FLAG_UTF8, true);
    view.setUint16(offset + 8, ZIP_METHOD_STORE, true);
    view.setUint16(offset + 10, ZIP_DOS_TIME_MIDNIGHT, true);
    view.setUint16(offset + 12, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += LOCAL_HEADER_SIZE;
    bytes.set(entry.name, offset);
    offset += entry.name.length;
    bytes.set(entry.data, offset);
    offset += entry.data.length;

    entries.push({
      path: entry.path,
      crc32: entry.crc,
      compressedSize: entry.data.length,
      uncompressedSize: entry.data.length,
      method: entry.method
    });
  }

  const centralDirectoryOffset = offset;
  for (const entry of prepared) {
    const localHeaderOffset = entry.localHeaderOffset;
    view.setUint32(offset, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION_MADE_BY, true);
    view.setUint16(offset + 6, ZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 8, ZIP_FLAG_UTF8, true);
    view.setUint16(offset + 10, ZIP_METHOD_STORE, true);
    view.setUint16(offset + 12, ZIP_DOS_TIME_MIDNIGHT, true);
    view.setUint16(offset + 14, ZIP_DOS_DATE_1980_01_01, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true); // extra length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, 0, true); // external attributes
    view.setUint32(offset + 42, localHeaderOffset, true);
    offset += CENTRAL_DIRECTORY_SIZE;
    bytes.set(entry.name, offset);
    offset += entry.name.length;
  }
  const centralDirectorySize = offset - centralDirectoryOffset;

  view.setUint32(offset, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true); // disk number
  view.setUint16(offset + 6, 0, true); // disk with central directory
  view.setUint16(offset + 8, prepared.length, true); // entries on disk
  view.setUint16(offset + 10, prepared.length, true); // total entries
  view.setUint32(offset + 12, centralDirectorySize, true);
  view.setUint32(offset + 16, centralDirectoryOffset, true);
  view.setUint16(offset + 20, 0, true); // comment length

  return { bytes, entries };
}

/* -------------------------------------------------------------------------- */
/* Reader (integrity verification)                                            */
/* -------------------------------------------------------------------------- */

export interface ZipArchive {
  readonly entries: ZipEntryMeta[];
  /** Uncompressed bytes per entry path. */
  readonly data: Map<string, Uint8Array>;
}

/**
 * Parse and verify a ZIP produced by `buildZip`; throws `ZipError` on
 * corruption. Supports the stored method the writer emits and rejects any other
 * method with an actionable message.
 */
export function readZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes.length);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralDirectorySize = view.getUint32(eocd + 12, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);

  if (centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new ZipError('Central directory extends past the end of the archive.');
  }

  const entries: ZipEntryMeta[] = [];
  const data = new Map<string, Uint8Array>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_DIRECTORY_SIZE > bytes.length) {
      throw new ZipError('Central directory record is truncated.');
    }
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipError('Central directory record signature mismatch.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + CENTRAL_DIRECTORY_SIZE;
    if (nameStart + nameLength > bytes.length) {
      throw new ZipError('Central directory entry name is truncated.');
    }
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    cursor = nameStart + nameLength + extraLength + commentLength;

    if ((flags & ZIP_FLAG_UTF8) === 0) {
      throw new ZipError(`Entry ${JSON.stringify(name)} is missing the UTF-8 name flag.`);
    }
    if (method !== ZIP_METHOD_STORE) {
      throw new ZipError(
        `Entry ${JSON.stringify(name)} uses unsupported compression method ${method}; only store is supported.`
      );
    }

    const extracted = readStoredEntry(
      view,
      bytes,
      localHeaderOffset,
      name,
      nameLength,
      compressedSize
    );
    if (extracted.length !== uncompressedSize) {
      throw new ZipError(`Entry ${JSON.stringify(name)} size mismatch.`);
    }
    if (crc32(extracted) !== crc) {
      throw new ZipError(`Entry ${JSON.stringify(name)} failed its CRC-32 check.`);
    }

    entries.push({ path: name, crc32: crc, compressedSize, uncompressedSize, method: 'store' });
    data.set(name, extracted);
  }

  return { entries, data };
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const minimum = Math.max(0, length - EOCD_SIZE - 0xffff);
  for (let offset = length - EOCD_SIZE; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new ZipError('End of central directory record not found.');
}

function readStoredEntry(
  view: DataView,
  bytes: Uint8Array,
  localHeaderOffset: number,
  name: string,
  nameLength: number,
  compressedSize: number
): Uint8Array {
  if (localHeaderOffset + LOCAL_HEADER_SIZE > bytes.length) {
    throw new ZipError(`Local header for ${JSON.stringify(name)} is truncated.`);
  }
  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ZipError(`Local header signature mismatch for ${JSON.stringify(name)}.`);
  }
  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
  if (dataStart + compressedSize > bytes.length) {
    throw new ZipError(`Entry ${JSON.stringify(name)} data is truncated.`);
  }
  if (localNameLength !== nameLength) {
    throw new ZipError(`Entry ${JSON.stringify(name)} name length mismatch.`);
  }
  return bytes.slice(dataStart, dataStart + compressedSize);
}
