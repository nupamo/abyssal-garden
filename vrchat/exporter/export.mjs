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
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './worldgen.mjs';
import { ShadowRaster, sunFrame } from './shadow.mjs';
import { bakeSDF, NEAR as SDF_NEAR, FAR as SDF_FAR } from './sdf.mjs';
import { packPlants, toHalf, DOT_SLOTS } from './grow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LV = { high: 0, medium: 1, low: 2 }[arg('--level', 'medium')];
if (LV === undefined) throw new Error('--level must be high, medium or low');
const SHADOW = +arg('--shadow', LV ? 2048 : 4096);
const PKG = path.join(here, '..', 'Assets', 'AbyssalGarden');
const OUT = path.resolve(arg('--out', path.join(PKG, 'Raw~')));
mkdirSync(OUT, { recursive: true });
// what an earlier export left (other levels write other file sets)
for (const f of readdirSync(OUT)) if (/\.(bin|json)$/.test(f)) rmSync(path.join(OUT, f));
const log = (m) => console.log(m);
const t0 = Date.now();

// the world is always generated at High: the level only sets the default thinning, shadow map size and shaft steps
const { W, D, T, Wd, poses, meshes } = await generate(0, log, true);
const files = {};
const save = (name, data) => { writeFileSync(path.join(OUT, name), Buffer.from(data.buffer, data.byteOffset, data.byteLength)); files[name] = data.byteLength; };

// ---------------------------------------------------------------- textures
// (the rock detail texture is made in Unity when the world loads: AbyssDetail.shader)
save('tex_volume.bin', Wd.volD);   // RG8, 256 x 40 x 256 (r openness, g skylight)
save('tex_ground.bin', Wd.gm);     // RGBA8, 512 x 512 (r magenta cover, b purple zone, a sand)
{ // terrain distance field for the raymarcher
  const t = Date.now(), s = bakeSDF(D, W.NX, W.NY, W.NZ, W.VS);
  save('tex_sdf.bin', s.near); save('tex_sdf_far.bin', s.far);
  log(`terrain SDF: ${((Date.now() - t) / 1000).toFixed(1)} s`);
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
// the same with half floats (RGBAHalf), and 16-bit integer textures (R16, read back as value / 65535)
function halfTexture(name, n, N, fill) {
  const rows = Math.max(1, Math.ceil(n * N / TW)), f = new Float32Array(TW * rows * 4);
  fill(f);
  save(name + '.bin', Uint16Array.from(f, toHalf));
  textures[name] = { file: name + '.bin', width: TW, height: rows, texelsPerInstance: N, instances: n, format: 'RGBAHalf' };
  return name;
}
function r16Texture(name, data) {
  const rows = Math.max(1, Math.ceil(data.length / TW)), u = new Uint16Array(TW * rows); u.set(data);
  save(name + '.bin', u);
  textures[name] = { file: name + '.bin', width: TW, height: rows, texelsPerInstance: 1, instances: data.length, format: 'R16' };
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

// ---------------------------------------------------------------- plants, grown by the shaders (grow.mjs, AbyssGrow.cginc)
const THIN = 1 << LV; // Medium / Low draw every 2nd / 4th leaf (wider), as the web version does
const plants = packPlants(W, W.REC);
const tGroups = instTexture('plant_groups', plants.nGroups, 4, (d) => d.set(plants.groups));
const tLeafGroup = r16Texture('plant_leaf_group', plants.leafGroup), tGlintGroup = r16Texture('plant_glint_group', plants.glintGroup);
const tDots = halfTexture('plant_dots', plants.nDots, 1, (d) => d.set(plants.dots));
const plantTex = { _AbyssGroups: tGroups, _AbyssLeafGroup: tLeafGroup, _AbyssGlintGroup: tGlintGroup, _AbyssDots: tDots };
const fl = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
// per cell, draws of at most K slots, a slot standing for `stride` items (leaves) or 1/per items (ground-cover spots)
function strideDraws(start, K, stride) {
  const r = [];
  for (let c = 0; c < W.CELLS * W.CELLS; c++) {
    const slots = Math.ceil((start[c + 1] - start[c]) / stride);
    for (let a = 0; a < slots; a += K) r.push({ cell: c, ...cellCenter(c), base: start[c] + a * stride, count: Math.min(K, slots - a) });
  }
  return r;
}
for (const [name, rows, minD, maxD, stride, ws] of [['leaves_near', 9, 0, 24, 1, 1], ['leaves_mid', 5, 24, 58, 1, 1], ['leaves_far', 3, 58, 150, 2, 1.5]]) {
  const K = kFor(rows * 2, Math.ceil(maxRun(plants.leafStart) / stride));
  sets.push({ name, shader: 'leaf', textures: fl(plantTex), template: leafTemplate(rows, K), K, celled: true, minD, maxD, far: 150, floats: fl({ _Mode: 0, _Stride: stride, _WidthScale: ws, _Thin: THIN }), draws: strideDraws(plants.leafStart, K, stride) });
}
{ // ground cover: DOT_SLOTS leaves per spot, the renderer's count is in spots
  const kd = Math.max(1, Math.min(maxRun(plants.dotStart), Math.floor(65000 / (6 * DOT_SLOTS))));
  sets.push({ name: 'leaves_ground', shader: 'leaf', textures: fl(plantTex), template: leafTemplate(3, kd * DOT_SLOTS), K: kd, celled: true, minD: 0, maxD: 70, far: 70, floats: fl({ _Mode: 1, _Stride: 1, _WidthScale: 1, _Thin: THIN }), draws: strideDraws(plants.dotStart, kd, 1) });
}
{ // glints: along the kelp, and on 30% of the carpet tufts
  const kg = kFor(4, maxRun(plants.glintStart)), kd = kFor(4, maxRun(plants.dotStart));
  sets.push({ name: 'glints_kelp', shader: 'glint', textures: fl(plantTex), template: quadTemplate(kg), K: kg, celled: true, minD: 0, maxD: 120, floats: fl({ _Mode: 0 }), draws: strideDraws(plants.glintStart, kg, 1) });
  sets.push({ name: 'glints_ground', shader: 'glint', textures: fl(plantTex), template: quadTemplate(kd), K: kd, celled: true, minD: 0, maxD: 120, floats: fl({ _Mode: 1 }), draws: strideDraws(plants.dotStart, kd, 1) });
}
log(`plants: ${plants.nGroups} groups (${plants.nLeaves} leaves, ${plants.nGlints} glints), ${plants.nDots} ground-cover spots`);

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
  // compact records (half floats, 2 texels): (x - cell centre x, y + 30, z - cell centre z, scale), (quaternion xyz with
  // w >= 0, seed); material, texture scale / fade distance and bob are the same for a whole set (material floats)
  const compact = (name, list) => halfTexture(name, list.n, 2, (d) => {
    for (let i = 0; i < list.n; i++) {
      const a = list.d.subarray(i * 12, i * 12 + 12), cell = Math.min(W.CELLS - 1, Math.max(0, Math.floor((a[0] - W.OX) / W.CELLW))) + W.CELLS * Math.min(W.CELLS - 1, Math.max(0, Math.floor((a[2] - W.OZ) / W.CELLW)));
      const { cx, cz } = cellCenter(cell), sg = a[7] < 0 ? -1 : 1;
      d.set([a[0] - cx, a[1] + 30, a[2] - cz, a[3], a[4] * sg, a[5] * sg, a[6] * sg, a[9]], i * 8);
    }
  });
  const tCh = compact('inst_chunks', ch), tPr = compact('inst_props', pr);
  const addCelled = (name, tex, c, base, mi, minD, maxD, mat, ts) => {
    if (!c.n) return;
    const K = kFor(meshes[mi].nv, maxRun(c.start)), start = Array.from(c.start, (v) => v + base);
    sets.push({ name, shader: 'solid', texture: tex, template: solidTemplate(mi, K), K, celled: true, minD, maxD, mesh: mi, floats: fl({ _Compact: 1, _Mat: mat, _TexScale: ts }), draws: celledDraws(start, K) });
  };
  Wd.chunks.forEach((c, i) => {
    const big = i > 2 && i < 6, ts = i > 5 ? 44 : big ? 0 : 96;
    addCelled(`chunks${i}`, tCh, c, ch.base[i], 14 + i, 0, i > 5 ? 30 : big ? 40 : 96, 1, ts);
    if (big) addCelled(`chunks${i}_far`, tCh, c, ch.base[i], 20 + i, 40, 150, 1, ts);
  });
  Wd.props.forEach((c, i) => {
    const lod = i === 3 || i === 4, mat = i < 3 ? 4 : 5;
    addCelled(`props${i}`, tPr, c, pr.base[i], 4 + i, 0, lod ? 6 : 110, mat, 1);
    if (lod) addCelled(`props${i}_far`, tPr, c, pr.base[i], 18 + i, 6, 110, mat, 1);
  });
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
// ---------------------------------------------------------------- floor collider (Unity space)
// The player only needs to be kept above the sea floor (and inside the world, AbyssSwim): a 3 m heightfield of the
// lowest floor in each column, lowered to the lowest within 12 m and smoothed, so rocks and mesas stay passable.
const floorMesh = (() => {
  const nx = W.NX, ny = W.NY, nz = W.NZ, h = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    let y = 0; while (y < ny - 1 && D[x + nx * (y + ny * z)] > 0) y++;
    const a = D[x + nx * (Math.max(y, 1) - 1 + ny * z)], b = D[x + nx * (y + ny * z)];
    h[x + nx * z] = W.OY + (y > 0 ? y - 1 + a / (a - b) : 0) * W.VS;
  }
  const R = 16, tmp = new Float32Array(nx * nz), m = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { let v = 1e9; for (let i = Math.max(0, x - R); i <= Math.min(nx - 1, x + R); i++) v = Math.min(v, h[i + nx * z]); tmp[x + nx * z] = v; }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { let v = 1e9; for (let i = Math.max(0, z - R); i <= Math.min(nz - 1, z + R); i++) v = Math.min(v, tmp[x + nx * i]); m[x + nx * z] = v; }
  const G = 129, step = (nx - 1) / (G - 1), H = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s = 0, n = 0; for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) { const x = Math.round(i * step) + a, z = Math.round(j * step) + b; if (x >= 0 && z >= 0 && x < nx && z < nz) { s += m[x + nx * z]; n++; } } H[i + G * j] = s / n; }
  return writeTemplate('mesh_floor', G * G, (G - 1) * (G - 1) * 6, (P, N, U, I) => {
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const v = i + G * j; P.set([W.OX + i * step * W.VS, H[v], -(W.OZ + j * step * W.VS)], v * 3); N[v * 3 + 1] = 1; }
    let o = 0;
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = i + G * j, b = a + 1, c = a + G, d = c + 1; I.set([a, b, c, b, d, c], o); o += 6; }
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
    { name: 'volume', file: 'tex_volume.bin', width: W.NX / 2, height: W.NY / 2, depth: W.NZ / 2, format: 'RG16' },
    { name: 'ground', file: 'tex_ground.bin', width: 512, height: 512, depth: 1, format: 'RGBA32' },
    { name: 'shadow', file: 'tex_shadow.bin', width: SHADOW, height: SHADOW, depth: 1, format: 'R16' },
    { name: 'sdf', file: 'tex_sdf.bin', width: W.NX, height: W.NY, depth: W.NZ, format: 'R8' },
    { name: 'sdfFar', file: 'tex_sdf_far.bin', width: W.NX / 4, height: W.NY / 4, depth: W.NZ / 4, format: 'R8' },
    ...Object.entries(textures).map(([name, v]) => ({ name, format: 'RGBAFloat', ...v, depth: 1 })),
  ],
  templates: Object.entries(templates).map(([name, v]) => ({ name, ...v })), sets, floorMesh,
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
