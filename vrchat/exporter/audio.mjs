// Renders the web version's soundscape (source/src/audio.js) into clips for the VRChat world, which cannot synthesize
// sound: the same Web Audio graph, run in an OfflineAudioContext in headless Chromium (Playwright), then encoded to
// Ogg Vorbis with ffmpeg. Writes ../Assets/AbyssalGarden/Audio/*.ogg.
//
//   node audio.mjs
//
// Loops are seamless (the tail cross-fades into the head) and start after a pre-roll, so the reverb is already full.
// Levels are those of audio.js before its master gain (0.78, applied by AbyssAmbience) and limiter (not ported).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'Assets', 'AbyssalGarden', 'Audio');
mkdirSync(OUT, { recursive: true });
const math = readFileSync(path.join(here, '..', '..', 'source', 'src', 'math.js'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(here, 'audio.mjs')); // any page will do
await page.addScriptTag({ content: math + '\nwindow.rnd = rnd; window.rr = rr; window.rseed = rseed;' });

const clips = await page.evaluate(async () => {
  const sr = 48000, { exp } = Math;
  rseed(300);
  // the shared buffers, as in mkSound(): an 11 s seamless brown noise loop and a 5 s reverb impulse
  const mk = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  const nb = mk(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  const ir = mk(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.5) * (1 - i / n); } });

  // renders `secs` seconds of a graph built by build(ac, N, out, wet)
  async function render(secs, build) {
    const ac = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
    const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
    const out = N(GainNode, { gain: 1 }, ac.destination), wet = N(ConvolverNode, { buffer: ir }, out);
    build(ac, N, out, wet);
    const b = await ac.startRendering();
    return [b.getChannelData(0), b.getChannelData(1)];
  }
  const G = (N, gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (N, type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (N, frequency, depth, to) => N(OscillatorNode, { frequency }, G(N, depth, to));
  const src = (N, playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // a seamless loop of L s: render pre-roll + L + cross-fade, keep L with the tail faded into the head
  async function loop(L, build, pre = 6, X = 4) {
    const ch = await render(pre + L + X, build), n = L * sr, x = X * sr, p = pre * sr;
    return ch.map((d) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = d[p + i]; for (let i = 0; i < x; i++) { const k = i / x; o[i] = o[i] * Math.sin(k * Math.PI / 2) + d[p + n + i] * Math.cos(k * Math.PI / 2); } return o; });
  }
  // one note as in play(): pitch glides f0 -> f1 over dur, level rises to vol in att then dies away
  const note = (ac, N, out, wet, send, type, t, f0, f1, dur, vol, att, pan = 0) => {
    const p = N(StereoPannerNode, { pan }, out, G(N, send, wet)), g = G(N, 0, p), o = N(OscillatorNode, { type, frequency: f0 }, g);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  const res = {};
  res.loop_rumble = await loop(64, (ac, N, out) => { const rum = G(N, 0.34, out); src(N, 1, BQ(N, 'lowpass', 150, 0.7, rum)); lfo(N, 0.07, 0.11, rum.gain); lfo(N, 0.113, 0.08, rum.gain); });
  res.loop_wash = await loop(64, (ac, N, out) => { const wave = G(N, 1, out); src(N, 0.63, BQ(N, 'bandpass', 420, 0.5, wave)); lfo(N, 0.09, 0.3, wave.gain); lfo(N, 0.151, 0.25, wave.gain); });
  res.loop_rush = await loop(30, (ac, N, out) => { src(N, 0.63, BQ(N, 'bandpass', 300, 0.9, out)); });
  res.loop_drone = await loop(64, (ac, N, out, wet) => {
    const pad = G(N, 1, out, G(N, 1.5, wet));
    [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => { const g = G(N, 0.022 - i * 0.003, pad); N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.03, 0.11) }, g); });
  });
  // bursts of 1-6 bubbles: short rising blips, smaller bubbles higher and shorter
  for (let k = 0; k < 10; k++) {
    const blips = []; let tt = 0.02;
    for (let n = 1 + (k % 6); n--;) { const f = rr(380, 1300); blips.push([tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), rr(-0.7, 0.7)]); tt += rr(0.07, 0.2); }
    res['bubbles_' + k] = await render(tt + 2.5, (ac, N, out, wet) => { for (const b of blips) note(ac, N, out, wet, 0.12, 'sine', b[0], b[1], b[2], b[3], b[4], 0.006, b[5]); });
  }
  // chimes: D major pentatonic
  const NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19];
  for (let k = 0; k < NOTES.length; k++) {
    const f = 440 * 2 ** (NOTES[k] / 12);
    res['chime_' + k] = await render(10, (ac, N, out, wet) => note(ac, N, out, wet, 1.2, 'sine', 0.02, f, f, 5, 0.03, 0.03));
  }
  // whale calls: phrases of 2-3 slow glides
  for (let k = 0; k < 8; k++) {
    const gl = []; let tt = 0.02;
    for (let n = 2 + (k % 2); n--;) { const f = rr(170, 380), d = rr(1.6, 3.2); gl.push([tt, f, f * rr(0.6, 1.7), d]); tt += d * 0.8; }
    const end = gl.reduce((m, g) => Math.max(m, g[0] + g[3]), 0);
    res['whale_' + k] = await render(end + 6, (ac, N, out, wet) => { for (const g of gl) note(ac, N, out, wet, 2, 'triangle', g[0], g[1], g[2], g[3], 0.08, g[3] * 0.4); });
  }
  // to 16-bit stereo PCM, base64 (keeps the transfer out of the page small enough)
  const enc = {};
  for (const [k, [l, r]] of Object.entries(res)) {
    const pcm = new Int16Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767; }
    let s = ''; const u8 = new Uint8Array(pcm.buffer); for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
    enc[k] = btoa(s);
  }
  return enc;
});
await browser.close();

for (const [name, b64] of Object.entries(clips)) {
  const pcm = Buffer.from(b64, 'base64'), raw = path.join(OUT, name + '.raw');
  writeFileSync(raw, pcm);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', raw, '-c:a', 'libvorbis', '-q:a', '5', path.join(OUT, name + '.ogg')]);
  rmSync(raw);
  console.log(`${name}.ogg  ${(pcm.length / 4 / 48000).toFixed(1)} s`);
}
