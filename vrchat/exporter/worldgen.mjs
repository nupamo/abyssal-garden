// Runs the web version's own world generator (source/src/math.js + world.js, plus the viewpoint / camera path and
// cleanup blocks lifted out of main.js) in Node, with the terrain density from density.mjs instead of the GPU.
// Nothing here is a copy of the generator: the source files are read and evaluated as they are, so the VRChat world
// stays the same world when they change.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { densityGrid } from './density.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'source', 'src');
const src = (f) => readFileSync(path.join(SRC, f), 'utf8');
// text of main.js from the line starting with `from` up to and including the line containing `to`
const lift = (text, from, to) => {
  const a = text.indexOf(from); if (a < 0) throw new Error('main.js no longer contains: ' + from);
  const b = text.indexOf(to, a); if (b < 0) throw new Error('main.js no longer contains: ' + to);
  return text.slice(a, text.indexOf('\n', b + to.length) + 1);
};

// Placement records for the procedural plants: each call in world.js that grows a group of leaves (a kelp column, a
// cluster, a frond or tuft bunch, a ground-cover spot) also notes where and with which shape parameters. The leaves
// themselves are then grown by the shaders from these (AbyssGrow.cginc). The generator still runs unchanged, so the
// random streams, and with them every placement, stay those of the web version.
const RECORD = [
  ['const la = rnd() * TAU, lm = rr(0, 0.11), full = rr(0.55, 1.3) * dens;', '$& REC.column.push([x, y, z, H, kind, strands, ph, tw, sr, sc, la, lm, full]);'],
  ['const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {', '$& REC.cluster.push([x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway]);'],
  ['const n = 12 + rnd() * 20 | 0;', '$& REC.frond.push([x, y, z, n, zp]);'],
  ['const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 5 + rnd() * 7 | 0;', '$& REC.tuft.push([x, y, z, n, zp, yaw]);'],
  ['const nl = 2 + (rnd() * 3 | 0), yw = rnd() * TAU;', '$& REC.carpet.push([x, y, z, nl, yw]);'],
  ['if (m > 0.3 && u < m * 0.9) for', 'if (m > 0.3 && u < m * 0.9 && REC.spot.push([x, y, z, 5])) for'],
  ['hot(x, z)) * sstep(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2))) for', 'hot(x, z)) * sstep(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2)) && REC.spot.push([x, y, z, 7])) for'],
];
function instrument(world) {
  for (const [a, b] of RECORD) {
    const i = world.indexOf(a);
    if (i < 0 || world.indexOf(a, i + 1) >= 0) throw new Error('world.js changed, record point not found once: ' + a);
    world = world.slice(0, i) + b.replace('$&', a) + world.slice(i + a.length);
  }
  return world;
}

// LV: 0 High, 1 Medium, 2 Low (as in quality.js); records: also collect the placement records (REC)
export function makeContext(LV, records = false) {
  const ctx = vm.createContext({ console, Math, Float32Array, Float64Array, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, ArrayBuffer, Map, Set, Array, Number, Object });
  const main = src('main.js');
  const code = [
    `const LV = ${LV}, THIN = 1 << LV;`,
    'const REC = { column: [], cluster: [], frond: [], tuft: [], carpet: [], spot: [] };',
    src('math.js'), records ? instrument(src('world.js')) : src('world.js'),
    // POSES, FLY, spline + arc-length table, flyPts
    lift(main, 'const POSES = [', 'for (const p of POSES) flyPts.push('),
    // procedural meshes, as an expression
    'function buildMeshes() {', lift(main, 'const meshes = [meshChunk(1, 3)', 'meshCoral(1, 1).build(), meshChunk(5, 2, 1)'), 'return meshes; }',
    // floating speck removal (operates on D)
    'function removeSpecks(D) {', lift(main, 'const S = NX * NY, R = new Uint8Array', 'for (const i of L) if (!R[i]) D[i] = -D[i];'), '}',
    // hand the pieces to the caller
    'this.out = { NX, NY, NZ, VS, OX, OY, OZ, CELLS, CELLW, NCHUNK, MESAS, ARCHES, HOLES, CLEARS, PURPLE, primBuffer, buildTerrain, makeWorld, buildMeshes, removeSpecks, POSES, FLY, flyPts, surfaceNets, Mesh, icosphere, REC };',
  ].join('\n');
  vm.runInContext(code, ctx, { filename: 'abyssal-worldgen.js' });
  return ctx.out;
}

export async function generate(LV, log = () => {}, records = false) {
  const W = makeContext(LV, records);
  const P = W.primBuffer(), c = [W.MESAS.length, W.ARCHES.length, W.HOLES.length, W.CLEARS.length];
  let t = Date.now();
  let last = -1;
  const D = await densityGrid([W.NX, W.NY, W.NZ, W.OX, W.OY, W.OZ, W.VS], P, c, undefined, (f) => { const p = Math.floor(f * 10); if (p !== last) { last = p; log(`  density ${p * 10}%`); } });
  log(`density field ${W.NX}x${W.NY}x${W.NZ}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  t = Date.now();
  W.removeSpecks(D);
  const T = W.buildTerrain(D);
  log(`terrain: ${T.nv} vertices, ${T.ib.length / 3} triangles (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  t = Date.now();
  const Wd = W.makeWorld(D, T, W.flyPts, W.POSES);
  const poses = W.POSES.map((p) => p.slice());
  for (const p of poses) p[1] += Wd.gy(p[0], p[2]);
  log(`world: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const meshes = W.buildMeshes();
  return { W, D, T, Wd, poses, meshes };
}
