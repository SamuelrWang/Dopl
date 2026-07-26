/**
 * Generates the macOS tray template images (black glyph on transparent alpha).
 * Template images MUST be black + alpha only — macOS recolors them for
 * light/dark menu bars. Emits renderer/assets/trayTemplate.png (16px) and
 * trayTemplate@2x.png (32px). Pure Node (zlib), no native deps.
 *
 * Run once when the glyph changes:  node scripts/gen-tray-icon.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32 (PNG chunk checksums).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Coverage of the glyph at normalized coords (0..1). Rounded-corner speech
// bubble with a short tail at the lower-left — reads as "Channels / messages".
function glyphCoverage(nx, ny) {
  // Bubble body: rounded rect roughly spanning x[0.14,0.86] y[0.16,0.66].
  const cx = 0.5, cy = 0.41;
  const hx = 0.36, hy = 0.25, r = 0.13;
  const qx = Math.max(Math.abs(nx - cx) - (hx - r), 0);
  const qy = Math.max(Math.abs(ny - cy) - (hy - r), 0);
  const dBody = Math.sqrt(qx * qx + qy * qy) - r;

  // Tail: triangle hanging below the bubble's lower-left.
  let inTail = false;
  if (ny >= 0.58 && ny <= 0.82) {
    const t = (ny - 0.58) / (0.82 - 0.58); // 0 at top of tail, 1 at tip
    const left = 0.30 + t * 0.06;
    const right = 0.46 - t * 0.10;
    if (nx >= left && nx <= right) inTail = true;
  }
  return dBody <= 0 || inTail ? 1 : 0;
}

function renderPng(size) {
  const ss = 4; // supersample factor for antialiasing
  const raw = Buffer.alloc(size * (1 + size * 2)); // filter byte + GA per px
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss) / size;
          const ny = (y + (sy + 0.5) / ss) / size;
          hit += glyphCoverage(nx, ny);
        }
      }
      const alpha = Math.round((hit / (ss * ss)) * 255);
      raw[o++] = 0;      // gray = black
      raw[o++] = alpha;  // alpha = coverage
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 4;  // color type: grayscale + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'renderer', 'assets');
fs.writeFileSync(path.join(outDir, 'trayTemplate.png'), renderPng(16));
fs.writeFileSync(path.join(outDir, 'trayTemplate@2x.png'), renderPng(32));
console.log('Wrote trayTemplate.png (16) + trayTemplate@2x.png (32) to', outDir);
