// Procedural plants: the placement records from world.js (worldgen.mjs, RECORD) packed for the shaders, and a JS
// reference of how the shaders grow each leaf and glint from them (AbyssGrow.cginc must do exactly what this does).
//
// The web version draws every leaf with a sequential random stream; here each leaf has its own hash-seeded stream, so
// a leaf is grown on its own in a vertex shader. Same rules and distributions, same places; not the same individual
// leaves.
//
// Data (all small):
//   groups  RGBA32F, 4 texels (16 floats) per group: kelp columns, clusters, fronds, tufts
//           [x y z kind | 9 shape parameters | leaf start, stem count, glint start] (see packPlants)
//   leafGroup / glintGroup  R16, one per leaf / glint: which group it belongs to (leaves are ordered by cell, group)
//   dots    RGBAHalf, 1 texel per ground-cover spot: (x - cell centre x, y + 30, z - cell centre z, w)
//           w = 10 * leaf count + yaw for a carpet tuft, -5 / -7 for a ground-cover spot of type 5 / 7
const { sin, cos, pow, floor, ceil, PI } = Math;
const TAU = PI * 2;
export const DOT_SLOTS = 6;           // leaves per ground-cover spot (a carpet tuft: 2-4 + 2 optional)
export const KIND = { column: 0, cluster: 1, frond: 2, tuft: 3 };

// ---------------------------------------------------------------- hash random numbers (identical in HLSL)
export function hash(x) {
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0; x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0; return (x ^ (x >>> 16)) >>> 0;
}
export class Rng {
  constructor(seed) { this.s = hash(seed >>> 0); }
  next() { this.s = hash((this.s + 0x9e3779b9) >>> 0); return (this.s >>> 8) * (1 / 16777216); }
  rr(a, b) { return a + (b - a) * this.next(); }
}
export const SALT = { leaf: 0x1b873593, dot: 0x68e31da4, glint: 0x2c1b3c6d };

// ---------------------------------------------------------------- packing
const cellOf = (W, x, z) => Math.min(W.CELLS - 1, Math.max(0, floor((x - W.OX) / W.CELLW))) + W.CELLS * Math.min(W.CELLS - 1, Math.max(0, floor((z - W.OZ) / W.CELLW)));
export const cellCenter = (W, c) => [W.OX + (c % W.CELLS + 0.5) * W.CELLW, W.OZ + (floor(c / W.CELLS) + 0.5) * W.CELLW];

// leaves and glints a group grows
export function groupCounts(kind, r) {
  if (kind === KIND.column) {
    const [, , , H, k, strands, , , , , , , full] = r, stemsPer = ceil((H - 1) / 1.7);
    return { stems: strands * stemsPer, leaves: strands * stemsPer + floor(H * 30 * full), glints: floor(H * (k === 1 ? 16 : 13)) };
  }
  return { stems: 0, leaves: r[3], glints: 0 };
}

export function packPlants(W, REC) {
  const nC = W.CELLS * W.CELLS;
  // groups, sorted by cell
  const groups = [];
  for (const [name, kind] of Object.entries(KIND)) for (const r of REC[name]) groups.push({ kind, r, cell: cellOf(W, r[0], r[2]), ...groupCounts(kind, r) });
  groups.sort((a, b) => a.cell - b.cell);
  if (groups.length > 65535) throw new Error('too many plant groups for 16-bit indices');
  const G = new Float32Array(groups.length * 16), leafStart = new Uint32Array(nC + 1), glintStart = new Uint32Array(nC + 1);
  let nl = 0, ng = 0;
  const leafGroup = [], glintGroup = [];
  groups.forEach((g, i) => {
    const r = g.r, o = i * 16;
    G.set([r[0], r[1], r[2], g.kind], o);
    if (g.kind === KIND.column) G.set([r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11]], o + 4);  // H kind strands ph | tw sr sc la | lm
    else if (g.kind === KIND.cluster) G.set([r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]], o + 4);           // n type lmin lmax | wmin wmax tmax sway
    else if (g.kind === KIND.frond) G.set([r[3], r[4]], o + 4);                                                     // n zp
    else G.set([r[3], r[4], r[5]], o + 4);                                                                          // n zp yaw
    G[o + 13] = nl; G[o + 14] = g.stems; G[o + 15] = ng;
    for (let k = 0; k < g.leaves; k++) leafGroup.push(i);
    for (let k = 0; k < g.glints; k++) glintGroup.push(i);
    nl += g.leaves; ng += g.glints;
    leafStart[g.cell + 1] = nl; glintStart[g.cell + 1] = ng;
  });
  for (let c = 0; c < nC; c++) { leafStart[c + 1] = Math.max(leafStart[c + 1], leafStart[c]); glintStart[c + 1] = Math.max(glintStart[c + 1], glintStart[c]); }
  // ground-cover spots, sorted by cell
  const dots = [];
  for (const r of REC.carpet) dots.push([r[0], r[1], r[2], 10 * r[3] + ((r[4] % TAU) + TAU) % TAU]);
  for (const r of REC.spot) dots.push([r[0], r[1], r[2], -r[3]]);
  dots.forEach((d) => { d.cell = cellOf(W, d[0], d[2]); });
  dots.sort((a, b) => a.cell - b.cell);
  const dotStart = new Uint32Array(nC + 1), Dt = new Float32Array(dots.length * 4);
  dots.forEach((d, i) => { const [cx, cz] = cellCenter(W, d.cell); Dt.set([d[0] - cx, d[1] + 30, d[2] - cz, d[3]], i * 4); dotStart[d.cell + 1] = i + 1; });
  for (let c = 0; c < nC; c++) dotStart[c + 1] = Math.max(dotStart[c + 1], dotStart[c]);
  return { groups: G, nGroups: groups.length, leafGroup: Uint16Array.from(leafGroup), glintGroup: Uint16Array.from(glintGroup), leafStart, glintStart, dots: Dt, dotCells: Uint16Array.from(dots, (d) => d.cell), dotStart, nLeaves: nl, nGlints: ng, nDots: dots.length };
}

// float32 -> float16 bits (round to nearest even), for the dots texture
export function toHalf(f) {
  const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f); const x = b.getUint32(0);
  const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return s; m |= 0x800000; const sh = 14 - e; let h = m >>> sh; if ((m >>> (sh - 1)) & 1) h++; return s | h; }
  if (e >= 31) return s | 0x7c00;
  let h = s | (e << 10) | (m >>> 13); if ((m >>> 12) & 1 && ((m & 0x1fff) !== 0x1000 || h & 1)) h++; return h;
}
export function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? s * Infinity : s * (1 + m / 1024) * 2 ** (e - 15);
}

// ---------------------------------------------------------------- the reference grower (mirror of AbyssGrow.cginc)
// a leaf: [x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend], or null when the slot grows nothing
// group: 16 floats (see packPlants), k: leaf number within the group, gi: group index
export function growGroupLeaf(gr, gi, k) {
  const R = new Rng(((gi << 16) | k) ^ SALT.leaf);
  const x = gr[0], y = gr[1], z = gr[2], kind = gr[3];
  if (kind === KIND.column) {
    const H = gr[4], ck = gr[5], strands = gr[6], ph = gr[7], tw = gr[8], sr = gr[9], sc = gr[10], la = gr[11], lm = gr[12], stems = gr[14];
    const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a]; };
    if (k < stems) { // the stems: strands of 2.1 m segments every 1.7 m
      const per = stems / strands, s = floor(k / per), h = (k - s * per) * 1.7, p = stem(s, h);
      return [p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, 1, R.next(), R.next(), 0.3];
    }
    const t = pow(R.next(), 0.9), h = t * H, p = stem(floor(R.next() * strands), h);
    const L = ((0.55 + 0.75 * R.next() * R.next()) * (1 - 0.5 * t * t) * sc + 0.25) * (ck === 1 ? 1.25 : 1.15);
    const tilt = R.rr(0.4, 1.0) * (1 - t) + R.rr(0.15, 0.45) * t;
    const u = R.next(), type = ck === 1 ? (u < 0.8 ? 3 : 4) : ck === 2 ? (u < 0.5 ? 4 : 0) : 0;
    const yaw = R.next() * TAU, wid = L * (ck === 1 ? R.rr(0.09, 0.13) : R.rr(0.15, 0.21)) + 0.03;
    return [p[0], y + h, p[1], L, yaw, tilt, wid, h, type, R.next(), R.next(), R.rr(0.38, 0.95)];
  }
  if (kind === KIND.cluster) {
    const a = R.next() * TAU, r = R.next() * 0.5, L = R.rr(gr[6], gr[7]);
    return [x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, R.rr(0.05, gr[10]), R.rr(gr[8], gr[9]), gr[11], gr[5], R.next(), R.next(), R.rr(0.3, 0.8)];
  }
  if (kind === KIND.frond) {
    const dx = R.rr(-0.6, 0.6), dz = R.rr(-0.6, 0.6), L = R.rr(0.8, 3.2), yaw = R.next() * TAU, tilt = PI - R.rr(0, 0.4), wid = R.rr(0.08, 0.18);
    const type = gr[5] > 0.3 || R.next() < 0.5 ? 6 : 0;
    return [x + dx, y + 0.2, z + dz, L, yaw, tilt, wid, 0, type, R.next(), R.next(), R.rr(0.3, 0.6)];
  }
  const L = R.rr(0.5, 1.4), yaw = gr[6] + R.rr(-0.9, 0.9), tilt = R.rr(0.3, 1.1), wid = R.rr(0.06, 0.12);
  const type = gr[5] > 0.4 && R.next() < 0.6 ? 3 : 0;
  return [x, y, z, L, yaw, tilt, wid, 0.5, type, R.next(), R.next(), R.rr(0.2, 0.6)];
}
// ground cover: slot j (0..DOT_SLOTS-1) of spot d = (x, y, z, w) in world space
export function growDotLeaf(d, di, j) {
  const R = new Rng(((di * 8 + j) >>> 0) ^ SALT.dot);
  const [x, y, z, w] = d;
  if (w < 0) { // ground-cover spot: 4 leaves of type 5 or 3 of type 7
    if (w > -6) return j < 4 ? [x + R.rr(-0.1, 0.1), y - 0.05, z + R.rr(-0.1, 0.1), R.rr(0.12, 0.34), R.next() * TAU, R.rr(0.05, 0.75), R.rr(0.04, 0.08), 0, 5, R.next(), R.next(), R.rr(0.3, 0.7)] : null;
    return j < 3 ? [x + R.rr(-0.1, 0.1), y - 0.05, z + R.rr(-0.1, 0.1), R.rr(0.25, 0.7), R.next() * TAU, R.rr(0.1, 0.8), R.rr(0.05, 0.1), 0, 7, R.next(), R.next(), R.rr(0.3, 0.8)] : null;
  }
  const nl = floor(w / 10), yw = w - nl * 10;
  if (j < nl) return [x, y - 0.03, z, R.rr(0.08, 0.26), yw + j * TAU / nl + R.rr(-0.4, 0.4), R.rr(0.15, 0.85), R.rr(0.035, 0.07), 0, 5, R.next(), R.next(), R.rr(0.3, 0.7)];
  // 30% of the tufts have a pair of taller teal blades (one draw for the pair, as in world.js)
  if (j < 4 || new Rng(((di * 8 + 7) >>> 0) ^ SALT.dot).next() >= 0.3) return null;
  return [x + R.rr(-0.2, 0.2), y - 0.04, z + R.rr(-0.2, 0.2), R.rr(0.2, 0.55), R.next() * TAU, R.rr(0.05, 0.6), R.rr(0.03, 0.06), 0, 7, R.next(), R.next(), R.rr(0.3, 0.8)];
}
// glints: [x, y, z, height, seed, hue, size] or null
export function growGroupGlint(gr, gi, k) {
  const R = new Rng(((gi << 16) | k) ^ SALT.glint);
  const x = gr[0], y = gr[1], z = gr[2], H = gr[4], ck = gr[5], la = gr[11], lm = gr[12];
  const h = R.next() * H, a = R.next() * TAU, r = R.rr(0.15, 0.8) * (1 - 0.5 * h / H), ln = lm * h * h / H;
  return [x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln, h, R.next(), ck === 1 ? R.next() : R.next() * 0.6, R.rr(0.018, 0.05)];
}
export function growDotGlint(d, di) {
  const R = new Rng(((di * 8 + 6) >>> 0) ^ SALT.glint);
  if (d[3] < 0 || R.next() >= 0.3) return null; // carpet tufts only, 30% of them
  return [d[0], d[1] + R.rr(0.08, 0.22), d[2], 0, R.next(), 0.82 + R.next() * 0.18, R.rr(0.01, 0.02)];
}
