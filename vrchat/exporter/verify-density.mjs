// Compares density.mjs with the original W_DENS compute shader on a slab of the grid, run through WebGPU in headless
// Chromium (Playwright, SwiftShader is enough). Development check only: node verify-density.mjs [z0] [depth]
// (the slab's first and last rows are skipped: the shader marks them as the grid border)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { makeContext } from './worldgen.mjs';
import { makeDens } from './density.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const z0 = +(process.argv[2] ?? 200), nzs = +(process.argv[3] ?? 8);
const W = makeContext(0);
const ctx = vm.createContext({ LV: 0, SHADOW: 4096, AA: 4, WATER: 512, RAYN: 34 });
vm.runInContext(readFileSync(new URL('../../source/src/shaders.js', import.meta.url), 'utf8') + '\nthis.W_DENS = W_DENS;', ctx);
const P = W.primBuffer(), c = [W.MESAS.length, W.ARCHES.length, W.HOLES.length, W.CLEARS.length];

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] });
const page = await browser.newPage();
await page.goto('file://' + new URL('./verify-density.mjs', import.meta.url).pathname); // any file: WebGPU needs a secure context
const gpu = await page.evaluate(async ({ code, P, c, g }) => {
  const a = await navigator.gpu.requestAdapter(), dev = await a.requestDevice();
  const [nx, ny, nz, ox, oy, oz, vs] = g, size = nx * ny * nz * 4;
  const p = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' } });
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = nx; uu[1] = ny; uu[2] = nz; uf[4] = ox; uf[5] = oy; uf[6] = oz; uf[7] = vs; uu[8] = c[0]; uu[9] = c[1]; uu[10] = c[2]; uu[11] = c[3];
  const mk = (data, usage) => { const b = dev.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, data); return b; };
  const bu = mk(new Uint8Array(u), GPUBufferUsage.UNIFORM), bp = mk(new Float32Array(P), GPUBufferUsage.STORAGE);
  const bd = dev.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), br = dev.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const bg = dev.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  const e = dev.createCommandEncoder(), cp = e.beginComputePass(); cp.setPipeline(p); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(nx / 4, ny / 4, Math.ceil(nz / 4)); cp.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size); dev.queue.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  return Array.from(new Float32Array(br.getMappedRange()));
}, { code: ctx.W_DENS, P: Array.from(P), c, g: [W.NX, W.NY, nzs, W.OX, W.OY, W.OZ + z0 * W.VS, W.VS] });
await browser.close();

const dens = makeDens(P, c);
let maxd = 0, sum = 0, flips = 0, n = 0;
for (let z = 1; z < nzs - 1; z++) for (let y = 0; y < W.NY - 1; y++) for (let x = 1; x < W.NX - 1; x++) {
  const g = gpu[x + W.NX * (y + W.NY * z)], d = dens(W.OX + x * W.VS, W.OY + y * W.VS, W.OZ + (z0 + z) * W.VS);
  const e = Math.abs(g - d); maxd = Math.max(maxd, e); sum += e; n++; if ((g > 0) !== (d > 0)) flips++;
}
console.log(`slab z ${z0}..${z0 + nzs}: ${n} samples, mean |diff| ${(sum / n).toExponential(2)}, max |diff| ${maxd.toExponential(2)}, inside/outside flips ${flips}`);
