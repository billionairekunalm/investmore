// Generates solid PNG app icons (blue tile + white candlesticks) without image deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
for (const s of [192, 512]) {
  const raw = Buffer.alloc((s * 4 + 1) * s);
  const bars = [[0.28, 0.45, 0.70], [0.46, 0.30, 0.62], [0.64, 0.38, 0.75]]; // x, top, bottom (fractions)
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      const fx = x / s, fy = y / s;
      const white = bars.some(([bx, t, b]) => (Math.abs(fx - bx) < 0.06 && fy > t && fy < b) || (Math.abs(fx - bx) < 0.008 && fy > t - 0.08 && fy < b + 0.08));
      const o = y * (s * 4 + 1) + 1 + x * 4;
      [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]] = white ? [255, 255, 255, 255] : [47, 91, 234, 255];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(`public/icon-${s}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
