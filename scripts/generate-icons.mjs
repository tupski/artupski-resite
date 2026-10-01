/**
 * Generates the minimal Tauri app icon set (PNG only) without requiring the
 * Rust toolchain. Produces a flat brand tile with a monospace-style "R".
 *
 * Run with: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../src-tauri/icons');
mkdirSync(outDir, { recursive: true });

const BRAND = [2, 132, 199];
const BG = [15, 17, 23];
const FG = [241, 245, 249];

/** CRC32 as required by the PNG chunk format. */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Build a size x size RGBA PNG. `pixel(x,y)` returns [r,g,b,a]. */
function makePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Simple bitmap glyph for the letter "R" on a 5x7 grid. */
const GLYPH_R = [
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
  [1, 0, 0, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 0, 0, 1, 1],
  [1, 0, 0, 0, 1]
];

function iconPixel(size) {
  const pad = Math.round(size * 0.18);
  const inner = size - pad * 2;
  const glyphW = Math.floor(inner / 5);
  const glyphH = Math.floor(inner / 7);
  const startY = pad;

  return (x, y) => {
    if (x < pad || y < pad || x >= size - pad || y >= size - pad) return [...BG, 255];
    const gx = Math.floor((x - pad) / glyphW);
    const gy = Math.floor((y - startY) / glyphH);
    if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && GLYPH_R[gy][gx] === 1) {
      return [...FG, 255];
    }
    return [...BRAND, 255];
  };
}

/** Wrap PNG buffers in an ICO container (PNG-encoded entries). */
function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0; // palette
    directory[base + 3] = 0; // reserved
    directory.writeUInt16LE(1, base + 4); // color planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/**
 * Minimal ICNS container with PNG payloads for the standard sizes macOS uses.
 * Tauri accepts PNG-backed icns entries.
 */
function makeIcns(entries) {
  const typeFor = (size) =>
    size === 512 ? 'ic10' : size === 256 ? 'ic09' : size === 128 ? 'ic07' : 'ic08';

  const body = Buffer.concat(
    entries.flatMap((entry) => {
      const type = Buffer.from(typeFor(entry.size), 'ascii');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(entry.png.length + 8, 0);
      return [type, length, entry.png];
    })
  );

  const total = Buffer.alloc(4);
  total.writeUInt32BE(body.length + 8, 0);
  return Buffer.concat([Buffer.from('icns', 'ascii'), total, body]);
}

const pngTargets = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512]
];

for (const [name, size] of pngTargets) {
  writeFileSync(resolve(outDir, name), makePng(size, iconPixel(size)));
  console.log(`wrote icons/${name} (${size}x${size})`);
}

const icoEntries = [16, 32, 48, 64, 128, 256].map((size) => ({
  size,
  png: makePng(size, iconPixel(size))
}));
writeFileSync(resolve(outDir, 'icon.ico'), makeIco(icoEntries));
console.log('wrote icons/icon.ico');

const icnsEntries = [128, 256, 512].map((size) => ({
  size,
  png: makePng(size, iconPixel(size))
}));
writeFileSync(resolve(outDir, 'icon.icns'), makeIcns(icnsEntries));
console.log('wrote icons/icon.icns');
