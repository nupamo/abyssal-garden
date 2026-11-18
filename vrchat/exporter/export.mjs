// Exports the Abyssal Garden world for the Unity / VRChat port.
//
//   node export.mjs [--level high|medium|low] [--shadow 2048|4096] [--out <dir>]
//
// Writes raw little-endian data plus manifest.json into <dir> (default: ../Assets/AbyssalGarden/Raw~, a folder Unity
// ignores); the editor importer (Abyssal Garden > Import World) turns it into meshes, textures and the scene.
// Also rewrites Shaders/AbyssConfig.cginc for the chosen level.
//
// Coordinates: the web world is right-handed, Unity is left-handed; a Unity position is (x, y, -z) of the web one, which
// keeps the view the same (not mirrored). Terrain meshes are written in Unity space; instance data stays in the original
// ("abyss") space and the shaders flip z at the end. Flipping z reverses triangle winding, so every mesh here has its
// winding reversed to stay front-facing.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './worldgen.mjs';
import { detailTexture } from './detail.mjs';
import { ShadowRaster, sunFrame } from './shadow.mjs';
import { bakeSDF, NEAR as SDF_NEAR, FAR as SDF_FAR } from './sdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LV = { high: 0, medium: 1, low: 2 }[arg('--level', 'medium')];
if (LV === undefined) throw new Error('--level must be high, medium or low');
const SHADOW = +arg('--shadow', LV ? 2048 : 4096);
const PKG = path.join(here, '..', 'Assets', 'AbyssalGarden');
const OUT = path.resolve(arg('--out', path.join(PKG, 'Raw~')));
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(m);
const t0 = Date.now();

const { W, D, T, Wd, poses, meshes } = await generate(LV, log);
const files = {};
const save = (name, data) => { writeFileSync(path.join(OUT, name), Buffer.from(data.buffer, data.byteOffset, data.byteLength)); files[name] = data.byteLength; };

// ---------------------------------------------------------------- textures
log('detail texture…');
save('tex_detail.bin', await detailTexture());
save('tex_volume.bin', Wd.volD);   // RG8, 256 x 40 x 256 (r openness, g skylight)
save('tex_ground.bin', Wd.gm);     // RGBA8, 512 x 512 (r magenta cover, b purple zone, a sand)
{ // terrain distance field for the raymarcher
  const t = Date.now(), s = bakeSDF(D, W.NX, W.NY, W.NZ, W.VS);
  save('tex_sdf.bin', s.near); save('tex_sdf_far.bin', s.far);
  log(`terrain SDF: ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- terrain: one mesh per culling cell, Unity space
{
  const vf = new Float32Array(T.vb), v8 = new Int8Array(T.vb), nC = W.CELLS * W.CELLS, parts = [], cells = [];
  const remap = new Int32Array(T.nv).fill(-1);
  for (let c = 0; c < nC; c++) {
    const a = T.start[c] * 6, b = T.start[c + 1] * 6;
    if (a === b) continue;
    const used = [];
    for (let i = a; i < b; i++) { const v = T.ib[i]; if (remap[v] < 0) { remap[v] = used.length; used.push(v); } }
    const nv = used.length, ni = b - a, buf = new ArrayBuffer(8 + nv * 24 + ni * 4), h = new Uint32Array(buf, 0, 2);
    h[0] = nv; h[1] = ni;
    const P = new Float32Array(buf, 8, nv * 3), N = new Float32Array(buf, 8 + nv * 12, nv * 3), I = new Uint32Array(buf, 8 + nv * 24, ni);
    used.forEach((v, k) => {
      P[k * 3] = vf[v * 4]; P[k * 3 + 1] = vf[v * 4 + 1]; P[k * 3 + 2] = -vf[v * 4 + 2];
      N[k * 3] = v8[v * 16 + 12] / 127; N[k * 3 + 1] = v8[v * 16 + 13] / 127; N[k * 3 + 2] = -v8[v * 16 + 14] / 127;
    });
    for (let i = a; i < b; i += 3) { I[i - a] = remap[T.ib[i]]; I[i - a + 1] = remap[T.ib[i + 2]]; I[i - a + 2] = remap[T.ib[i + 1]]; }
    for (const v of used) remap[v] = -1;
    cells.push({ cell: c, ...cellCenter(c), ymin: T.lo[c], ymax: T.hi[c], vertices: nv, triangles: ni / 3 });
    parts.push(new Uint8Array(buf));
  }
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  save('terrain.bin', all);
  var terrain = { file: 'terrain.bin', cells };
  log(`terrain: ${cells.length} cell meshes`);
}
function cellCenter(c) { const x = c % W.CELLS, z = (c / W.CELLS) | 0; return { cx: W.OX + (x + 0.5) * W.CELLW, cz: W.OZ + (z + 0.5) * W.CELLW }; }

// ---------------------------------------------------------------- template meshes
// layout: u32 nv, u32 ni, f32x3 pos[nv], f32x3 normal[nv], f32x4 uv[nv], u32 index[ni]
// uv = (aux, slot, u, v): aux = the web vertex format's 4th normal byte, slot = which instance the vertex belongs to
const templates = {};
function writeTemplate(name, nv, ni, fill) {
  if (templates[name]) return name;
  const buf = new ArrayBuffer(8 + nv * 40 + ni * 4), h = new Uint32Array(buf, 0, 2); h[0] = nv; h[1] = ni;
  const P = new Float32Array(buf, 8, nv * 3), N = new Float32Array(buf, 8 + nv * 12, nv * 3), U = new Float32Array(buf, 8 + nv * 24, nv * 4), I = new Uint32Array(buf, 8 + nv * 40, ni);
  fill(P, N, U, I);
  save(name + '.bin', new Uint8Array(buf));
  templates[name] = { file: name + '.bin', vertices: nv, indices: ni };
  return name;
}
// K copies of mesh m (index into meshes)
function solidTemplate(mi, K) {
  const m = meshes[mi], nv = m.nv, ni = m.ib.length, f = new Float32Array(m.vb), s = new Int8Array(m.vb);
  return writeTemplate(`mesh_solid${mi}_x${K}`, nv * K, ni * K, (P, N, U, I) => {
    for (let k = 0; k < K; k++) {
      for (let v = 0; v < nv; v++) {
        const o = k * nv + v;
        P[o * 3] = f[v * 4]; P[o * 3 + 1] = f[v * 4 + 1]; P[o * 3 + 2] = f[v * 4 + 2];
        let nx = s[v * 16 + 12], ny = s[v * 16 + 13], nz = s[v * 16 + 14]; const l = Math.hypot(nx, ny, nz) || 1;
        N[o * 3] = nx / l; N[o * 3 + 1] = ny / l; N[o * 3 + 2] = nz / l;
        U[o * 4] = s[v * 16 + 15] / 127; U[o * 4 + 1] = k;
      }
      for (let t = 0; t < ni; t += 3) { const o = k * ni + t, b = k * nv; I[o] = m.ib[t] + b; I[o + 1] = m.ib[t + 2] + b; I[o + 2] = m.ib[t + 1] + b; }
    }
  });
}
// K leaf blades of ROWS rows (the web version's triangle strip, as a list)
function leafTemplate(rows, K) {
  const vpl = rows * 2, tpl = (rows - 1) * 2;
  return writeTemplate(`mesh_leaf${rows}_x${K}`, vpl * K, tpl * 3 * K, (P, N, U, I) => {
    let o = 0;
    for (let k = 0; k < K; k++) {
      for (let r = 0; r < rows; r++) for (let side = 0; side < 2; side++) { const v = k * vpl + r * 2 + side; U[v * 4 + 1] = k; U[v * 4 + 2] = side * 2 - 1; U[v * 4 + 3] = r / (rows - 1); N[v * 3 + 1] = 1; }
      for (let r = 0; r < rows - 1; r++) {
        const a = k * vpl + r * 2, b = a + 1, c = a + 2, d = a + 3;
        I[o++] = a; I[o++] = c; I[o++] = b; I[o++] = c; I[o++] = d; I[o++] = b;
      }
    }
  });
}
// K camera-facing quads
function quadTemplate(K) {
  return writeTemplate(`mesh_quad_x${K}`, 4 * K, 6 * K, (P, N, U, I) => {
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < 4; i++) { const v = k * 4 + i; U[v * 4 + 1] = k; U[v * 4 + 2] = (i & 1) * 2 - 1; U[v * 4 + 3] = (i >> 1) * 2 - 1; N[v * 3 + 1] = 1; }
      const a = k * 4; I.set([a, a + 2, a + 1, a + 2, a + 3, a + 1], k * 6);
    }
  });
}
// the largest instance count per draw, so a template stays near 64k vertices
const kFor = (vpi, most) => Math.max(1, Math.min(most, Math.floor(65000 / vpi)));

// ---------------------------------------------------------------- instance textures (RGBA32F, 4096 texels per row)
const TW = 4096, textures = {};
function instTexture(name, n, N, fill) {
  const rows = Math.max(1, Math.ceil(n * N / TW)), data = new Float32Array(TW * rows * 4);
  fill(data);
  save(name + '.bin', data);
  textures[name] = { file: name + '.bin', width: TW, height: rows, texelsPerInstance: N, instances: n };
  return name;
}
const sets = []; // a set = one material + one template mesh, drawn as `draws` (instance ranges, per cell or whole-world)
// renderers for a cell-sorted range table: per cell, draws of at most K instances
function celledDraws(start, K) {
  const r = [];
  for (let c = 0; c < W.CELLS * W.CELLS; c++) for (let a = start[c]; a < start[c + 1]; a += K) r.push({ cell: c, ...cellCenter(c), base: a, count: Math.min(K, start[c + 1] - a) });
  return r;
}
const maxRun = (start) => { let m = 1; for (let c = 0; c < start.length - 1; c++) m = Math.max(m, start[c + 1] - start[c]); return m; };

// leaves: t0 = (x, y, z, len), t1 = (yaw, tilt*1000 + 4096*bend8, wid*2000 + 4096*hA*50, type + 8*s1_8 + 2048*s2_8), all integers exact in f32
function leafTexture(name, L) {
  const f = new Float32Array(L.buf), u8 = new Uint8Array(L.buf);
  return instTexture(name, L.n, 2, (d) => {
    for (let i = 0; i < L.n; i++) {
      const o = i * 8, s = i * 9, b = i * 36;
      d[o] = f[s]; d[o + 1] = f[s + 1]; d[o + 2] = f[s + 2]; d[o + 3] = f[s + 3];
      d[o + 4] = f[s + 4];
      d[o + 5] = Math.min(4095, Math.round(f[s + 5] * 1000)) + 4096 * u8[b + 35];
      d[o + 6] = Math.min(4095, Math.round(f[s + 6] * 2000)) + 4096 * Math.min(4095, Math.round(f[s + 7] * 50));
      d[o + 7] = u8[b + 32] + 8 * u8[b + 33] + 2048 * u8[b + 34];
    }
  });
}
const tBig = leafTexture('inst_leaves_big', Wd.big), tBigF = leafTexture('inst_leaves_far', Wd.bigF), tSmall = leafTexture('inst_leaves_small', Wd.small);
for (const [name, tex, L, rows, minD, maxD, far] of [['leaves_near', tBig, Wd.big, 9, 0, 24, 150], ['leaves_mid', tBig, Wd.big, 5, 24, 58, 150], ['leaves_far', tBigF, Wd.bigF, 3, 58, 150, 150], ['leaves_small', tSmall, Wd.small, 3, 0, 70, 70]]) {
  const K = kFor(rows * 2, maxRun(L.start));
  sets.push({ name, shader: 'leaf', texture: tex, template: leafTemplate(rows, K), K, celled: true, minD, maxD, rows, far, scaleWithDetail: true, draws: celledDraws(L.start, K) });
}

// solids: 3 texels (x, y, z, scale), (quaternion), (material, seed, texture scale or fade distance, bob)
{
  const S = Wd.solids;
  const tex = instTexture('inst_solids', S.data.length / 12, 3, (d) => d.set(S.data));
  S.ranges.forEach(([first, n], mi) => {
    if (!n) return;
    const K = kFor(meshes[mi].nv, n);
    const draws = []; for (let a = 0; a < n; a += K) draws.push({ cell: -1, cx: 0, cz: 0, base: first + a, count: Math.min(K, n - a) });
    sets.push({ name: `solid${mi}`, shader: 'solid', texture: tex, template: solidTemplate(mi, K), K, celled: false, minD: 0, maxD: 1e5, mesh: mi, draws });
  });
  // rock chunks + pebbles, then sponges / coral; LOD meshes as in main.js render()
  const cat = (list) => { const n = list.reduce((s, c) => s + c.n, 0), d = new Float32Array(n * 12); let o = 0; const base = []; for (const c of list) { base.push(o / 12); d.set(c.data, o); o += c.data.length; } return { n, d, base }; };
  const ch = cat(Wd.chunks), pr = cat(Wd.props);
  const tCh = instTexture('inst_chunks', ch.n, 3, (d) => d.set(ch.d)), tPr = instTexture('inst_props', pr.n, 3, (d) => d.set(pr.d));
  const addCelled = (name, tex, c, base, mi, minD, maxD) => {
    if (!c.n) return;
    const K = kFor(meshes[mi].nv, maxRun(c.start)), start = Array.from(c.start, (v) => v + base);
    sets.push({ name, shader: 'solid', texture: tex, template: solidTemplate(mi, K), K, celled: true, minD, maxD, mesh: mi, scaleWithDetail: true, draws: celledDraws(start, K) });
  };
  Wd.chunks.forEach((c, i) => {
    const big = i > 2 && i < 6;
    addCelled(`chunks${i}`, tCh, c, ch.base[i], 14 + i, 0, i > 5 ? 30 : big ? 40 : 96);
    if (big) addCelled(`chunks${i}_far`, tCh, c, ch.base[i], 20 + i, 40, 150);
  });
  Wd.props.forEach((c, i) => {
    const lod = i === 3 || i === 4;
    addCelled(`props${i}`, tPr, c, pr.base[i], 4 + i, 0, lod ? 6 : 110);
    if (lod) addCelled(`props${i}_far`, tPr, c, pr.base[i], 18 + i, 6, 110);
  });
}

// glints (sparkles): bucketed into cells here (the web version draws them in one call)
{
  const G = Wd.glints, n = G.length / 8, cellOf = (x, z) => Math.min(W.CELLS - 1, Math.max(0, Math.floor((x - W.OX) / W.CELLW))) + W.CELLS * Math.min(W.CELLS - 1, Math.max(0, Math.floor((z - W.OZ) / W.CELLW)));
  const start = new Uint32Array(W.CELLS * W.CELLS + 1), key = new Uint16Array(n);
  for (let i = 0; i < n; i++) { key[i] = cellOf(G[i * 8], G[i * 8 + 2]); start[key[i] + 1]++; }
  for (let c = 0; c < W.CELLS * W.CELLS; c++) start[c + 1] += start[c];
  const fillAt = start.slice(), sorted = new Float32Array(G.length);
  for (let i = 0; i < n; i++) { const o = fillAt[key[i]]++; sorted.set(G.subarray(i * 8, i * 8 + 8), o * 8); }
  const tex = instTexture('inst_glints', n, 2, (d) => d.set(sorted)), K = kFor(4, maxRun(start));
  sets.push({ name: 'glints', shader: 'glint', texture: tex, template: quadTemplate(K), K, celled: true, minD: 0, maxD: 120, draws: celledDraws(start, K) });
}
// helper meshes for the camera-following objects: a quad (water surface) and a sphere (backdrop, light shafts, post)
const surfaceMesh = quadTemplate(1);
const sphereMesh = (() => {
  const m = W.icosphere(2).build(), f = new Float32Array(m.vb);
  return writeTemplate('mesh_sphere', m.nv, m.ib.length, (P, N, U, I) => {
    for (let v = 0; v < m.nv; v++) for (let j = 0; j < 3; j++) { P[v * 3 + j] = f[v * 4 + j]; N[v * 3 + j] = f[v * 4 + j]; }
    I.set(m.ib);
  });
})();
// whole-world sets
const single = (name, shader, data, N, template, K, n) => {
  const tex = instTexture('inst_' + name, n, N, (d) => d.set(data));
  const draws = []; for (let a = 0; a < n; a += K) draws.push({ cell: -1, cx: 0, cz: 0, base: a, count: Math.min(K, n - a) });
  sets.push({ name, shader, texture: tex, template, K, celled: false, minD: 0, maxD: 1e5, draws });
};
{
  const nB = Wd.bubbles.length / 8, nS = Wd.snow.length / 4, nF = Wd.fish.length / 8, nM = Wd.mantas.length / 8;
  const kB = kFor(4, nB), kS = kFor(4, nS), kF = kFor(meshes[13].nv, nF), kM = kFor(meshes[12].nv, nM);
  single('bubbles', 'bubble', Wd.bubbles, 2, quadTemplate(kB), kB, nB);
  single('snow', 'snow', Wd.snow, 1, quadTemplate(kS), kS, nS);
  single('fish', 'fish', Wd.fish, 2, solidTemplate(13, kF), kF, nF);
  single('mantas', 'manta', Wd.mantas, 2, solidTemplate(12, kM), kM, nM);
}

// ---------------------------------------------------------------- shadow map bake
{
  log(`shadow map ${SHADOW}x${SHADOW}…`);
  const t = Date.now(), R = new ShadowRaster(SHADOW), vf = new Float32Array(T.vb), v8 = new Int8Array(T.vb);
  const wn = new Float32Array(T.nv * 3), wp = new Float32Array(T.nv * 3);
  for (let k = 0; k < T.nv; k++) for (let j = 0; j < 3; j++) { wp[k * 3 + j] = vf[k * 4 + j]; wn[k * 3 + j] = v8[k * 16 + 12 + j] / 127; }
  R.terrain(wp, wn, T.ib);
  Wd.solids.ranges.forEach(([first, n], mi) => { if (n) R.solids(meshes[mi], Wd.solids.data, first, n); });
  // small rocks, sponges and corals only on High, as in the web version
  if (!LV) {
    Wd.chunks.forEach((c, i) => R.solids(meshes[14 + i], c.data, 0, c.n));
    Wd.props.forEach((c, i) => R.solids(meshes[4 + i], c.data, 0, c.n));
  }
  R.leaves(Wd.big.buf, Wd.big.n);
  save('tex_shadow.bin', R.r16());
  log(`  ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- manifest + shader config
const { L, M } = sunFrame();
const toUnity = (p) => [p[0], p[1], -p[2]];
const manifest = {
  generator: 'abyssal-garden/vrchat/exporter', level: ['high', 'medium', 'low'][LV], created: new Date().toISOString(),
  world: { OX: W.OX, OY: W.OY, OZ: W.OZ, VS: W.VS, NX: W.NX, NY: W.NY, NZ: W.NZ, cells: W.CELLS, cellSize: W.CELLW },
  // arrays of flat records throughout, so Unity's JsonUtility can read it
  textures: [
    { name: 'detail', file: 'tex_detail.bin', width: 1024, height: 1024, depth: 1, format: 'RGBA32' },
    { name: 'volume', file: 'tex_volume.bin', width: W.NX / 2, height: W.NY / 2, depth: W.NZ / 2, format: 'RG16' },
    { name: 'ground', file: 'tex_ground.bin', width: 512, height: 512, depth: 1, format: 'RGBA32' },
    { name: 'shadow', file: 'tex_shadow.bin', width: SHADOW, height: SHADOW, depth: 1, format: 'R16' },
    { name: 'sdf', file: 'tex_sdf.bin', width: W.NX, height: W.NY, depth: W.NZ, format: 'R8' },
    { name: 'sdfFar', file: 'tex_sdf_far.bin', width: W.NX / 4, height: W.NY / 4, depth: W.NZ / 4, format: 'R8' },
    ...Object.entries(textures).map(([name, v]) => ({ name, ...v, depth: 1, format: 'RGBAFloat' })),
  ],
  terrain, templates: Object.entries(templates).map(([name, v]) => ({ name, ...v })), sets,
  // viewpoints 1-6 in Unity space: position on the sea floor + 1.3 m, and the point it looks at
  viewpoints: poses.map((p) => ({ position: toUnity(p.slice(0, 3)), lookAt: toUnity(p.slice(3, 6)) })),
  surfaceMesh, sphereMesh, waterSize: LV > 1 ? 256 : 512,
  sun: L, shadowMatrix: M.flat(),
};
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
const f = (v) => v.toPrecision(9).replace(/\.?0+$/, '') || '0';
const cfg = `// Generated by vrchat/exporter/export.mjs (level ${manifest.level}). Do not edit: run the exporter again.
#ifndef ABYSS_CONFIG_INCLUDED
#define ABYSS_CONFIG_INCLUDED
#define ABYSS_LOW ${LV > 1 ? 1 : 0}
#define ABYSS_SHADOW_SIZE ${SHADOW}.0
#define ABYSS_RAYN ${LV > 1 ? 12 : 24}
#define ABYSS_SDF_NEAR ${SDF_NEAR.toFixed(2)}
#define ABYSS_SDF_FAR ${SDF_FAR.toFixed(2)}
static const float3 ABYSS_SUN = float3(${L.map(f).join(', ')});
// world (abyss space) -> shadow clip space, rows
static const float4 ABYSS_SM0 = float4(${M[0].map(f).join(', ')});
static const float4 ABYSS_SM1 = float4(${M[1].map(f).join(', ')});
static const float4 ABYSS_SM2 = float4(${M[2].map(f).join(', ')});
#endif
`;
mkdirSync(path.join(PKG, 'Shaders'), { recursive: true });
writeFileSync(path.join(PKG, 'Shaders', 'AbyssConfig.cginc'), cfg);
const total = Object.values(files).reduce((s, v) => s + v, 0);
log(`wrote ${Object.keys(files).length} files, ${(total / 1048576).toFixed(0)} MB, to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
log(`sets: ${sets.length}, renderers: ${sets.reduce((s, x) => s + x.draws.length, 0)}`);
