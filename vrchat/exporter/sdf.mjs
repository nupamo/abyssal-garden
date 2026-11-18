// Signed distance field of the terrain for the raymarching renderer, baked from the density grid (> 0 in rock).
//   near: full grid (0.75 m voxels), R8, signed distance clamped to +-NEAR m: the surface and its normals
//   far:  1/4 grid (3 m blocks), R8, a lower bound of the distance to rock anywhere in the block, up to FAR m: long steps
// Near the surface the distance is the density over its gradient (what main.js's collide() uses); further out, an exact
// Euclidean distance transform of the inside/outside mask.
export const NEAR = 1.5, FAR = 48;

// 1-D squared distance transform (Felzenszwalb & Huttenlocher) of f (0 at seeds, 1e20 elsewhere), in place via tmp arrays
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// squared distance (in voxels) from every voxel to the nearest voxel where seed() is true
function edt(nx, ny, nz, seed) {
  const N = nx * ny * nz, g = new Float32Array(N), m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let i = 0; i < N; i++) g[i] = seed(i) ? 0 : 1e20;
  const pass = (n, stride, starts) => { for (const s of starts) { for (let q = 0; q < n; q++) f[q] = g[s + q * stride]; dt1(f, n, d, v, z); for (let q = 0; q < n; q++) g[s + q * stride] = d[q]; } };
  const sx = [], sy = [], sz = [];
  for (let z_ = 0; z_ < nz; z_++) for (let y = 0; y < ny; y++) sx.push(nx * (y + ny * z_));
  for (let z_ = 0; z_ < nz; z_++) for (let x = 0; x < nx; x++) sy.push(x + nx * ny * z_);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) sz.push(x + nx * y);
  pass(nx, 1, sx); pass(ny, nx, sy); pass(nz, nx * ny, sz);
  return g;
}

export function bakeSDF(D, nx, ny, nz, vs) {
  const N = nx * ny * nz, S = nx * ny;
  const inside = (i) => D[i] > 0;
  const dOut = edt(nx, ny, nz, inside), dIn = edt(nx, ny, nz, (i) => !inside(i));
  const sd = new Float32Array(N); // metres, > 0 in water (raymarching convention), < 0 in rock
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * (y + ny * z);
    let e = inside(i) ? -(Math.sqrt(dIn[i]) - 0.5) * vs : (Math.sqrt(dOut[i]) - 0.5) * vs;
    if (x > 0 && y > 0 && z > 0 && x < nx - 1 && y < ny - 1 && z < nz - 1) {
      const gx = D[i + 1] - D[i - 1], gy = D[i + nx] - D[i - nx], gz = D[i + S] - D[i - S], gl = Math.sqrt(gx * gx + gy * gy + gz * gz) / (2 * vs);
      if (gl > 0.05) { const l = -D[i] / gl; if (Math.abs(l) < 2 * vs) e = l; }
    }
    sd[i] = e;
  }
  const near = new Uint8Array(N);
  for (let i = 0; i < N; i++) near[i] = Math.round((Math.max(-NEAR, Math.min(NEAR, sd[i])) / NEAR * 0.5 + 0.5) * 255);
  // far: blocks of 4^3; lower bound = least distance at the block's voxels minus the block's half diagonal (and the
  // 0.5-voxel slack of the transform)
  const bx = nx / 4, by = ny / 4, bz = nz / 4, far = new Uint8Array(bx * by * bz), slack = 2 * Math.sqrt(3) * vs + vs;
  for (let Z = 0; Z < bz; Z++) for (let Y = 0; Y < by; Y++) for (let X = 0; X < bx; X++) {
    let m = 1e9;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) m = Math.min(m, sd[X * 4 + x + nx * (Y * 4 + y + ny * (Z * 4 + z))]);
    far[X + bx * (Y + by * Z)] = Math.round(Math.max(0, Math.min(FAR, m - slack)) / FAR * 255);
  }
  return { near, far, sd };
}
