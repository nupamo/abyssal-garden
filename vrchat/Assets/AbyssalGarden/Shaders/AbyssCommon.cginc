// Abyssal Garden for Unity (built-in render pipeline, VRChat): the shared scene code.
// A port of S_G / S_B in source/src/shaders.js. Keep the two in step.
//
// Spaces: the original world ("abyss space") is right-handed, Unity left-handed: a Unity position is the abyss one with z
// negated (the view stays the same). All lighting runs in abyss space; AbyssFlip() converts a point or direction between
// the two (it is its own inverse). Instance data is in abyss
// space, meshes the exporter wrote in Unity space (terrain) are converted on the way in.
#ifndef ABYSS_COMMON_INCLUDED
#define ABYSS_COMMON_INCLUDED

#include "UnityCG.cginc"
#include "AbyssConfig.cginc"

#define TAU 6.2831853

static const float3 SIG = float3(.058, .0235, .0195);
static const float3 KD = float3(.056, .0245, .0170);
static const float3 WCOL = float3(.16, .58, .90);
static const float3 KDZ = float3(.034, .023, .018);
static const float3 PCOL = float3(.58, .66, .98);
static const float3 SUNC = float3(1.7, 1.6, 1.45);
static const float3 KDF = float3(.043, .045, .042);
static const float2 PURPLE = float2(6., 84.);

Texture2D _AbyssWater;   SamplerState sampler_AbyssWater;   // animated caustics + surface slope (CustomRenderTexture, repeat, mips)
Texture2D _AbyssDetail;  SamplerState sampler_AbyssDetail;  // rock detail (repeat, mips, aniso)
Texture3D _AbyssVolume;                                     // r openness, g skylight
Texture2D _AbyssGround;                                     // r magenta cover, b purple zone, a sand
Texture2D _AbyssShadow;                                     // baked sun depth, 16 bit
Texture2D _AbyssInst;                                       // instance records, RGBA32F, 4096 texels per row
SamplerState abyss_linear_clamp_sampler;
SamplerState abyss_point_clamp_sampler;

float _Base, _Count;   // per renderer (MaterialPropertyBlock): first instance and how many
float _MinD, _MaxD;    // per material: draw band (horizontal distance from the camera, scaled by _AbyssDetailScale)
float _AbyssDetailScale; // the web version's `det` (dynamic draw distance): 1 = full

float3 AbyssFlip(float3 v) { return float3(v.x, v.y, -v.z); }
float Det() { return _AbyssDetailScale > 0. ? _AbyssDetailScale : 1.; }

// camera, in abyss space (per eye in VR)
float3 CamPos() { return AbyssFlip(_WorldSpaceCameraPos.xyz); }
float3 CamRight() { return AbyssFlip(UNITY_MATRIX_V[0].xyz); }
float3 CamUp() { return AbyssFlip(UNITY_MATRIX_V[1].xyz); }
float3 CamFwd() { return AbyssFlip(-UNITY_MATRIX_V[2].xyz); }
float Time() { return _Time.y; }
// how far into the purple grotto the camera is (the web version's g.sun.w)
float CamZone() { float2 c = CamPos().xz - PURPLE; float t = saturate((44. - length(c)) / 18.); return t * t * (3. - 2. * t); }
float4 AbyssClip(float3 pA) { return UnityWorldToClipPos(AbyssFlip(pA)); }
// the cell centre of this renderer (celled renderers sit at their cell's centre), abyss space
float2 CellCentre() { return float2(unity_ObjectToWorld._m03, -unity_ObjectToWorld._m23); }

// instance records: N texels per instance
float4 Inst(float idx, int N, int j) { int t = (int)idx * N + j; return _AbyssInst.Load(int3(t & 4095, t >> 12, 0)); }
// a vertex that draws nothing
#define ABYSS_COLLAPSE float4(0., 0., -2., 1.)

float sat(float x) { return saturate(x); }
float ss(float a, float b, float x) { float t = saturate((x - a) / (b - a)); return t * t * (3. - 2. * t); }
float ign(float2 p) { return frac(52.9829189 * frac(dot(p, float2(.06711056, .00583715)))); }
float hs(float x) { return frac(sin(x * 127.1) * 43758.5453); }
float3 kd(float z) { return lerp(KD, KDZ, z); }
float3 sg(float z) { return lerp(SIG, float3(.034, .026, .022), z); }
float4 fin(float3 c) { return float4(min(max(c, (float3)0.), (float3)40.), 1.); }
float3 qrot(float4 q, float3 v) { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

float3 fogIn(float3 ro, float3 rd, float d, float z, float3 sun) {
  float3 k = lerp(KD, KDF, z);
  float3 a = sg(z) - k * rd.y;
  float3 I = (1. - exp(-a * d)) / a;
  float mu = max(dot(rd, sun), 0.);
  float m2 = mu * mu;
  return lerp(WCOL, PCOL, z) * sg(z) * exp(k * ro.y) * I * (1.22 + .3 * m2 * m2);
}

// ---------------------------------------------------------------- baked sun shadow
float3 shUV(float3 p) {
  float3 s = float3(dot(ABYSS_SM0, float4(p, 1.)), dot(ABYSS_SM1, float4(p, 1.)), dot(ABYSS_SM2, float4(p, 1.)));
  return float3(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007);
}
// one bilinear comparison tap (what a linear comparison sampler does)
float shTap(float2 uv, float z) {
  float2 t = uv * ABYSS_SHADOW_SIZE - .5, f = frac(t);
  float4 d = _AbyssShadow.GatherRed(abyss_point_clamp_sampler, (floor(t) + 1.) / ABYSS_SHADOW_SIZE);
  float4 c = step(z, d); // x (0,1), y (1,1), z (1,0), w (0,0)
  return lerp(lerp(c.w, c.z, f.x), lerp(c.x, c.y, f.x), f.y);
}
float shadow1(float3 p) { float3 s = shUV(p); return shTap(s.xy, s.z); }
float shadow4(float3 p) {
  float3 s = shUV(p); float e = 1.8 / ABYSS_SHADOW_SIZE;
  return (shTap(s.xy + float2(-e, -e), s.z) + shTap(s.xy + float2(e, -e), s.z) + shTap(s.xy + float2(-e, e), s.z) + shTap(s.xy + float2(e, e), s.z)) * .25;
}
float shadow9(float3 p) {
#if ABYSS_LOW
  return shadow1(p);
#else
  float3 s = shUV(p); float e = 2.1 / ABYSS_SHADOW_SIZE; float a = 0.;
  [unroll] for (int x = -1; x <= 1; x++) { [unroll] for (int y = -1; y <= 1; y++) { a += shTap(s.xy + float2(x, y) * e, s.z); } }
  return a / 9.;
#endif
}

// ---------------------------------------------------------------- light, water, fog
float4 tW(float2 uv) { return _AbyssWater.Sample(sampler_AbyssWater, uv); }
float2 cuv(float3 p) { return p.xz - ABYSS_SUN.xz * (p.y / ABYSS_SUN.y); }
float3 caus(float3 p, float d) {
  float2 q = cuv(p);
  float2 o = float2(.004, .0025);
  float3 a = float3(tW(q / 3.3 + o).r, tW(q / 3.3).r, tW(q / 3.3 - o).r);
  float b = tW(q.yx / 6.9 + .37).r;
  float3 c = min(pow(a, (float3)2.3) * 5. * (.45 + b * 1.3), (float3)4.);
  return lerp(c, (float3).33, ss(35., 100., d));
}
float caus2(float3 p, float d) {
  float2 q = cuv(p);
  float c = min(pow(tW(q / 4.1).r, 1.4) * 2.6 * (.45 + tW(q.yx / 6.9 + .37).r * 1.3), 2.6);
  return lerp(c, (float3).33, ss(35., 100., d));
}
float3 sunE(float y, float z) { return SUNC * exp(kd(z) * (min(y, 0.) / ABYSS_SUN.y)) * (.5 + .5 * sat(-y / 30.)); }
float4 vol(float3 p) { return _AbyssVolume.SampleLevel(abyss_linear_clamp_sampler, (p - float3(-192., -56., -192.)) / float3(384., 60., 384.), 0.); }
float3 amb(float3 p, float3 n, float sky, float z) {
  float up = n.y * .5 + .5;
  return lerp(float3(.22, .60, .80), float3(.34, .56, .82), z) * exp(kd(z) * min(p.y, 0.) * 1.2) * (.3 + .7 * sky) * (.24 + .76 * up * up) * 1.3 * (.55 + .45 * sat(-p.y / 30.)) + float3(.003, .010, .016);
}
float4 ground(float3 p) { return _AbyssGround.SampleLevel(abyss_linear_clamp_sampler, p.xz / 384. + .5, 0.); }
float zone(float3 p) { return lerp(CamZone(), ground(p).b, .2); }
float3 side(float3 p, float3 n, float open, float z) { return lerp(WCOL, PCOL, z) * exp(kd(z) * min(p.y, 0.)) * open * (1. - abs(n.y)) * .7; }
// skylight at most 150 m along the ray: past that, terrain and the backdrop behind it get the same haze
float3 fog(float3 c, float3 wp, float z) {
  float3 cam = CamPos();
  float3 v = wp - cam; float d = length(v); float3 rd = v / d;
  return c * exp(-sg(z) * d) * ss(230., 185., d) + fogIn(cam, rd, d, z, ABYSS_SUN) * (.58 + .42 * vol(cam + rd * min(d, 150.)).g);
}

// draw band test for an instance at abyss position p (the web version culls whole cells by distance; here each instance
// checks itself, so the bands of one cell never overlap)
bool InBand(float3 p) {
  float d = length(p.xz - CamPos().xz) / Det();
  return d >= _MinD && d < _MaxD;
}

#endif
