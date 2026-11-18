// Renders the web version itself (WebGPU on SwiftShader) from viewpoint 1, optionally terrain only, for comparing with
// raymarch-preview.mjs. Development tool: node original-preview.mjs [terrain|all] [out dir]
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), SRC = path.join(here, '..', '..', 'source');
const only = (process.argv[2] ?? 'terrain') === 'terrain', OUTD = process.argv[3] ?? here, Wd = 960, Hd = 540;
let js = ['quality.js', 'math.js', 'shaders.js', 'world.js', 'main.js'].map((f) => readFileSync(path.join(SRC, 'src', f), 'utf8')).join('\n');
const cut = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i); if (i < 0 || j < 0) throw new Error('main.js changed: ' + a); js = js.slice(0, i) + js.slice(j); };
if (only) {
  cut('  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh)', '  r.setPipeline(pSurf); r.draw(4);');
  cut('  r.setPipeline(pBub);', '  r.end();\n  // light shafts');
}
js = js.replace('r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();', 'r = e.beginRenderPass(passRays); r.end();'); // no shafts (the prototype has none)
const reveal = 'ui(true);\nrequestAnimationFrame(';
if (!js.includes(reveal)) throw new Error('main.js changed: reveal');
js = js.replace(reveal, 'window.__ready = 1; return;\nrequestAnimationFrame(');
const html = readFileSync(path.join(SRC, 'template.html'), 'utf8').replace('/*SCRIPT*/', () => `(async()=>{${js}\n})().catch(e=>{window.__err=String(e)+"\n"+e.stack});`);
const tmp = path.join(here, '.original-preview.html');
writeFileSync(tmp, html);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] });
const page = await browser.newPage({ viewport: { width: Wd, height: Hd } });
await page.addInitScript(() => { localStorage.abyssal = '1,518400,1'; });
await page.goto('file://' + tmp);
await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 0, polling: 2000 });
const err = await page.evaluate(() => window.__err); if (err) throw new Error(err);
await page.evaluate(() => { document.body.className = 'g'; const s = document.createElement('style'); s.textContent = '*{filter:none!important;transition:none!important} body>*:not(canvas){display:none!important}'; document.head.append(s); });
await page.waitForTimeout(500);
await page.locator('canvas').screenshot({ path: path.join(OUTD, `original-1${only ? '-terrain' : ''}.png`) });
await browser.close(); rmSync(tmp);
console.log('original done');
