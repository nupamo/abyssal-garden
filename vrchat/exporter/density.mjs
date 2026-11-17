// CPU port of W_DENS (source/src/shaders.js): the terrain density field the web version computes on the GPU.
// Hashes round to 32-bit floats like the shader does, so the result matches the GPU's to within noise-level
// differences (see verify-density.mjs). Runs on all cores with worker threads.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';

const fr = Math.fround, { floor, sqrt, min, max, abs, cos, sin, hypot } = Math;
const C1 = fr(0.1031), C2 = fr(0.1030), C3 = fr(0.0973), K33 = fr(33.33);
const fract = (x) => x - floor(x);
const ss = (a, b, x) => { const t = min(max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export function h31(px, py, pz) {
  let qx = fr(fract(fr(px * C1))), qy = fr(fract(fr(py * C2))), qz = fr(fract(fr(pz * C3)));
  const d = fr(fr(fr(qx * fr(qy + K33)) + fr(qy * fr(qz + K33))) + fr(qz * fr(qx + K33)));
  qx = fr(qx + d); qy = fr(qy + d); qz = fr(qz + d);
  return fract(fr(fr(qx + qy) * qz));
}
const H33 = new Float64Array(3);
export function h33(px, py, pz) {
  let qx = fr(fract(fr(px * C1))), qy = fr(fract(fr(py * C2))), qz = fr(fract(fr(pz * C3)));
  // q += dot(q, q.yxz + 33.33)
  const d = fr(fr(fr(qx * fr(qy + K33)) + fr(qy * fr(qx + K33))) + fr(qz * fr(qz + K33)));
  qx = fr(qx + d); qy = fr(qy + d); qz = fr(qz + d);
  // fract((q.xxy + q.yxx) * q.zyx)
  H33[0] = fract(fr(fr(qx + qy) * qz)); H33[1] = fract(fr(fr(qx + qx) * qy)); H33[2] = fract(fr(fr(qy + qx) * qx));
  return H33;
}
function vn(x, y, z) {
  const ix = floor(x), iy = floor(y), iz = floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  return mix(mix(mix(h31(ix, iy, iz), h31(ix + 1, iy, iz), fx), mix(h31(ix, iy + 1, iz), h31(ix + 1, iy + 1, iz), fx), fy),
    mix(mix(h31(ix, iy, iz + 1), h31(ix + 1, iy, iz + 1), fx), mix(h31(ix, iy + 1, iz + 1), h31(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
function fbm(x, y, z, n) {
  let a = 0.5, s = 0;
  for (let i = 0; i < n; i++) { s += a * vn(x, y, z); x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 5.3; a *= 0.5; }
  return s / (1 - 2 * a);
}
function wor(x, y, z) {
  const ix = floor(x), iy = floor(y), iz = floor(z), fx = x - ix, fy = y - iy, fz = z - iz; let d = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const h = h33(ix + a, iy + b, iz + c), rx = a + h[0] - fx, ry = b + h[1] - fy, rz = c + h[2] - fz, l = rx * rx + ry * ry + rz * rz;
    if (l < d) d = l;
  }
  return sqrt(d);
}
const smax = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; };
const smin = (a, b, k) => -smax(-a, -b, k);
const seg2 = (px, pz, ax, az, bx, bz) => { const pax = px - ax, paz = pz - az, bax = bx - ax, baz = bz - az; const h = min(max((pax * bax + paz * baz) / max(bax * bax + baz * baz, 1e-4), 0), 1); return hypot(pax - bax * h, paz - baz * h); };
const seg3 = (px, py, pz, ax, ay, az, bx, by, bz) => { const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az; const h = min(max((pax * bax + pay * bay + paz * baz) / max(bax * bax + bay * bay + baz * baz, 1e-4), 0), 1); return hypot(pax - bax * h, pay - bay * h, paz - baz * h); };

// P: Float32Array from primBuffer(), counts c = [mesas, arches, holes, clears]
export function makeDens(P, c) {
  return (px, py, pz) => {
    const wx = fbm(px * 0.04 + 11, py * 0.04 + 11, pz * 0.04 + 11, 3) - 0.5, wy = fbm(px * 0.04 + 47, py * 0.04 + 47, pz * 0.04 + 47, 3) - 0.5, wz = fbm(px * 0.04 + 83, py * 0.04 + 83, pz * 0.04 + 83, 3) - 0.5;
    const qx = px + wx * 15, qz = pz + wz * 15;
    const g0 = -45.5 + 7 * (fbm(qx * 0.011, qz * 0.011, 3, 4) - 0.5) + 1.6 * (fbm(qx * 0.07, qz * 0.07, 9, 3) - 0.5);
    const tn = 3 * (fbm(qx * 0.09, qz * 0.09, 2, 3) - 0.5);
    let dm = -1e3, de = 1e3, k = 0;
    for (let i = 0; i < c[0]; i++, k += 8) {
      const yr = min(max((py - g0) / (P[k + 5] - g0), 0), 1.3);
      let e = seg2(qx, qz, P[k], P[k + 1], P[k + 2], P[k + 3]) - P[k + 4];
      e -= P[k + 6] * ss(0.3, 0.92, yr) + 3 * (1 - yr) * (1 - yr) - P[k + 7] * ss(0, 0.5, yr) * (1 - ss(0.5, 1, yr));
      dm = smax(dm, smin(-e, P[k + 5] + tn - py, 3), 2.5);
      de = min(de, e);
    }
    let clr = 0;
    const kc = (c[0] + c[1] + c[2]) * 8;
    for (let i = 0; i < c[3]; i++) { const o = kc + i * 8; clr = max(clr, 1 - ss(0, P[o + 5], seg2(qx, qz, P[o], P[o + 1], P[o + 2], P[o + 3]) - P[o + 4])); }
    const rad = hypot(px, pz) + wx * 14;
    const n = fbm(qx * 0.0125, qz * 0.0125, 1.7, 4);
    const ring = ss(156, 172, rad);
    const plat = max(ss(0.5, 0.565, n) * (1 - clr), ring);
    const th = g0 + plat * mix(26 + 17 * fbm(qx * 0.03, qz * 0.03, 5, 2), 60, ring);
    let d = smax(g0 + 4.5 * ss(10, 0, de) - py, dm, 3);
    d = smax(d, (th - py) * 0.7, 3);
    for (let i = 0; i < c[1]; i++, k += 8) {
      let rx = px + wx * 3 - P[k], ry = py + wy * 3 - P[k + 1], rz = pz + wz * 3 - P[k + 2];
      const cs = cos(P[k + 3]), sn = sin(P[k + 3]);
      const nx = cs * rx + sn * rz, ny = ry / P[k + 6], nz = -sn * rx + cs * rz;
      d = smax(d, P[k + 5] - hypot(hypot(nx, ny) - P[k + 4], nz), 1.5);
    }
    const hg = py - g0, rk = mix(0.25, 1, ss(0.5, 5, hg));
    d += rk * ((0.5 - wor(px * 0.17 + wx * 2, py * 0.17 + wy * 2, pz * 0.17 + wz * 2)) * 3.4 + (0.5 - wor(px * 0.41 + 7, py * 0.41 + 7, pz * 0.41 + 7)) * 1.3 + (fbm(px * 0.3, py * 0.3, pz * 0.3, 3) - 0.5) * 2.2);
    d += rk * 2.2 * (abs(fract(py * 0.21 + wy * 2.2) - 0.5) - 0.25);
    for (let i = 0; i < c[2]; i++, k += 8) d = smin(d, seg3(px + wx * 2, py + wy * 2, pz + wz * 2, P[k], P[k + 1], P[k + 2], P[k + 4], P[k + 5], P[k + 6]) - P[k + 3], 2);
    return min(d, 3 - py);
  };
}

// fills D (x fastest, then y, then z) for z in [z0, z1)
function slab(D, g, P, c, z0, z1) {
  const dens = makeDens(P, c), [nx, ny, nz, ox, oy, oz, vs] = g;
  for (let z = z0; z < z1; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let d = dens(ox + x * vs, oy + y * vs, oz + z * vs);
    if (x === 0 || z === 0 || x === nx - 1 || z === nz - 1 || y === ny - 1) d = -1;
    D[x + nx * (y + ny * z)] = d;
  }
}

if (!isMainThread && workerData?.kind === 'density') {
  const { sab, g, P, c, z0, z1 } = workerData;
  slab(new Float32Array(sab), g, P, c, z0, z1);
  parentPort.postMessage(1);
}

// g = [nx, ny, nz, ox, oy, oz, vs]
export async function densityGrid(g, P, c, threads = os.cpus().length, onProgress) {
  const [nx, ny, nz] = g, sab = new SharedArrayBuffer(nx * ny * nz * 4);
  const parts = threads * 4; let next = 0, done = 0;
  await new Promise((resolve, reject) => {
    const run = () => {
      if (next >= parts) return;
      const z0 = Math.floor(next * nz / parts), z1 = Math.floor((next + 1) * nz / parts); next++;
      const w = new Worker(new URL(import.meta.url), { workerData: { kind: 'density', sab, g, P, c, z0, z1 } });
      w.once('message', () => { done++; onProgress?.(done / parts); w.terminate(); if (done === parts) resolve(); else run(); });
      w.once('error', reject);
    };
    for (let i = 0; i < threads; i++) run();
  });
  return new Float32Array(sab);
}
