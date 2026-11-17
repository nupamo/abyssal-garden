// Checks that the leaf records in Raw~/inst_leaves_*.bin decode (the way AbyssLeaf.cginc does) to the generator's own
// values. Development check only: node verify-packing.mjs  (after export.mjs, same level)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './worldgen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), raw = path.join(here, '..', 'Assets', 'AbyssalGarden', 'Raw~');
const man = JSON.parse(readFileSync(path.join(raw, 'manifest.json'), 'utf8'));
const { Wd } = await generate({ high: 0, medium: 1, low: 2 }[man.level]);
const f32 = Math.fround, unpack = (x, m) => { const hi = Math.floor(f32(x / m)); return [x - hi * m, hi]; };
for (const [file, L] of [['inst_leaves_big.bin', Wd.big], ['inst_leaves_far.bin', Wd.bigF], ['inst_leaves_small.bin', Wd.small]]) {
  const t = new Float32Array(readFileSync(path.join(raw, file)).buffer.slice(0)), f = new Float32Array(L.buf), u8 = new Uint8Array(L.buf);
  const err = { pos: 0, yaw: 0, tilt: 0, wid: 0, hA: 0 }; let bad = 0;
  for (let i = 0; i < L.n; i++) {
    const a = t.subarray(i * 8, i * 8 + 4), b = t.subarray(i * 8 + 4, i * 8 + 8), s = i * 9, o = i * 36;
    const [tilt, bend] = unpack(b[1], 4096), [wid, hA] = unpack(b[2], 4096), [ty, s12] = unpack(b[3], 8), [s1, s2] = unpack(s12, 256);
    err.pos = Math.max(err.pos, Math.abs(a[0] - f[s]), Math.abs(a[1] - f[s + 1]), Math.abs(a[2] - f[s + 2]), Math.abs(a[3] - f[s + 3]));
    err.yaw = Math.max(err.yaw, Math.abs(b[0] - f[s + 4]));
    err.tilt = Math.max(err.tilt, Math.abs(tilt / 1000 - f[s + 5])); err.wid = Math.max(err.wid, Math.abs(wid / 2000 - f[s + 6])); err.hA = Math.max(err.hA, Math.abs(hA / 50 - f[s + 7]));
    if (ty !== u8[o + 32] || s1 !== u8[o + 33] || s2 !== u8[o + 34] || bend !== u8[o + 35]) bad++;
  }
  console.log(`${file}: ${L.n} leaves, byte fields wrong: ${bad}, max error pos ${err.pos} yaw ${err.yaw} tilt ${err.tilt.toFixed(5)} width ${err.wid.toFixed(5)} height ${err.hA.toFixed(4)}`);
}
