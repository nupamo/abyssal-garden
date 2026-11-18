// Grows every leaf and glint with the reference grower (grow.mjs) and compares them with the web version's own leaves:
// counts and mean shape per leaf type, and the shadow the kelp casts (rasterized like the baked shadow map).
// Development check only: node verify-grow.mjs [out dir]   (writes grow-shadow-original.png / grow-shadow-grown.png)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { generate } from './worldgen.mjs';
import { packPlants, growGroupLeaf, growDotLeaf, growGroupGlint, growDotGlint, cellCenter, DOT_SLOTS } from './grow.mjs';
import { ShadowRaster } from './shadow.mjs';

const OUTD = process.argv[2] ?? '.';
const { W, Wd } = await generate(0, () => {}, true);
const P = packPlants(W, W.REC);
const grown = { big: [], small: [], glints: 0 };
for (let gi = 0; gi < P.nGroups; gi++) {
  const gr = P.groups.subarray(gi * 16, gi * 16 + 16), n = (gi + 1 < P.nGroups ? P.groups[(gi + 1) * 16 + 13] : P.nLeaves) - gr[13];
  for (let k = 0; k < n; k++) grown.big.push(growGroupLeaf(gr, gi, k));
}
for (let di = 0; di < P.nDots; di++) {
  const [cx, cz] = cellCenter(W, P.dotCells[di]), d = P.dots.subarray(di * 4, di * 4 + 4), dw = [d[0] + cx, d[1] - 30, d[2] + cz, d[3]];
  for (let j = 0; j < DOT_SLOTS; j++) { const l = growDotLeaf(dw, di, j); if (l) grown.small.push(l); }
  if (growDotGlint(dw, di)) grown.glints++;
}
for (let g = 0; g < P.nGlints; g++) grown.glints += growGroupGlint(P.groups.subarray(P.glintGroup[g] * 16), P.glintGroup[g], 0) ? 1 : 0;

// the original leaves, unpacked from world.js's 36-byte records (High, so nothing thinned)
const orig = (L) => { const f = new Float32Array(L.buf), u8 = new Uint8Array(L.buf), a = []; for (let i = 0; i < L.n; i++) a.push([...f.subarray(i * 9, i * 9 + 8), u8[i * 36 + 32]]); return a; };
const ob = orig(Wd.big), os = orig(Wd.small);
const stats = (list) => { const s = {}; for (const l of list) { const t = l[8], e = (s[t] ||= { n: 0, len: 0, wid: 0, tilt: 0, hA: 0 }); e.n++; e.len += l[3]; e.wid += l[6]; e.tilt += l[5]; e.hA += l[7]; } for (const e of Object.values(s)) for (const k of ['len', 'wid', 'tilt', 'hA']) e[k] /= e.n; return s; };
const show = (name, a, b) => {
  console.log(`\n${name}: original ${a.length} leaves, grown ${b.length}`);
  const A = stats(a), B = stats(b);
  console.log('type   count (orig / grown)   mean length    mean width     mean tilt      mean height');
  for (const t of Object.keys({ ...A, ...B }).sort()) { const x = A[t] || {}, y = B[t] || {}; const f = (k) => `${(x[k] ?? 0).toFixed(3)}/${(y[k] ?? 0).toFixed(3)}`.padEnd(15); console.log(`${t.padEnd(6)} ${`${x.n ?? 0} / ${y.n ?? 0}`.padEnd(22)} ${f('len')}${f('wid')}${f('tilt')}${f('hA')}`); }
};
show('kelp, clusters, fronds, tufts', ob, grown.big);
show('ground cover', os, grown.small);
console.log(`\nglints: original ${Wd.glints.length / 8}, grown ${grown.glints}`);

// shadow of the big leaves alone, both ways (the shadow rasterizer reads 36-byte leaf records)
const toBuf = (list) => { const b = new ArrayBuffer(list.length * 36), f = new Float32Array(b), u8 = new Uint8Array(b); list.forEach((l, i) => { f.set(l.slice(0, 8), i * 9); u8[i * 36 + 32] = l[8]; u8[i * 36 + 33] = l[9] * 255; u8[i * 36 + 34] = l[10] * 255; u8[i * 36 + 35] = l[11] * 255; }); return b; };
for (const [name, list] of [['original', ob.map((l, i) => [...l.slice(0, 9), Wd.big.buf && new Uint8Array(Wd.big.buf)[i * 36 + 33] / 255, new Uint8Array(Wd.big.buf)[i * 36 + 34] / 255, new Uint8Array(Wd.big.buf)[i * 36 + 35] / 255])], ['grown', grown.big]]) {
  const R = new ShadowRaster(1024); R.leaves(toBuf(list), list.length);
  const raw = path.join(OUTD, `grow-shadow-${name}.r16`); writeFileSync(raw, R.r16());
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray16le', '-s', '1024x1024', '-i', raw, path.join(OUTD, `grow-shadow-${name}.png`)]);
}
console.log(`\nshadow maps: ${OUTD}/grow-shadow-original.png, grow-shadow-grown.png`);
