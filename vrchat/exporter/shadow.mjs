// Bakes the sun shadow map on the CPU: the web version renders it once at load (main.js, "one-time bakes"); here it is
// rasterized the same way (same matrix, bias and per-pass rules) and stored as 16-bit depth, row 0 = v 0.
const { sin, cos, pow, max, min, abs, hypot, floor, ceil, PI } = Math;

export function sunFrame() {
  const v = [0.27, 1, -0.24], l = hypot(...v), L = v.map((c) => c / l);
  const lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 225, d0 = -175, d1 = 125;
  // rows of the shadow matrix (clip = M * [p, 1])
  const M = [[lr[0] / R, lr[1] / R, lr[2] / R, 0], [lu[0] / R, lu[1] / R, lu[2] / R, 0], [-L[0] / (d1 - d0), -L[1] / (d1 - d0), -L[2] / (d1 - d0), d1 / (d1 - d0)], [0, 0, 0, 1]];
  return { L, M };
}

export class ShadowRaster {
  constructor(S) {
    this.S = S; this.z = new Float32Array(S * S).fill(1);
    const { L, M } = sunFrame(); this.L = L; this.M = M;
    this.tx = new Float64Array(3); this.ty = new Float64Array(3); this.tz = new Float64Array(3);
  }
  // world point -> texel space (X right, Y = row, Z = depth)
  proj(i, x, y, z) {
    const M = this.M, S = this.S;
    this.tx[i] = ((M[0][0] * x + M[0][1] * y + M[0][2] * z) * 0.5 + 0.5) * S;
    this.ty[i] = (0.5 - (M[1][0] * x + M[1][1] * y + M[1][2] * z) * 0.5) * S;
    this.tz[i] = M[2][0] * x + M[2][1] * y + M[2][2] * z + M[2][3];
  }
  tri() {
    const { tx, ty, tz, S, z: Z } = this;
    const x0 = tx[0], y0 = ty[0], x1 = tx[1], y1 = ty[1], x2 = tx[2], y2 = ty[2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (abs(area) < 1e-12) return;
    const minX = max(0, ceil(min(x0, x1, x2) - 0.5)), maxX = min(S - 1, floor(max(x0, x1, x2) - 0.5));
    const minY = max(0, ceil(min(y0, y1, y2) - 0.5)), maxY = min(S - 1, floor(max(y0, y1, y2) - 0.5));
    if (minX > maxX || minY > maxY) return;
    // depth plane z = A X + B Y + C, plus the pipeline's bias (depthBias 2, slope scale 1.5)
    const A = ((tz[1] - tz[0]) * (y2 - y0) - (tz[2] - tz[0]) * (y1 - y0)) / area;
    const B = ((tz[2] - tz[0]) * (x1 - x0) - (tz[1] - tz[0]) * (x2 - x0)) / area;
    const bias = 1.5 * max(abs(A), abs(B)) + 2 * 2 ** -23;
    const C = tz[0] - A * x0 - B * y0 + bias;
    const inv = 1 / area;
    for (let Y = minY; Y <= maxY; Y++) {
      const py = Y + 0.5;
      for (let X = minX; X <= maxX; X++) {
        const px = X + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = A * px + B * py + C, o = X + S * Y;
        if (d < Z[o] && d >= 0) Z[o] = d;
      }
    }
  }
  // terrain: world-space positions/normals, index list; the pipeline culls front faces (seen from the sun)
  terrain(wp, wn, ib) {
    const L = this.L;
    for (let t = 0; t < ib.length; t += 3) {
      let nd = 0;
      for (let j = 0; j < 3; j++) { const k = ib[t + j] * 3; nd += wn[k] * L[0] + wn[k + 1] * L[1] + wn[k + 2] * L[2]; this.proj(j, wp[k], wp[k + 1], wp[k + 2]); }
      if (nd > 0) continue;
      this.tri();
    }
  }
  // instanced solid: mesh {vb (f32x3 pos + snorm8x4), ib}, instance data 12 floats each (x,y,z,sc, q, mat,seed,ts,bob)
  solids(mesh, data, first, count) {
    const f = new Float32Array(mesh.vb), nv = mesh.nv, P = new Float64Array(nv * 3);
    for (let n = first; n < first + count; n++) {
      const o = n * 12, ax = data[o], ay = data[o + 1], az = data[o + 2], sc = data[o + 3], qx = data[o + 4], qy = data[o + 5], qz = data[o + 6], qw = data[o + 7], seed = data[o + 9], bob = data[o + 11];
      const dy = sin(seed * 40) * bob; // the shader's bob term at time 0
      for (let k = 0; k < nv; k++) {
        const vx = f[k * 4] * sc, vy = f[k * 4 + 1] * sc, vz = f[k * 4 + 2] * sc;
        // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
        const cx = qy * vz - qz * vy + qw * vx, cy = qz * vx - qx * vz + qw * vy, cz = qx * vy - qy * vx + qw * vz;
        P[k * 3] = ax + vx + 2 * (qy * cz - qz * cy); P[k * 3 + 1] = ay + vy + 2 * (qz * cx - qx * cz) + dy; P[k * 3 + 2] = az + vz + 2 * (qx * cy - qy * cx);
      }
      const ib = mesh.ib;
      for (let t = 0; t < ib.length; t += 3) {
        for (let j = 0; j < 3; j++) { const k = ib[t + j] * 3; this.proj(j, P[k], P[k + 1], P[k + 2]); }
        this.tri();
      }
    }
  }
  // leaves (36-byte records from world.js pack()), drawn like pLeafSh: 3 rows, shadow-mode widths, time 0
  leaves(buf, n) {
    const f = new Float32Array(buf), u8 = new Uint8Array(buf), ROWS = 3, V = [];
    for (let r = 0; r < ROWS; r++) V.push(sin(r / (ROWS - 1) * 1.5708));
    const px = new Float64Array(ROWS * 2), py = new Float64Array(ROWS * 2), pz = new Float64Array(ROWS * 2);
    for (let i = 0; i < n; i++) {
      const L = leafVerts(f, u8, i, V, px, py, pz);
      if (!L) continue;
      for (let r = 0; r < ROWS - 1; r++) {
        const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
        this.proj(0, px[a], py[a], pz[a]); this.proj(1, px[b], py[b], pz[b]); this.proj(2, px[c], py[c], pz[c]); this.tri();
        this.proj(0, px[c], py[c], pz[c]); this.proj(1, px[b], py[b], pz[b]); this.proj(2, px[d], py[d], pz[d]); this.tri();
      }
    }
  }
  r16() {
    const S = this.S, out = new Uint16Array(S * S);
    for (let i = 0; i < S * S; i++) out[i] = Math.round(min(max(this.z[i], 0), 1) * 65535);
    return out;
  }
}

// per leaf type: shape exponents, wave amount, flutter (W_LEAF's switch)
const SHP = [[0.5, 0.32, 1.9, 1], [0.05, 0.1, 0.3, 0.3], [0.45, 0.35, 2.2, 1], [0.7, 0.6, 2.4, 1], [0.5, 0.4, 1.8, 1], [0.6, 0.6, 1, 2], [0.4, 0.3, 2, 1], [0.6, 0.5, 1, 1]];
function leafVerts(f, u8, i, V, px, py, pz) {
  const ax = f[i * 9], ay = f[i * 9 + 1], az = f[i * 9 + 2], len = f[i * 9 + 3], yaw = f[i * 9 + 4], tilt = f[i * 9 + 5], wid = f[i * 9 + 6], hA = f[i * 9 + 7];
  const ty = u8[i * 36 + 32], s1 = u8[i * 36 + 33] / 255, s2 = u8[i * 36 + 34] / 255, bend = u8[i * 36 + 35] / 255;
  if (ty === 1) return false; // stems are zero-width in the shadow pass
  const [shx, shy, wav, fls] = SHP[min(ty, 7)], t = 0;
  const cy = cos(yaw), sy = sin(yaw), ct = cos(tilt), st = sin(tilt);
  const dx = st * cy, dy = ct, dz = st * sy, ex = ct * cy, ey = -st, ez = ct * sy, sdx = -sy, sdz = cy;
  const k = (bend - 0.3) * 2 + sin(t * (0.8 + s1) * fls + s2 * 40 + hA * 0.25) * 0.1 * fls;
  const kq = k * 1.7, ka = abs(kq) < 0.06 ? 0.06 : kq;
  const ph = ax * 0.031 + az * 0.017;
  for (let r = 0; r < V.length; r++) {
    const v = V[r], wph = v * (3 + 5 * s2) + s1 * 30 + t * 1.1, wv = sin(wph) * 0.12 * wav;
    const sK = sin(ka * v), cK = cos(ka * v), a1 = sK / ka, a2 = (1 - cK) / ka + wv * v;
    const cx = ax + len * (dx * a1 + ex * a2), cyy = ay + len * (dy * a1 + ey * a2), cz = az + len * (dz * a1 + ez * a2);
    const sl = sK + wv + cos(wph) * 0.1 * wav * v * (3 + 5 * s2);
    let nx = ex * cK - dx * sl, ny = ey * cK - dy * sl, nz = ez * cK - dz * sl; const nl = hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const tw = (s1 - 0.5) * 2.4 * v + sin(t * 0.9 + s2 * 20) * 0.25 * v, ctw = cos(tw), stw = sin(tw);
    const Sx = sdx * ctw + nx * stw, Sy = ny * stw, Sz = sdz * ctw + nz * stw;
    const shape = pow(max(sin(PI * pow(v, shx)), 0), shy), w = max(wid * 0.5, 0.09) * shape;
    for (let side = 0; side < 2; side++) {
      const u = side * 2 - 1, o = r * 2 + side;
      let x = cx + Sx * u * w, y = cyy + Sy * u * w, z = cz + Sz * u * w;
      const h = hA + (y - ay), am = 0.024 * pow(max(h, 0), 1.25);
      x += am * (sin(t * 0.5 + ph + h * 0.09) + 0.35 * sin(t * 1.3 + ph * 3 + h * 0.3));
      z += am * (cos(t * 0.37 + ph * 1.3 + h * 0.07) + 0.35 * cos(t * 1.1 + ph * 2 + h * 0.23));
      px[o] = x; py[o] = y; pz[o] = z;
    }
  }
  return true;
}
