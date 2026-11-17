// CPU port of W_DETAIL (source/src/shaders.js): the tileable 1024x1024 rock detail texture.
// rg = slope, b = height, a = mottling; RGBA8, row 0 first (v = 0 in both WebGPU and Unity).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { h31, h33 } from './density.mjs';

const fr = Math.fround, { floor, sqrt, min, max, abs } = Math;
const fract = (x) => x - floor(x);
const ss = (a, b, x) => { const t = min(max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const N = 1024;

const hp = (x, y, per) => h31(fr(x - per * floor(x / per)), fr(y - per * floor(y / per)), per);
function tn(x, y, per) {
  const ix = floor(x), iy = floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  return mix(mix(hp(ix, iy, per), hp(ix + 1, iy, per), fx), mix(hp(ix, iy + 1, per), hp(ix + 1, iy + 1, per), fx), fy);
}
function tf(x, y, per, n) { let a = 0.5, s = 0, pr = per; for (let i = 0; i < n; i++) { s += a * tn(x * pr + i * 7.3, y * pr + i * 7.3, pr); pr *= 2; a *= 0.5; } return s / (1 - 2 * a); }
const TW = new Float64Array(3);
function tw(x, y, per) {
  const ix = floor(x), iy = floor(y), fx = x - ix, fy = y - iy; let d0 = 9, d1 = 9, id = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const cx = ix + a, cy = iy + b, hh = h33(cx - per * floor(cx / per), cy - per * floor(cy / per), per);
    const rx = a + hh[0] - fx, ry = b + hh[1] - fy, l = rx * rx + ry * ry;
    if (l < d0) { d1 = d0; d0 = l; id = hh[2]; } else if (l < d1) d1 = l;
  }
  TW[0] = sqrt(d0); TW[1] = sqrt(d1); TW[2] = id; return TW;
}
function H(u, v) {
  const wx = u + 0.11 * (tf(u, v, 3, 4) - 0.5), wy = v + 0.11 * (tf(u + 0.5, v + 0.5, 3, 4) - 0.5);
  const f = tf(wx, wy, 3, 8);
  const r1 = 1 - abs(tf(wx + 1.7, wy + 1.7, 5, 6) * 2 - 1);
  const cr = min(abs(tf(wx + 4.1, wy + 4.1, 4, 5) * 2 - 1) * 7, 1);
  const cr2 = min(abs(tf(wy + 2.3, wx + 2.3, 9, 4) * 2 - 1) * 9, 1);
  const pt = tw(wx * 29, wy * 29, 29);
  const pit = (1 - ss(0, 0.34, pt[0])) * (pt[2] >= 0.62 ? 1 : 0);
  return f * 0.5 + r1 * r1 * 0.24 + cr * cr2 * 0.26 - pit * 0.07;
}
const u8 = (x) => Math.round(min(max(x, 0), 1) * 255);
function rows(out, y0, y1) {
  const e = 1 / N;
  for (let y = y0; y < y1; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, h = H(u, v);
    const gx = H(u + e, v) - H(u - e, v), gy = H(u, v + e) - H(u, v - e);
    const sx = min(max(gx * N * 0.5 * 0.075, -1), 1), sy = min(max(gy * N * 0.5 * 0.075, -1), 1);
    const o = (x + N * y) * 4;
    out[o] = u8(-sx * 0.5 + 0.5); out[o + 1] = u8(-sy * 0.5 + 0.5); out[o + 2] = u8(h); out[o + 3] = u8(tf(u + 3.7, v + 3.7, 3, 5));
  }
}
if (!isMainThread && workerData?.kind === 'detail') { rows(new Uint8Array(workerData.sab), workerData.y0, workerData.y1); parentPort.postMessage(1); }

export async function detailTexture(y0 = 0, y1 = N, threads = os.cpus().length) {
  const sab = new SharedArrayBuffer(N * N * 4);
  await Promise.all(Array.from({ length: threads }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { kind: 'detail', sab, y0: y0 + Math.floor(i * (y1 - y0) / threads), y1: y0 + Math.floor((i + 1) * (y1 - y0) / threads) } });
    w.once('message', () => { w.terminate(); res(); }); w.once('error', rej);
  })));
  return new Uint8Array(sab);
}
