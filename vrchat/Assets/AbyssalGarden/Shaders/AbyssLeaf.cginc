// Leaves: kelp blades, grasses, fronds, ground cover. A port of W_LEAF (source/src/shaders.js), vertex shader `vs` and
// fragment shader `fs`. The template mesh is ROWS x 2 vertices per blade: uv = (-, slot, side -1|1, row 0..1).
// The leaves are grown from placement records (AbyssGrow.cginc): _Mode 0 = kelp columns and other groups (slot ->
// leaf _Base + slot * _Stride), 1 = ground-cover spots (slot -> spot _Base + slot / 6, leaf slot % 6).
#ifndef ABYSS_LEAF_INCLUDED
#define ABYSS_LEAF_INCLUDED
#include "AbyssGrow.cginc"

float _Mode;

float _Far; // fade-out distance (FAR override: 150, 70 for the small ground cover)

struct appdata { float4 vertex : POSITION; float4 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
struct v2f {
  float4 pos : SV_POSITION;
  float3 wp : TEXCOORD0; float3 n : TEXCOORD1; float2 uv : TEXCOORD2;
  nointerpolation float3 col : TEXCOORD3; nointerpolation float4 pr : TEXCOORD4;
  nointerpolation float2 sd : TEXCOORD5; nointerpolation float3 spc : TEXCOORD6;
  UNITY_VERTEX_OUTPUT_STEREO
};

float2 sway(float2 p, float h, float t) {
  float ph = dot(p, float2(.031, .017));
  float a = .024 * pow(max(h, 0.), 1.25);
  return a * (float2(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * float2(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
float shape2(float v) { return sin(3.14159 * sat(v)); }
float3 pal(float h) {
  if (h < .3) return float3(1., .62, .08);
  if (h < .6) return float3(.12, 1., .22);
  if (h < .8) return float3(.2, .85, 1.);
  return float3(1., .3, .8);
}
// splits an exact integer x into x mod m and x / m
float2 unpack(float x, float m) { float hi = floor(x / m); return float2(x - hi * m, hi); }

struct Leaf { float3 p; float3 n; float3 col; float4 pr; float2 sd; float3 spc; };
// the leaf a template slot draws, or false
bool SlotLeaf(float slot, out LeafP lp) {
  lp = (LeafP)0;
  float thin = max(_Thin, 1.);
  if (_Mode < .5) {
    if (slot >= _Count) return false;
    int idx = (int)(_Base + slot * max(_Stride, 1.));
    int gi = Index16(_AbyssLeafGroup, idx);
    int k = idx - (int)Group(gi, 3).y;
    lp = GrowGroupLeaf(gi, k);
    // thinning keeps every stem, as the web version does
    if (lp.type != 1 && fmod((float)k, thin) != 0.) return false;
  } else {
    float n = floor(slot / DOT_SLOTS);
    if (n >= _Count) return false;
    int di = (int)(_Base + n);
    if (fmod((float)di, thin) != 0.) return false;
    if (!GrowDotLeaf(Dot(di), di, (int)(slot - n * DOT_SLOTS), lp)) return false;
  }
  if (lp.type != 1) lp.wid *= (1. + log2(thin) * .5) * max(_WidthScale, 1.);
  return true;
}

// abyss-space vertex of side u (-1|1) at row parameter vr (0..1); false when not drawn
bool LeafVertex(LeafP lp, float u, float vr, bool shadowPass, out Leaf o) {
  o = (Leaf)0;
  float4 a = float4(lp.p, lp.len);
  if (!InBand(a.xyz)) return false;
  float tilt = lp.tilt, bend = lp.bend, wid = lp.wid, hA = lp.hA;
  int ty = lp.type; float s1 = lp.s1, s2 = lp.s2;
  float4 b = float4(lp.yaw, 0., 0., 0.);
  float v = sin(vr * 1.5708);
  float t = shadowPass ? 0. : Time();
  float len = a.w;
  float cy = cos(b.x), sy = sin(b.x), ct = cos(tilt), st = sin(tilt);
  float3 d = float3(st * cy, ct, st * sy), pe = float3(ct * cy, -st, ct * sy), sd = float3(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  float3 col = 0., spc = 0.; float4 pr = 0.; float2 shp = float2(.75, .7); float wav = 1., fls = 1.;
  float hsel = hs(s1 * 13.7 + s2 * 71.3);
  if (ty == 0) { col = lerp(float3(.11, .125, .022), float3(.04, .10, .04), s1); col = lerp(col, float3(.25, .17, .025), step(.72, s2)); pr = float4(.24, .9, 0., 0.); spc = pal(hsel * .72); shp = float2(.5, .32); wav = 1.9; }
  else if (ty == 1) { col = float3(.10, .11, .035); pr = float4(0., .2, 0., 0.); shp = float2(.05, .1); wav = .3; fls = .3; }
  else if (ty == 2) { col = lerp(float3(.05, .20, .16), float3(.12, .26, .22), s1); col = lerp(col, float3(.30, .14, .24), step(.85, s2)); pr = float4(.05, 1.0, .25, 0.); spc = float3(.6, 1., .9); shp = float2(.45, .35); wav = 2.2; }
  else if (ty == 3) { col = lerp(float3(.02, .05, .065), float3(.05, .03, .08), s1); col = lerp(col, float3(.09, .03, .09), step(.8, s2)); pr = float4(.2, .85, .55, .02); spc = lerp(float3(.5, .35, 1.), float3(.2, 1., .7), step(.6, hsel)); shp = float2(.7, .6); wav = 2.4; }
  else if (ty == 4) { col = lerp(float3(.30, .15, .02), float3(.42, .25, .04), s1); pr = float4(.2, 1., .1, 0.); spc = float3(1., .85, .5); shp = float2(.5, .4); wav = 1.8; }
  else if (ty == 5) { col = lerp(float3(.85, .05, .40), float3(.60, .10, .80), step(.7, s1)); col = lerp(col, float3(.95, .25, .55), step(.75, s2)); pr = float4(.22, .8, 0., .30); spc = float3(1., .35, .8); shp = float2(.6, .6); fls = 2.; }
  else if (ty == 6) { col = lerp(float3(.80, .16, .16), float3(.92, .36, .42), s1); pr = float4(.06, 1., 0., .10); spc = float3(1., .5, .5); shp = float2(.4, .3); wav = 2.; }
  else { col = lerp(float3(.05, .40, .36), float3(.10, .52, .58), s1); pr = float4(.1, .9, .2, .04); spc = float3(.3, 1., .9); shp = float2(.6, .5); }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + b.x), pr.x);
  float k = (bend - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  float wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  float wv = sin(wph) * .12 * wav;
  float kq = k * 1.7; float ka = abs(kq) < .06 ? .06 : kq;
  float sK = sin(ka * v), cK = cos(ka * v);
  float3 c = a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  float sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  float3 N = normalize(pe * cK - d * sl), T0 = normalize(d * cK + pe * sl);
  float tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  float3 S = sd * cos(tw) + N * sin(tw), N2 = N * cos(tw) - sd * sin(tw);
  float shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  float3 cam = CamPos();
  float cd = distance(a.xyz, cam), far = _Far * Det();
  float nearK = shadowPass ? 0. : 1. - ss(26., 40., cd);
  float farK = shadowPass ? 1. : (1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, cam)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(a.xyz + d * (len * .5), cam));
  float ruf = sin(v * 10. + s2 * 30. + t * .6) * wid * .36 * u * shape2(v) * nearK;
  float hw = shadowPass ? (ty == 1 ? 0. : max(wid * .5, .09) * shape) : wid * .5 * shape;
  float3 p = c + S * (u * farK * hw);
  p += N2 * ruf;
  float2 sw = sway(a.xz, hA + (p.y - a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.p = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK);
  o.col = col; o.pr = pr; o.sd = float2(s1, s2); o.spc = spc;
  return true;
}

v2f vert(appdata v) {
  v2f o;
  UNITY_SETUP_INSTANCE_ID(v);
  UNITY_INITIALIZE_OUTPUT(v2f, o);
  UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
  Leaf L; LeafP lp;
  if (!SlotLeaf(v.uv.y, lp) || !LeafVertex(lp, v.uv.z, v.uv.w, false, L)) { o.pos = ABYSS_COLLAPSE; return o; }
  o.pos = AbyssClip(L.p); o.wp = L.p; o.n = L.n; o.uv = float2(v.uv.z, sin(v.uv.w * 1.5708));
  o.col = L.col; o.pr = L.pr; o.sd = L.sd; o.spc = L.spc;
  return o;
}

float4 frag(v2f i, float facing : VFACE) : SV_Target {
  UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
  float3 cam = CamPos();
  float dist = length(i.wp - cam);
  float ca = caus2(i.wp, dist);
  float3 n = normalize(i.n); if (facing < 0.) n = -n;
  float3 V = normalize(cam - i.wp); float3 L = ABYSS_SUN;
  float z = zone(i.wp);
  float4 lt = _AbyssDetail.Sample(sampler_AbyssDetail, float2(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  float4 vv = vol(i.wp + float3(0., .8, 0.));
  float3 E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  float ndl = dot(n, L);
  float3 alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * lerp(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  float ndv = sat(dot(n, V));
  float3 ir = .5 + .5 * cos(TAU * (float3(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = lerp(alb, alb * .5 + ir * float3(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  float tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  float3 trc = alb * lerp((float3)1., float3(1.5, 1.4, .75), sat(i.pr.y) * (1. - i.pr.z));
  float aov = sat((vv.r - .5) * 6.) * lerp(.4, 1., i.uv.y);
  float3 am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * float3(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov);
  float3 c = E * (.06 + ca * 1.5) * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  float3 H = normalize(V + L);
  c += E * (pow(sat(dot(n, H)), 40.) * (.45 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * trc * i.pr.y * pow(sat(dot(-V, L)), 3.) * 1.2;
  c += alb * i.pr.w * (.5 + 3. * dot(am + E * .3, float3(.1, .5, .5)));
  // sparkle: whole-leaf glints that twinkle slowly
  float tw = pow(.5 + .5 * sin(Time() * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  float m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  float lit = .35 + E.g * 1.2;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  return fin(fog(c, i.wp, z));
}

struct v2fd { float4 pos : SV_POSITION; UNITY_VERTEX_OUTPUT_STEREO };
v2fd vertDepth(appdata v) {
  v2fd o;
  UNITY_SETUP_INSTANCE_ID(v);
  UNITY_INITIALIZE_OUTPUT(v2fd, o);
  UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
  Leaf L; LeafP lp;
  o.pos = SlotLeaf(v.uv.y, lp) && LeafVertex(lp, v.uv.z, v.uv.w, false, L) ? AbyssClip(L.p) : ABYSS_COLLAPSE;
  return o;
}
float4 fragDepth(v2fd i) : SV_Target { return 0.; }
#endif
