// Pixel statistics for a capture, so lighting and material claims can be measured rather than eyeballed.
// Usage: node tools/probe.mjs <png> [x y w h ...]
// With no regions it reports whole-frame luma histogram facts: min, p1, p5, mean, and the
// fraction below the spec's floor of 30. Regions report mean rgb, luma, sd and B-R.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(path) {
  const buf = readFileSync(path);
  let p = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`probe: unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`probe: unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[q++];
    const row = raw.subarray(q, q + stride);
    q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, channels, data: out };
}

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const [, , file, ...rest] = process.argv;
const img = decode(file);
const { w, h, channels, data } = img;
const at = (x, y) => {
  const i = (y * w + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
};

if (rest.length === 0) {
  const ls = [];
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const l = luma(r, g, b);
      ls.push(l);
      sum += l;
    }
  }
  ls.sort((a, b) => a - b);
  const pct = (p) => ls[Math.floor((ls.length - 1) * p)].toFixed(1);
  const below = ls.filter((l) => l < 30).length / ls.length;
  console.log(`${file} ${w}x${h}`);
  console.log(
    `luma min ${ls[0].toFixed(1)}  p001 ${pct(0.001)}  p01 ${pct(0.01)}  p05 ${pct(0.05)}  ` +
      `mean ${(sum / ls.length).toFixed(1)}  p95 ${pct(0.95)}  max ${ls[ls.length - 1].toFixed(1)}`
  );
  console.log(`below luma 30: ${(below * 100).toFixed(2)}%`);
} else {
  for (let i = 0; i + 3 < rest.length; i += 4) {
    const [x0, y0, rw, rh] = rest.slice(i, i + 4).map(Number);
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sl = 0;
    let sl2 = 0;
    let min = 1e9;
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = x0; x < x0 + rw; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const [r, g, b] = at(x, y);
        const l = luma(r, g, b);
        sr += r;
        sg += g;
        sb += b;
        sl += l;
        sl2 += l * l;
        if (l < min) min = l;
        n++;
      }
    }
    const m = sl / n;
    console.log(
      `[${x0},${y0} ${rw}x${rh}] rgb(${(sr / n).toFixed(0)},${(sg / n).toFixed(0)},${(sb / n).toFixed(0)}) ` +
        `luma ${m.toFixed(1)} sd ${Math.sqrt(Math.max(0, sl2 / n - m * m)).toFixed(1)} ` +
        `min ${min.toFixed(1)} B-R ${((sb - sr) / n).toFixed(1)}`
    );
  }
}
