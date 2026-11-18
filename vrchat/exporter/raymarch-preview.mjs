// Prototype of the raymarching renderer in WebGPU, next to the web version itself, from the same viewpoint.
// The raymarcher finds the terrain in the baked SDF (sdf.mjs) and shades it with the web version's own WGSL (W_SOLID's
// fs, W_SURF), so any difference in the two pictures is the geometry. Writes <out>/raymarch-<n>.png and original-<n>.png.
// Development tool: node raymarch-preview.mjs [viewpoint 1-6] [out dir]   (after export.mjs at medium)
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generate } from './worldgen.mjs';
import { bakeSDF, NEAR, FAR } from './sdf.mjs';
import { sunFrame } from './shadow.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), SRC = path.join(here, '..', '..', 'source');
const raw = path.join(here, '..', 'Assets', 'AbyssalGarden', 'Raw~');
const VP = +(process.argv[2] ?? 1), OUTD = process.argv[3] ?? here, Wd = 960, Hd = 540;
const man = JSON.parse(readFileSync(path.join(raw, 'manifest.json'), 'utf8'));
if (man.level !== 'medium') throw new Error('export at medium first');
const ARGS = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'];

// ---------------------------------------------------------------- shaders
const ctx = vm.createContext({ LV: 1, SHADOW: 2048, AA: 4, WATER: 512, RAYN: 34 });
vm.runInContext(readFileSync(path.join(SRC, 'src', 'shaders.js'), 'utf8') + '\nthis.S = { W_SOLID, W_SURF, S_B, W_WATER, W_BLIT };', ctx);
const S = ctx.S;
const solid = S.W_SOLID.replace('@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f', 'fn shadeSolid(i: VO, ff: bool) -> vec4f');
const surf = S.W_SURF.slice(S.S_B.length).replace(/\bVO\b/g, 'VOS').replace('@vertex fn vs(', '@vertex fn vsS(').replace('@fragment fn fs(i: VOS) -> @location(0) vec4f', 'fn shadeSurf(i: VOS) -> vec4f')
  .replace('@fragment fn fsB(i: VOS) -> @location(0) vec4f', 'fn shadeBack(i: VOS) -> vec4f');
const RM = "diagnostic(off, derivative_uniformity);\n" + solid + surf + /*wgsl*/`
@group(1) @binding(0) var tNear: texture_3d<f32>;
@group(1) @binding(1) var tFar: texture_3d<f32>;
const GO = vec3f(-192., -56., -192.); const GN = vec3f(512., 80., 512.); const GV = .75;
// distance to rock (> 0 in water); far from the surface, a cheaper lower bound
fn sdf(p: vec3f) -> f32 {
  let g = (p - GO) / GV;
  let n = (textureSampleLevel(tNear, sC, (g + .5) / GN, 0.).r * 2. - 1.) * ${NEAR};
  if (n < ${NEAR} * .9) { return n; }
  let b = clamp(vec3i(floor(g / 4.)), vec3i(0), vec3i(GN / 4.) - 1);
  return max(textureLoad(tFar, b, 0).r * ${FAR}, ${NEAR} * .5);
}
fn nrm(p: vec3f) -> vec3f {
  let e = .45;
  return normalize(vec3f(sdf(p + vec3f(e, 0., 0.)) - sdf(p - vec3f(e, 0., 0.)), sdf(p + vec3f(0., e, 0.)) - sdf(p - vec3f(0., e, 0.)), sdf(p + vec3f(0., 0., e)) - sdf(p - vec3f(0., 0., e))));
}
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
@fragment fn fsRM(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * g.res.zw; let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rd = normalize(g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w));
  let ro = g.cam.xyz;
  // the grid's box
  let lo = (GO - ro) / rd; let hi = (GO + GN * GV - ro) / rd;
  let t0 = max(max(min(lo.x, hi.x), min(lo.y, hi.y)), min(lo.z, hi.z)); let t1 = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));
  var t = max(t0, 0.); let tEnd = min(t1, 240.); var hit = false;
  for (var i = 0; i < 300; i++) {
    if (t > tEnd) { break; }
    let s = sdf(ro + rd * t);
    if (s < .002 * t + .005) { hit = true; break; }
    t += s * .9;
  }
  if (hit) { // two secant steps onto the surface
    for (var k = 0; k < 2; k++) { t += sdf(ro + rd * t); }
  }
  let tS = select(1e9, -ro.y / rd.y, rd.y > 1e-4);
  var vo: VO;
  if (hit && t < tS) {
    let p = ro + rd * t; let n = nrm(p);
    vo.wp = p; vo.n = n; vo.op = p; vo.on = n; vo.m = vec4f(0., 0., 1., 0.); vo.q = vec4f(0., 0., 0., 1.); vo.ao = 1.;
    return shadeSolid(vo, true);
  }
  var vs: VOS;
  if (tS < 1e8) { vs.wp = ro + rd * tS; return shadeSurf(vs); }
  vs.wp = ro + rd; return shadeBack(vs);
}
// W_POST without the shafts and bloom
@group(0) @binding(0) var tHdr: texture_2d<f32>;
fn tmap(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), vec3f(0.), vec3f(1.)); }
`;
const POST = /*wgsl*/`
@group(0) @binding(0) var tHdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> ex: vec4f;
fn tmap(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), vec3f(0.), vec3f(1.)); }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var c = textureLoad(tHdr, vec2i(fc.xy), 0).rgb * ex.x;
  let q = fc.xy * ex.zw - .5; c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722)); let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4); c = mix(c, vec3f(l), smoothstep(.55, 1., l) * .1); c = mix(vec3f(l), c, .93) + vec3f(.008, .002, 0.);
  return vec4f(pow(max(c, vec3f(0.)), vec3f(1. / 2.2)), 1.);
}`;

// ---------------------------------------------------------------- data
const { W, D } = await generate(1, () => {});
const sdf = bakeSDF(D, W.NX, W.NY, W.NZ, W.VS);
const blobs = { near: sdf.near, far: sdf.far, det: readFileSync(path.join(raw, 'tex_detail.bin')), vol: readFileSync(path.join(raw, 'tex_volume.bin')), gm: readFileSync(path.join(raw, 'tex_ground.bin')), sh: readFileSync(path.join(raw, 'tex_shadow.bin')) };
const vp = man.viewpoints[VP - 1], pose = [vp.position[0], vp.position[1], -vp.position[2], vp.lookAt[0], vp.lookAt[1], -vp.lookAt[2]];
const { M } = sunFrame(), L = man.sun;
const UB = new Float32Array(60);
{
  const dx = pose[3] - pose[0], dy = pose[4] - pose[1], dz = pose[5] - pose[2], yaw = Math.atan2(dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cp = Math.cos(pitch), fy = Math.sin(pitch), rx = Math.cos(yaw), rz = Math.sin(yaw), fx = cp * rz, fz = -cp * rx, ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) UB[16 + c * 4 + r] = M[r][c];
  UB.set([pose[0], pose[1], pose[2], 3], 32); UB.set([rx, 0, rz, 0.6 * Wd / Hd], 36); UB.set([ux, uy, uz, 0.6], 40); UB.set([fx, fy, fz, 0.1], 44);
  const zx = pose[0] - 6, zz = pose[2] - 84; let zt = Math.min(1, Math.max(0, (44 - Math.hypot(zx, zz)) / 18));
  UB.set([...L, zt * zt * (3 - 2 * zt)], 48); UB.set([Wd, Hd, 1 / Wd, 1 / Hd], 52);
  let ek = Math.min(1, Math.max(0, (-pose[1] - 8) / 26)); UB.set([0.62 * (0.6 + 0.4 * ek), 0.54, 1, 0], 56);
}

const browser = await chromium.launch({ args: ARGS });
const page = await browser.newPage({ viewport: { width: Wd, height: Hd } });
// the big arrays go to the page as fetches of http://data/<name>
await page.route('http://data/**', (r) => r.fulfill({ status: 200, body: Buffer.from(blobs[r.request().url().split('/').pop()]), headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' } }));
await page.goto('file://' + path.join(here, 'raymarch-preview.mjs'));
const png = await page.evaluate(async ({ RM, POST, WATER, BLIT, UB, Wd, Hd }) => {
  const get = async (n) => new Uint8Array(await (await fetch('http://data/' + n)).arrayBuffer());
  const [near, far, det, vol, gm, sh] = await Promise.all(['near', 'far', 'det', 'vol', 'gm', 'sh'].map(get));
  const a = await navigator.gpu.requestAdapter(), dev = await a.requestDevice(), Q = dev.queue, TU = GPUTextureUsage;
  dev.addEventListener('uncapturederror', (e) => console.error(e.error.message));
  const tex = (size, format, usage, o = {}) => dev.createTexture({ size, format, usage, dimension: o.d || '2d', mipLevelCount: o.mips || 1 });
  const fs3 = (m, e, fmt) => dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: e, targets: [{ format: fmt }] } });
  const pass = (e, view, pipe, bg) => { const r = e.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }); r.setPipeline(pipe); if (bg) r.setBindGroup(0, bg); r.draw(3); r.end(); };
  const sC = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' }), sR = dev.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 }), sS = dev.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
  const mBlit = dev.createShaderModule({ code: BLIT });
  const mip = (e, t, n, fmt) => { const p = fs3(mBlit, 'fsMip', fmt); for (let i = 1; i < n; i++) pass(e, t.createView({ baseMipLevel: i, mipLevelCount: 1 }), p, dev.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: sC }] })); };
  const e = dev.createCommandEncoder();
  // water at t = 3 s, detail, with mips
  const tW = tex([512, 512], 'rgba16float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
  const mW = dev.createShaderModule({ code: WATER }), pW = fs3(mW, 'fs', 'rgba16float'), ub = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  Q.writeBuffer(ub, 0, new Float32Array([3, 0, 0, 0]));
  pass(e, tW.createView({ baseMipLevel: 0, mipLevelCount: 1 }), pW, dev.createBindGroup({ layout: pW.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] }));
  mip(e, tW, 5, 'rgba16float');
  const tD = tex([1024, 1024], 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_DST, { mips: 11 });
  Q.writeTexture({ texture: tD }, det, { bytesPerRow: 4096 }, [1024, 1024]);
  mip(e, tD, 11, 'rgba8unorm');
  const tV = tex([256, 40, 256], 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: '3d' }); Q.writeTexture({ texture: tV }, vol, { bytesPerRow: 512, rowsPerImage: 40 }, [256, 40, 256]);
  const tM = tex([512, 512], 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST); Q.writeTexture({ texture: tM }, gm, { bytesPerRow: 2048 }, [512, 512]);
  const tSh = tex([2048, 2048], 'depth16unorm', TU.TEXTURE_BINDING | TU.COPY_DST); Q.writeTexture({ texture: tSh }, sh, { bytesPerRow: 4096 }, [2048, 2048]);
  const tN = tex([512, 80, 512], 'r8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: '3d' }); Q.writeTexture({ texture: tN }, near, { bytesPerRow: 512, rowsPerImage: 80 }, [512, 80, 512]);
  const tF = tex([128, 20, 128], 'r8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: '3d' }); Q.writeTexture({ texture: tF }, far, { bytesPerRow: 128, rowsPerImage: 20 }, [128, 20, 128]);
  const ubo = dev.createBuffer({ size: 240, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); Q.writeBuffer(ubo, 0, new Float32Array(UB));
  // raymarch into HDR
  const m = dev.createShaderModule({ code: RM });
  const info = await m.getCompilationInfo(); for (const msg of info.messages) if (msg.type === 'error') throw new Error(msg.lineNum + ': ' + msg.message);
  const pRM = dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vsFull' }, fragment: { module: m, entryPoint: 'fsRM', targets: [{ format: 'rgba16float' }] } });
  const tH = tex([Wd, Hd], 'rgba16float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  const res = [[0, { buffer: ubo }], [1, sR], [2, sC], [3, sS], [4, tSh.createView()], [5, tW.createView()], [6, tD.createView()], [7, tV.createView()], [8, tM.createView()]];
  const lay0 = pRM.getBindGroupLayout(0);
  // 'auto' layouts only hold what the entry point uses: try each binding
  const bg0 = dev.createBindGroup({ layout: lay0, entries: res.map(([binding, resource]) => ({ binding, resource })) });
  const bg1 = dev.createBindGroup({ layout: pRM.getBindGroupLayout(1), entries: [{ binding: 0, resource: tN.createView() }, { binding: 1, resource: tF.createView() }] });
  { const r = e.beginRenderPass({ colorAttachments: [{ view: tH.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }); r.setPipeline(pRM); r.setBindGroup(0, bg0); r.setBindGroup(1, bg1); r.draw(3); r.end(); }
  // grade into an 8-bit target and read it back
  const mP = dev.createShaderModule({ code: POST }), pP = fs3(mP, 'fs', 'rgba8unorm');
  const ex = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); Q.writeBuffer(ex, 0, new Float32Array([UB[56], 0, 1 / Wd, 1 / Hd]));
  const tO = tex([Wd, Hd], 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.COPY_SRC);
  pass(e, tO.createView(), pP, dev.createBindGroup({ layout: pP.getBindGroupLayout(0), entries: [{ binding: 0, resource: tH.createView() }, { binding: 1, resource: { buffer: ex } }] }));
  const bpr = Math.ceil(Wd * 4 / 256) * 256, b = dev.createBuffer({ size: bpr * Hd, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  e.copyTextureToBuffer({ texture: tO }, { buffer: b, bytesPerRow: bpr }, [Wd, Hd]);
  Q.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(b.getMappedRange()), cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
  const c2 = cv.getContext('2d'), img = c2.createImageData(Wd, Hd);
  for (let y = 0; y < Hd; y++) img.data.set(src.subarray(y * bpr, y * bpr + Wd * 4), y * Wd * 4);
  c2.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}, { RM, POST, WATER: S.W_WATER, BLIT: S.W_BLIT, UB: Array.from(UB), Wd, Hd });
writeFileSync(path.join(OUTD, `raymarch-${VP}.png`), Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log('raymarch done');
