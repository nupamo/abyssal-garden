// Compares the baked shadow map (Raw~/tex_shadow.bin, from export.mjs) with the one the web version renders, by running
// the web version in headless Chromium (WebGPU on SwiftShader; takes a few minutes) and reading its shadow texture.
// Development check only: node verify-shadow.mjs [medium|high|low]  (same level as the export)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), SRC = path.join(here, '..', '..', 'source');
const LV = { high: 0, medium: 1, low: 2 }[process.argv[2] ?? 'medium'], S = LV ? 2048 : 4096;
const raw = path.join(here, '..', 'Assets', 'AbyssalGarden', 'Raw~');
const man = JSON.parse(readFileSync(path.join(raw, 'manifest.json'), 'utf8'));
if (man.textures.shadow.width !== S) throw new Error(`the export has a ${man.textures.shadow.width} shadow map; this level renders ${S}`);

// the web page, with a hook after the shadow bake that reads the depth texture back
const files = ['quality.js', 'math.js', 'shaders.js', 'world.js', 'main.js'];
let js = files.map((f) => readFileSync(path.join(SRC, 'src', f), 'utf8')).join('\n');
const hook = '// the GPU has its own copies now', usage = 'tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING';
if (!js.includes(usage)) throw new Error('main.js changed: shadow texture not found');
js = js.replace(usage, usage + ' | TU.COPY_SRC'); // so it can be read back
if (!js.includes(hook)) throw new Error('main.js changed: hook point not found');
js = js.replace(hook, `{ const b = device.createBuffer({ size: ${S * S * 4}, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), e = device.createCommandEncoder();
  e.copyTextureToBuffer({ texture: tShadow, aspect: 'depth-only' }, { buffer: b, bytesPerRow: ${S * 4} }, [${S}, ${S}]); Q.submit([e.finish()]);
  await b.mapAsync(GPUMapMode.READ); window.__shadow = new Float32Array(b.getMappedRange().slice(0)); throw new Error('shadow captured'); }
${hook}`);
const html = readFileSync(path.join(SRC, 'template.html'), 'utf8').replace('/*SCRIPT*/', () => `(async()=>{${js}\n})().catch(e=>{window.__err=String(e)});`);
const tmp = path.join(here, '.verify-shadow.html');
writeFileSync(tmp, html);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] });
const page = await browser.newPage();
await page.addInitScript((lv) => { localStorage.abyssal = String(lv); }, LV);
await page.goto('file://' + tmp);
await page.waitForFunction(() => window.__shadow || (window.__err && !window.__err.includes('shadow captured')), null, { timeout: 0, polling: 2000 });
const err = await page.evaluate(() => window.__shadow ? null : window.__err);
if (err) throw new Error(err);
const gpu = new Float32Array(await page.evaluate(() => Array.from(window.__shadow)));
await browser.close();
const cpu = new Uint16Array(readFileSync(path.join(raw, 'tex_shadow.bin')).buffer.slice(0));
// texels with an occluder in one map only (edges of thin leaves, mostly), and how far apart the depths are elsewhere
let agree = 0; const n = S * S, d = [];
for (let i = 0; i < n; i++) { const g = gpu[i] < 0.9999, c = cpu[i] < 65530; if (g === c) agree++; if (g && c) d.push(Math.abs(gpu[i] - cpu[i] / 65535) * 300); }
d.sort((a, b) => a - b);
console.log(`occluder in both maps or neither: ${(agree / n * 100).toFixed(2)}% of texels; depth difference where both have one: median ${(d[d.length >> 1] * 100).toFixed(1)} cm, 90th percentile ${(d[Math.floor(d.length * 0.9)] * 100).toFixed(1)} cm`);
