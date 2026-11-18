// Grows leaves and glints from the placement records (vrchat/exporter/grow.mjs): a line-by-line mirror of that file's
// reference grower, which verify-grow.mjs checks against the web version's own leaves. Change both together.
#ifndef ABYSS_GROW_INCLUDED
#define ABYSS_GROW_INCLUDED
#include "AbyssCommon.cginc"

Texture2D _AbyssGroups;      // RGBA32F, 4 texels per group
Texture2D _AbyssLeafGroup;   // R16: group of each leaf
Texture2D _AbyssGlintGroup;  // R16: group of each glint
Texture2D _AbyssDots;        // RGBAHalf: ground-cover spots, relative to their cell's centre
float _Stride;     // leaves per drawn leaf (2 for the far band, as the web version's every-2nd-leaf far set)
float _WidthScale; // wider leaves where fewer are drawn
float _Thin;       // 1 draws every leaf, 2 every 2nd, 4 every 4th (the web version's Medium / Low thinning)

#define DOT_SLOTS 6
#define KIND_COLUMN 0
#define KIND_CLUSTER 1
#define KIND_FROND 2
#define SALT_LEAF 0x1b873593u
#define SALT_DOT 0x68e31da4u
#define SALT_GLINT 0x2c1b3c6du

uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rnext(inout uint s) { s = hash(s + 0x9e3779b9u); return (s >> 8) * (1. / 16777216.); }
float rr(inout uint s, float a, float b) { return a + (b - a) * rnext(s); }

float4 Group(int gi, int j) { int t = gi * 4 + j; return _AbyssGroups.Load(int3(t & 4095, t >> 12, 0)); }
int Index16(Texture2D t, int i) { return (int)round(t.Load(int3(i & 4095, i >> 12, 0)).r * 65535.); }

struct LeafP { float3 p; float len, yaw, tilt, wid, hA; int type; float s1, s2, bend; };
LeafP MakeLeaf(float3 p, float len, float yaw, float tilt, float wid, float hA, int type, float s1, float s2, float bend) {
  LeafP l; l.p = p; l.len = len; l.yaw = yaw; l.tilt = tilt; l.wid = wid; l.hA = hA; l.type = type; l.s1 = s1; l.s2 = s2; l.bend = bend; return l;
}

// leaf k of group gi
LeafP GrowGroupLeaf(int gi, int k) {
  uint R = hash((((uint)gi << 16) | (uint)k) ^ SALT_LEAF);
  float4 t0 = Group(gi, 0), t1 = Group(gi, 1), t2 = Group(gi, 2), t3 = Group(gi, 3);
  float x = t0.x, y = t0.y, z = t0.z; int kind = (int)t0.w;
  if (kind == KIND_COLUMN) {
    float H = t1.x, ck = t1.y, strands = t1.z, ph = t1.w, tw = t2.x, sr = t2.y, sc = t2.z, la = t2.w, lm = t3.x, stems = t3.z;
    if (k < stems) { // the stems: strands of 2.1 m segments every 1.7 m
      float per = stems / strands, s = floor(k / per), h = (k - s * per) * 1.7;
      float a = ph + s * TAU / strands + h * tw, r = sr * (1. - .6 * h / H), ln = lm * h * h / H;
      float s1 = rnext(R), s2 = rnext(R);
      return MakeLeaf(float3(x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln), 2.1, a + UNITY_PI / 2., .1, .17, h, 1, s1, s2, .3);
    }
    float t = pow(rnext(R), .9), h = t * H;
    float a = ph + floor(rnext(R) * strands) * TAU / strands + h * tw, r = sr * (1. - .6 * h / H), ln = lm * h * h / H;
    float q1 = rnext(R), q2 = rnext(R);
    float L = ((.55 + .75 * q1 * q2) * (1. - .5 * t * t) * sc + .25) * (ck == 1. ? 1.25 : 1.15);
    float ta = rr(R, .4, 1.), tb = rr(R, .15, .45), tilt = ta * (1. - t) + tb * t;
    float u = rnext(R); int type = ck == 1. ? (u < .8 ? 3 : 4) : ck == 2. ? (u < .5 ? 4 : 0) : 0;
    float yaw = rnext(R) * TAU, wid = L * (ck == 1. ? rr(R, .09, .13) : rr(R, .15, .21)) + .03;
    float s1 = rnext(R), s2 = rnext(R), bend = rr(R, .38, .95);
    return MakeLeaf(float3(x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln), L, yaw, tilt, wid, h, type, s1, s2, bend);
  }
  if (kind == KIND_CLUSTER) {
    float a = rnext(R) * TAU, r = rnext(R) * .5, L = rr(R, t1.z, t1.w), tilt = rr(R, .05, t2.z), wid = rr(R, t2.x, t2.y);
    float s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .8);
    return MakeLeaf(float3(x + cos(a) * r, y - .15, z + sin(a) * r), L, a, tilt, wid, t2.w, (int)t1.y, s1, s2, bend);
  }
  if (kind == KIND_FROND) {
    float dx = rr(R, -.6, .6), dz = rr(R, -.6, .6), L = rr(R, .8, 3.2), yaw = rnext(R) * TAU, tilt = UNITY_PI - rr(R, 0., .4), wid = rr(R, .08, .18);
    int type = 0; if (t1.y > .3) type = 6; else if (rnext(R) < .5) type = 6;
    float s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .6);
    return MakeLeaf(float3(x + dx, y + .2, z + dz), L, yaw, tilt, wid, 0., type, s1, s2, bend);
  }
  // tuft
  float L = rr(R, .5, 1.4), yaw = t1.z + rr(R, -.9, .9), tilt = rr(R, .3, 1.1), wid = rr(R, .06, .12);
  int type = 0; if (t1.y > .4) { if (rnext(R) < .6) type = 3; }
  float s1 = rnext(R), s2 = rnext(R), bend = rr(R, .2, .6);
  return MakeLeaf(float3(x, y, z), L, yaw, tilt, wid, .5, type, s1, s2, bend);
}

// ground-cover spot di (abyss-space position + w, see grow.mjs), slot j; false when the slot grows nothing
bool GrowDotLeaf(float4 d, int di, int j, out LeafP l) {
  uint R = hash(((uint)di * 8u + (uint)j) ^ SALT_DOT);
  l = (LeafP)0;
  float x = d.x, y = d.y, z = d.z, w = d.w;
  if (w < 0.) {
    if (w > -6.) {
      if (j >= 4) return false;
      float dx = rr(R, -.1, .1), dz = rr(R, -.1, .1), L = rr(R, .12, .34), yaw = rnext(R) * TAU, tilt = rr(R, .05, .75), wid = rr(R, .04, .08), s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .7);
      l = MakeLeaf(float3(x + dx, y - .05, z + dz), L, yaw, tilt, wid, 0., 5, s1, s2, bend); return true;
    }
    if (j >= 3) return false;
    float dx = rr(R, -.1, .1), dz = rr(R, -.1, .1), L = rr(R, .25, .7), yaw = rnext(R) * TAU, tilt = rr(R, .1, .8), wid = rr(R, .05, .1), s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .8);
    l = MakeLeaf(float3(x + dx, y - .05, z + dz), L, yaw, tilt, wid, 0., 7, s1, s2, bend); return true;
  }
  float nl = floor(w / 10.), yw = w - nl * 10.;
  if (j < nl) {
    float L = rr(R, .08, .26), yaw = yw + j * TAU / nl + rr(R, -.4, .4), tilt = rr(R, .15, .85), wid = rr(R, .035, .07), s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .7);
    l = MakeLeaf(float3(x, y - .03, z), L, yaw, tilt, wid, 0., 5, s1, s2, bend); return true;
  }
  uint R7 = hash(((uint)di * 8u + 7u) ^ SALT_DOT);
  if (j < 4 || rnext(R7) >= .3) return false;
  float dx = rr(R, -.2, .2), dz = rr(R, -.2, .2), L = rr(R, .2, .55), yaw = rnext(R) * TAU, tilt = rr(R, .05, .6), wid = rr(R, .03, .06), s1 = rnext(R), s2 = rnext(R), bend = rr(R, .3, .8);
  l = MakeLeaf(float3(x + dx, y - .04, z + dz), L, yaw, tilt, wid, 0., 7, s1, s2, bend); return true;
}

// glints: a = (x, y, z, height), b = (seed, hue, size, -)
void GrowGroupGlint(int gi, int k, out float4 a, out float4 b) {
  uint R = hash((((uint)gi << 16) | (uint)k) ^ SALT_GLINT);
  float4 t0 = Group(gi, 0), t1 = Group(gi, 1), t2 = Group(gi, 2), t3 = Group(gi, 3);
  float H = t1.x, ck = t1.y, la = t2.w, lm = t3.x;
  float h = rnext(R) * H, an = rnext(R) * TAU, r = rr(R, .15, .8) * (1. - .5 * h / H), ln = lm * h * h / H;
  float seed = rnext(R), hue = ck == 1. ? rnext(R) : rnext(R) * .6, size = rr(R, .018, .05);
  a = float4(t0.x + cos(an) * r + cos(la) * ln, t0.y + h, t0.z + sin(an) * r + sin(la) * ln, h);
  b = float4(seed, hue, size, 0.);
}
bool GrowDotGlint(float4 d, int di, out float4 a, out float4 b) {
  uint R = hash(((uint)di * 8u + 6u) ^ SALT_GLINT);
  a = 0.; b = 0.;
  if (d.w < 0. || rnext(R) >= .3) return false;
  float dy = rr(R, .08, .22), seed = rnext(R), hue = .82 + rnext(R) * .18, size = rr(R, .01, .02);
  a = float4(d.x, d.y + dy, d.z, 0.); b = float4(seed, hue, size, 0.);
  return true;
}

float4 Dot(int di) {
  float4 d = _AbyssDots.Load(int3(di & 4095, di >> 12, 0));
  float2 c = CellCentre();
  return float4(d.x + c.x, d.y - 30., d.z + c.y, d.w);
}
#endif
