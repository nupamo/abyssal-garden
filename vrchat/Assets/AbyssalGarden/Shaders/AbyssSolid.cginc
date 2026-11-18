// Solid meshes: terrain, rocks, boulders, set pieces, sponges, coral. A port of W_SOLID (source/src/shaders.js).
// ABYSS_TERRAIN: an ordinary mesh in Unity space (the terrain cells). Otherwise: a template mesh whose vertices
// carry their instance slot in uv.y; the instance (3 texels: position + scale, rotation, material/seed/texture
// scale/bob) comes from _AbyssInst. _Compact: 2 half-float texels instead (position relative to the cell centre + 30 m
// up, scale; quaternion xyz, seed), with material and texture scale from the material (_Mat, _TexScale).
#ifndef ABYSS_SOLID_INCLUDED
#define ABYSS_SOLID_INCLUDED
#include "AbyssCommon.cginc"
float _Compact, _Mat, _TexScale;

struct appdata {
  float4 vertex : POSITION; float3 normal : NORMAL; float4 uv : TEXCOORD0; // uv: aux, slot
  UNITY_VERTEX_INPUT_INSTANCE_ID
};
struct v2f {
  float4 pos : SV_POSITION;
  float3 wp : TEXCOORD0; float3 n : TEXCOORD1; float3 op : TEXCOORD2; float3 on : TEXCOORD3;
  nointerpolation float4 m : TEXCOORD4; nointerpolation float4 q : TEXCOORD5; float ao : TEXCOORD6;
  UNITY_VERTEX_OUTPUT_STEREO
};

// abyss-space position of the vertex, or false when it is not drawn
bool SolidVertex(appdata v, out float3 w, out float3 n, out float3 op, out float3 on, out float4 m, out float4 q) {
#ifdef ABYSS_TERRAIN
  w = AbyssFlip(mul(unity_ObjectToWorld, float4(v.vertex.xyz, 1.)).xyz);
  n = AbyssFlip(v.normal); op = w; on = n; m = float4(0., 0., 1., 0.); q = float4(0., 0., 0., 1.);
  return true;
#else
  w = 0.; n = 0.; op = 0.; on = 0.; m = 0.; q = float4(0., 0., 0., 1.);
  if (v.uv.y >= _Count) return false;
  float idx = _Base + v.uv.y;
  float4 a, b, c;
  if (_Compact > .5) {
    float4 h0 = Inst(idx, 2, 0), h1 = Inst(idx, 2, 1); float2 cc = CellCentre();
    a = float4(h0.x + cc.x, h0.y - 30., h0.z + cc.y, h0.w);
    b = float4(h1.xyz, sqrt(saturate(1. - dot(h1.xyz, h1.xyz))));
    c = float4(_Mat, h1.w, _TexScale, 0.);
  } else { a = Inst(idx, 3, 0); b = Inst(idx, 3, 1); c = Inst(idx, 3, 2); }
  if (!InBand(a.xyz)) return false;
  float sc = a.w;
  // small rocks shrink away towards the end of their draw distance (c.z: that distance)
  if (c.x < 1.5 && c.z > 1.5) sc *= 1. - ss(c.z * .7, c.z, distance(a.xyz, CamPos()) / Det());
  w = a.xyz + qrot(b, v.vertex.xyz * sc);
  w.y += sin(Time() * .3 + c.y * 40.) * c.w;
  n = qrot(b, v.normal); op = v.vertex.xyz * a.w + c.y * 37.; on = v.normal; m = c; q = b;
  return true;
#endif
}

v2f vert(appdata v) {
  v2f o;
  UNITY_SETUP_INSTANCE_ID(v);
  UNITY_INITIALIZE_OUTPUT(v2f, o);
  UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
  float3 w, n, op, on; float4 m, q;
  if (!SolidVertex(v, w, n, op, on, m, q)) { o.pos = ABYSS_COLLAPSE; return o; }
  o.pos = AbyssClip(w); o.wp = w; o.n = n; o.op = op; o.on = on; o.m = m; o.q = q;
#ifdef ABYSS_TERRAIN
  o.ao = 1.;
#else
  o.ao = v.uv.x;
#endif
  return o;
}

struct TP { float h; float c; float3 n; };
TP tri(float3 p, float3 n, float s) {
  float3 w = pow(abs(n), (float3)4.); w /= (w.x + w.y + w.z);
  float4 x = _AbyssDetail.Sample(sampler_AbyssDetail, p.zy * s), y = _AbyssDetail.Sample(sampler_AbyssDetail, p.xz * s), z = _AbyssDetail.Sample(sampler_AbyssDetail, p.xy * s);
  TP o;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  float2 a = x.rg * 2. - 1., b = y.rg * 2. - 1., c = z.rg * 2. - 1.;
  o.n = float3(0., a.y, a.x) * w.x + float3(b.x, 0., b.y) * w.y + float3(c.x, c.y, 0.) * w.z;
  return o;
}
float4 D(float2 uv) { return _AbyssDetail.Sample(sampler_AbyssDetail, uv); }

// the surface to shade (abyss space): what the vertex shader passes on, or what the raymarcher found
struct SolidIn { float3 wp; float3 n; float3 op; float3 on; float4 m; float4 q; float ao; };

float4 ShadeSolid(SolidIn i, float facing) {
  int mat = (int)(i.m.x + .5); float sd = i.m.y; float fl_ = facing > 0. ? 1. : -1.;
  float3 cam = CamPos();
  float3 on = normalize(i.on) * fl_; float3 n0 = normalize(i.n) * fl_;
  float dist = length(i.wp - cam);
  float ts = mat >= 2 ? i.m.z : 1.;
  TP A = tri(i.op, on, .1 * ts); TP B = tri(i.op, on, .43 * ts); TP C = tri(i.op, on, 1.9 * ts); TP F = tri(i.op, on, 6.7 * ts);
  float fk = ss(10., 1.5, dist) * (mat <= 1 ? 1. : 0.);
  float4 Wd = D(float2(i.op.x * .06, (i.op.y + i.op.z) * .7));
  float big = D(i.op.xz * .013 + i.op.y * .021).a;
  float big2 = D(i.op.zx * .031 + i.op.y * .043 + .37).a;
  float sgro = 0.;
  float4 sk = D(float2((i.op.x + i.op.z) * .33, i.op.y * .035));
  float4 sk2 = D(float2((i.op.x - i.op.z) * 1.1, i.op.y * .11));
  float4 gm = ground(i.wp);
  float3 ca = caus(i.wp, dist);
  float hgt = A.h * .5 + B.h * .35 + C.h * .15;
  float bump = 1.7, gloss = .1, vao = 1., flu = 0.; float3 alb = 0., emi = 0.;
  float flt = ss(.72, .93, n0.y);
  if (mat <= 1) {
    // layered rock: grey / olive / brown beds, warm encrustation patches, algae on up-facing parts
    float st = i.op.y * .55 + A.h * 1.6 + big * 5. + big2 * 3.;
    float bed = hs(floor(st)); float sf = frac(st);
    alb = lerp(float3(.11, .12, .13), float3(.33, .30, .25), sat(A.c * 1.5 - .25));
    alb = lerp(alb, lerp(float3(.26, .19, .10), float3(.20, .22, .14), bed), ss(.42, .66, big) * .7);
    alb *= lerp(.72, 1.15, bed) * (1. - .45 * ss(.12, .0, sf) * (1. - abs(on.y)));
    float enc = ss(.46, .6, big2 * .6 + B.c * .5) * ss(.3, .6, hgt);
    alb = lerp(alb, lerp(float3(.34, .07, .10), float3(.40, .25, .07), ss(.45, .6, A.c)) * (.5 + .8 * B.h), enc * .75);
    alb = lerp(alb, float3(.50, .50, .46) * (.5 + .7 * C.h), ss(.60, .70, B.c * .6 + C.c * .5) * .5);
    float alg = ss(-.1, .6, n0.y) * ss(.3, .52, B.c * .55 + big * .5);
    alb = lerp(alb, float3(.035, .14, .07), alg * .8);
    alb *= (.22 + 1.3 * hgt) * lerp(1., .62 + .76 * F.h, fk);
    sgro = -ss(.14, .0, sf) * (1. - abs(on.y)) * 1.2;
    if (mat == 0) {
      alb = lerp(alb, float3(.13, .15, .14) * (.55 + .6 * B.h), flt * gm.a * .7);
      float mg = flt * sat(gm.r * 1.5 - .45 + (B.c - .5) * 1.6) * ss(.35, .6, A.h) * ss(-34., -40., i.wp.y);
      alb = lerp(alb, float3(.20, .02, .12) * (.4 + .9 * B.h), mg * .8);
      flu = mg * .35;
      alb = lerp(alb, alb * float3(.85, .8, 1.4) + float3(.015, .0, .05), gm.b * .8);
    }
  } else if (mat == 2) {
    // whale fluke: smooth pale stone with dark streaks running along its length
    alb = lerp(float3(.42, .47, .48), float3(.10, .13, .15), ss(.40, .62, sk.a * .6 + sk2.b * .5)) * (.75 + .3 * B.h);
    alb = lerp(alb, float3(.60, .64, .62), ss(.62, .75, sk2.a) * .5);
    gloss = .9; bump = .3;
  } else if (mat == 3) {
    // ship: planks
    alb = lerp(float3(.13, .085, .05), float3(.36, .25, .14), Wd.b) * (.6 + .5 * B.h);
    float pk = frac(atan2(i.op.z, 2. - i.op.y) * 7.);
    alb *= .35 + .65 * ss(0., .12, min(pk, 1. - pk));
    alb = lerp(alb, float3(.08, .22, .16), ss(.5, .7, A.c) * .6);
    gloss = .2; bump = .7;
  } else if (mat == 4) {
    // sponges
    float hue = frac(sd * 7.31);
    alb = lerp(float3(.60, .17, .08), float3(.64, .35, .10), frac(hue * 3.));
    if (hue > .75) alb = float3(.44, .18, .42);
    alb *= (.45 + .75 * B.h) * (.7 + .3 * C.h);
    vao = i.ao * i.ao; gloss = .2; bump = 1.4; flu = .55;
  } else {
    // coral
    float hue = frac(sd * 5.73);
    alb = lerp(float3(.80, .08, .10), float3(.90, .22, .40), frac(hue * 4.));
    if (hue > .7) alb = float3(.88, .42, .10);
    if (hue > .9) alb = float3(.55, .22, .75);
    alb *= (.4 + .8 * B.h) * (.5 + .9 * i.ao * i.ao);
    alb = lerp(alb, float3(1., .75, .6), ss(.8, 1., i.ao) * .35);
    emi = alb * .01; flu = .75; gloss = .25; bump = 1.5;
  }
  float rip = mat == 0 ? flt * gm.a * cos((i.wp.x * .8 + i.wp.z * .35) * 5. + A.c * 9.) * .65 : 0.;
  float3 N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump + float3(.8, sgro, .35) * float3(rip, 1., rip))));
  float3 L = ABYSS_SUN; float3 V = normalize(cam - i.wp);
  float4 v1 = vol(i.wp + n0 * 1.5), v2 = vol(i.wp + n0 * 4.5);
  float ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt);
  float z = zone(i.wp);
  float3 E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35);
  float ndl = sat(dot(N, L));
  float3 am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  float3 dl = E * ndl * (.10 + lerp((float3).33, ca, ss(.1, .45, dot(n0, L))) * 2.5);
  float3 c = alb * (dl + am) + emi + alb * flu * dot(dl + am, float3(.1, .5, .5));
  float3 H = normalize(V + L);
  c += E * (.25 + ca) * pow(sat(dot(N, H)), lerp(10., 70., gloss)) * gloss * ndl * 1.8;
  float3 R = reflect(-V, N);
  c += (amb(i.wp, R, v1.g, z) + side(i.wp, R, sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}

float4 frag(v2f v, float facing : VFACE) : SV_Target {
  UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(v);
  SolidIn i; i.wp = v.wp; i.n = v.n; i.op = v.op; i.on = v.on; i.m = v.m; i.q = v.q; i.ao = v.ao;
  return ShadeSolid(i, facing);
}

// depth only (camera depth texture for the light shafts)
struct v2fd { float4 pos : SV_POSITION; UNITY_VERTEX_OUTPUT_STEREO };
v2fd vertDepth(appdata v) {
  v2fd o;
  UNITY_SETUP_INSTANCE_ID(v);
  UNITY_INITIALIZE_OUTPUT(v2fd, o);
  UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
  float3 w, n, op, on; float4 m, q;
  o.pos = SolidVertex(v, w, n, op, on, m, q) ? AbyssClip(w) : ABYSS_COLLAPSE;
  return o;
}
float4 fragDepth(v2fd i) : SV_Target { return 0.; }
#endif
