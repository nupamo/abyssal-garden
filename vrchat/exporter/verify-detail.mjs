// Compares detail.mjs with the original W_DETAIL shader on a band of rows (WebGPU in headless Chromium).
// Development check only: node verify-detail.mjs [y0] [rows]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { detailTexture } from './detail.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const y0 = +(process.argv[2] ?? 300), ny = +(process.argv[3] ?? 16);
const ctx = vm.createContext({ LV: 0, SHADOW: 4096, AA: 4, WATER: 512, RAYN: 34 });
vm.runInContext(readFileSync(new URL('../../source/src/shaders.js', import.meta.url), 'utf8') + '\nthis.W_DETAIL = W_DETAIL;', ctx);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] });
const page = await browser.newPage();
await page.goto('file://' + new URL('./verify-detail.mjs', import.meta.url).pathname);
const gpu = await page.evaluate(async ({ code, y0, ny }) => {
  const a = await navigator.gpu.requestAdapter(), dev = await a.requestDevice();
  const m = dev.createShaderModule({ code });
  const p = dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const t = dev.createTexture({ size: [1024, 1024], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const b = dev.createBuffer({ size: 4096 * ny, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = dev.createCommandEncoder();
  const r = e.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
  r.setPipeline(p); r.setScissorRect(0, y0, 1024, ny); r.draw(3); r.end();
  e.copyTextureToBuffer({ texture: t, origin: [0, y0] }, { buffer: b, bytesPerRow: 4096 }, [1024, ny]);
  dev.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
  return Array.from(new Uint8Array(b.getMappedRange()));
}, { code: ctx.W_DETAIL, y0, ny });
await browser.close();
const cpu = await detailTexture(y0, y0 + ny);
let maxd = [0, 0, 0, 0], big = 0;
for (let i = 0; i < gpu.length; i++) { const d = Math.abs(gpu[i] - cpu[y0 * 4096 + i]); maxd[i & 3] = Math.max(maxd[i & 3], d); if (d > 2) big++; }
console.log(`rows ${y0}..${y0 + ny}: max |diff| per channel ${maxd.join(' ')} (of 255), values off by more than 2: ${big} of ${gpu.length}`);
