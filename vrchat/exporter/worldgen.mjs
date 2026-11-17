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

// LV: 0 High, 1 Medium, 2 Low (as in quality.js)
export function makeContext(LV) {
  const ctx = vm.createContext({ console, Math, Float32Array, Float64Array, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, ArrayBuffer, Map, Set, Array, Number, Object });
  const main = src('main.js');
  const code = [
    `const LV = ${LV}, THIN = 1 << LV;`,
    src('math.js'), src('world.js'),
    // POSES, FLY, spline + arc-length table, flyPts
    lift(main, 'const POSES = [', 'for (const p of POSES) flyPts.push('),
    // procedural meshes, as an expression
    'function buildMeshes() {', lift(main, 'const meshes = [meshChunk(1, 3)', 'meshCoral(1, 1).build(), meshChunk(5, 2, 1)'), 'return meshes; }',
    // floating speck removal (operates on D)
    'function removeSpecks(D) {', lift(main, 'const S = NX * NY, R = new Uint8Array', 'for (const i of L) if (!R[i]) D[i] = -D[i];'), '}',
    // hand the pieces to the caller
    'this.out = { NX, NY, NZ, VS, OX, OY, OZ, CELLS, CELLW, NCHUNK, MESAS, ARCHES, HOLES, CLEARS, PURPLE, primBuffer, buildTerrain, makeWorld, buildMeshes, removeSpecks, POSES, FLY, flyPts, surfaceNets, Mesh, icosphere };',
  ].join('\n');
  vm.runInContext(code, ctx, { filename: 'abyssal-worldgen.js' });
  return ctx.out;
}

export async function generate(LV, log = () => {}) {
  const W = makeContext(LV);
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
