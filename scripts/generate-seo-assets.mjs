/**
 * Zero-dependency PNG generator for SARRAF SEO & PWA assets.
 * Generates:
 *  - public/favicon-32x32.png (32x32)
 *  - public/apple-touch-icon.png (180x180)
 *  - public/icon-192.png (192x192)
 *  - public/icon-512.png (512x512)
 *  - public/icon-maskable-192.png (192x192)
 *  - public/icon-maskable-512.png (512x512)
 *  - public/og-image.png (1200x630)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type 0
    const srcStart = y * width * 4;
    rgba.copy(raw, rowStart + 1, srcStart, srcStart + width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderDiamondIcon(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const scale = maskable ? 0.31 : 0.38;
  const rx = size * scale * 0.72;
  const ry = size * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const diamondDist = dx / rx + dy / ry;

      // Base #050505 with subtle radial gold glow
      const radial = Math.hypot(x - cx, y - cy) / (size * 0.55);
      const glow = Math.max(0, 1 - radial);

      let r = 5 + glow * 28;
      let g = 5 + glow * 21;
      let b = 5 + glow * 8;

      // Outer diamond border & inner facet fill
      if (diamondDist <= 1.0) {
        const edge = diamondDist > 0.86;
        const innerRidge = dx / (rx * 0.42) + dy / ry;
        if (edge || Math.abs(innerRidge - 1.0) < 0.08 || dy < size * 0.015) {
          r = 255;
          g = 217;
          b = 122;
        } else {
          const facetShade = x > cx ? 1.0 : 0.78;
          r = Math.round(232 * facetShade * 0.45 + 12);
          g = Math.round(184 * facetShade * 0.45 + 10);
          b = Math.round(74 * facetShade * 0.45 + 6);
        }
      }

      buf[idx] = Math.min(255, Math.round(r));
      buf[idx + 1] = Math.min(255, Math.round(g));
      buf[idx + 2] = Math.min(255, Math.round(b));
      buf[idx + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

function renderOgBanner(width = 1200, height = 630) {
  const buf = Buffer.alloc(width * height * 4);
  const dcx = width * 0.74;
  const dcy = height * 0.5;
  const rx = 115;
  const ry = 175;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dist = Math.hypot(x - dcx, y - dcy) / 380;
      const glow = Math.max(0, 1 - dist);

      let r = 5 + glow * 32;
      let g = 5 + glow * 24;
      let b = 5 + glow * 10;

      // Outer gold frame (36px inset)
      const onFrame =
        ((x === 36 || x === width - 36) && y >= 36 && y <= height - 36) ||
        ((y === 36 || y === height - 36) && x >= 36 && x <= width - 36);
      if (onFrame) {
        r = 232;
        g = 184;
        b = 74;
      }

      // Elongated gold diamond on right
      const dx = Math.abs(x - dcx);
      const dy = Math.abs(y - dcy);
      const dVal = dx / rx + dy / ry;
      if (dVal <= 1.0) {
        if (dVal > 0.92 || Math.abs(dx / (rx * 0.45) + dy / ry - 1.0) < 0.04 || dy <= 2) {
          r = 255;
          g = 217;
          b = 122;
        } else {
          r = 48;
          g = 38;
          b = 16;
        }
      }

      buf[idx] = Math.min(255, Math.round(r));
      buf[idx + 1] = Math.min(255, Math.round(g));
      buf[idx + 2] = Math.min(255, Math.round(b));
      buf[idx + 3] = 255;
    }
  }
  return encodePng(width, height, buf);
}

const pubDir = path.resolve(process.cwd(), 'public');
fs.writeFileSync(path.join(pubDir, 'favicon-32x32.png'), renderDiamondIcon(32, false));
fs.writeFileSync(path.join(pubDir, 'apple-touch-icon.png'), renderDiamondIcon(180, false));
fs.writeFileSync(path.join(pubDir, 'icon-192.png'), renderDiamondIcon(192, false));
fs.writeFileSync(path.join(pubDir, 'icon-512.png'), renderDiamondIcon(512, false));
fs.writeFileSync(path.join(pubDir, 'icon-maskable-192.png'), renderDiamondIcon(192, true));
fs.writeFileSync(path.join(pubDir, 'icon-maskable-512.png'), renderDiamondIcon(512, true));
fs.writeFileSync(path.join(pubDir, 'og-image.png'), renderOgBanner(1200, 630));
console.log('Generated SARRAF PNG icons and og-image.png in /public');
