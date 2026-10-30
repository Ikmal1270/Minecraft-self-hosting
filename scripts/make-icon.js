// Generates assets/icon.png (256x256) and assets/icon.ico - an isometric pixel-art
// grass block on a rounded dark tile. Run with: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Deterministic noise so the texture is the same on every run.
function noise(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const alpha = a / 255;
    px[i] = Math.round(r * alpha + px[i] * (1 - alpha));
    px[i + 1] = Math.round(g * alpha + px[i + 1] * (1 - alpha));
    px[i + 2] = Math.round(b * alpha + px[i + 2] * (1 - alpha));
    px[i + 3] = Math.max(px[i + 3], a);
  };

  // Rounded background tile with a subtle vertical gradient.
  const s = size / 256;
  const radius = 52 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(radius, Math.min(size - 1 - radius, x));
      const cy = Math.max(radius, Math.min(size - 1 - radius, y));
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const edge = Math.min(1, radius - d);
      const t = y / size;
      set(x, y, [Math.round(26 - 10 * t), Math.round(33 - 12 * t), Math.round(57 - 22 * t), Math.round(255 * edge)]);
    }
  }

  // Isometric cube: 16x16 texture per face.
  const cx = size / 2;
  const top = 38 * s;
  const half = 82 * s; // half width of the cube
  const qh = half / 2; // isometric height of the top face half
  const faceH = 96 * s; // vertical side height
  const N = 16;

  const grass = (u, v) => {
    const n = noise(u, v, 1);
    const g = [[95, 168, 55], [110, 186, 64], [84, 150, 48], [124, 200, 74]][Math.floor(n * 4)];
    return g;
  };
  const dirt = (u, v, face) => {
    const n = noise(u, v, face);
    const grassLip = v < 3 + Math.floor(noise(u, 7, face) * 3);
    if (grassLip) return [[95, 168, 55], [84, 150, 48], [110, 186, 64]][Math.floor(n * 3)];
    return [[134, 96, 67], [121, 85, 58], [150, 108, 75], [108, 76, 52]][Math.floor(n * 4)];
  };
  const shade = (c, f) => c.map((v) => Math.round(v * f));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      // Top face: diamond.
      const ty = y - (top + qh);
      const a = (dx / half + ty / qh) / 2; // 0..1 along one edge
      const b = (-dx / half + ty / qh) / 2;
      const ua = a + 0.5;
      const ub = b + 0.5;
      if (ua >= 0 && ua < 1 && ub >= 0 && ub < 1) {
        set(x, y, shade(grass(Math.floor(ua * N), Math.floor(ub * N)), 1.05));
        continue;
      }
      // Left face.
      if (dx < 0 && dx >= -half) {
        const u = (dx + half) / half;
        const yTop = top + qh + u * qh;
        const v = (y - yTop) / faceH;
        if (v >= 0 && v < 1) {
          set(x, y, shade(dirt(Math.floor(u * N), Math.floor(v * N), 2), 0.82));
          continue;
        }
      }
      // Right face.
      if (dx >= 0 && dx < half) {
        const u = dx / half;
        const yTop = top + 2 * qh - u * qh;
        const v = (y - yTop) / faceH;
        if (v >= 0 && v < 1) {
          set(x, y, shade(dirt(Math.floor(u * N), Math.floor(v * N), 3), 0.64));
        }
      }
    }
  }
  return encodePng(size, px);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const png256 = render(256);
fs.writeFileSync(path.join(out, 'icon.png'), png256);
fs.writeFileSync(path.join(out, 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: size === 256 ? png256 : render(size) }))));
console.log('Wrote assets/icon.png and assets/icon.ico');
