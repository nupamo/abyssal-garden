// Fish schools and manta rays, animated entirely in the vertex shader. A port of W_ANIM (source/src/shaders.js).
// Template mesh: the fish or manta mesh repeated, uv = (span coordinate, slot). Instance records (2 texels):
// fish (centre x, y, z, orbit radius), (seed, angular speed, size, phase); manta (centre, radius), (phase, speed, size, seed).
#ifndef ABYSS_ANIM_INCLUDED
#define ABYSS_ANIM_INCLUDED
#include "AbyssCommon.cginc"

struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; float4 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
struct v2f {
  float4 pos : SV_POSITION; float3 wp : TEXCOORD0; float3 n : TEXCOORD1; float3 op : TEXCOORD2;
  nointerpolation float sd : TEXCOORD3; float lt : TEXCOORD4;
  UNITY_VERTEX_OUTPUT_STEREO
};

bool FishVertex(appdata v, out v2f o) {
  o = (v2f)0;
  if (v.uv.y >= _Count) return false;
  float idx = _Base + v.uv.y;
  float4 a = Inst(idx, 2, 0), b = Inst(idx, 2, 1);
  float s = b.x; float3 h = float3(hs(s), hs(s + .37), hs(s + .71));
  float R = a.w; float t = Time();
  float ta = t * b.y + b.w * 6.3 + (h.x - .5) * (26. / R);
  float ph = b.w * 17.;
  float3 P = a.xyz + float3(R * cos(ta), 2.2 * sin(3. * ta + ph), R * .6 * sin(ta));
  float3 T = normalize(float3(-R * sin(ta), 6.6 * cos(3. * ta + ph), R * .6 * cos(ta))) * sign(b.y);
  float3 S = normalize(cross(float3(0., 1., 0.), T)); float3 Up = cross(T, S);
  float3 off = S * ((h.y - .5) * 5. + sin(t * .6 + s * 40.) * .5) + Up * ((h.z - .5) * 3.2 + cos(t * .5 + s * 31.) * .4);
  float3 l = v.vertex.xyz * b.z * (.75 + .5 * h.z);
  l.z += sin(t * 9. + s * 50. + l.x * 5.) * .22 * (.25 * b.z - l.x);
  float3 w = P + off + T * l.x + Up * l.y + S * l.z;
  o.wp = w; o.n = T * v.normal.x + Up * v.normal.y + S * v.normal.z; o.op = v.vertex.xyz; o.sd = s;
  o.lt = shadow1(w);
  return true;
}
float4 fragFish(v2f i) : SV_Target {
  UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
  float3 cam = CamPos();
  float3 n = normalize(i.n); float3 L = ABYSS_SUN; float3 V = normalize(cam - i.wp);
  float z = zone(i.wp); float4 vv = vol(i.wp);
  float3 alb = lerp(float3(.50, .68, .80), float3(.10, .22, .40), ss(-.05, .2, i.op.y));
  alb = lerp(alb, float3(.95, .8, .3), step(.86, frac(i.sd * 7.7)) * .6);
  float3 E = sunE(i.wp.y, z) * i.lt;
  float3 c = alb * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += E * pow(sat(dot(n, normalize(V + L))), 24.) * 1.6 + float3(.3, .6, .7) * pow(1. - sat(dot(n, V)), 3.) * .25 * vv.g;
  return fin(fog(c, i.wp, z));
}

bool MantaVertex(appdata v, out v2f o) {
  o = (v2f)0;
  if (v.uv.y >= _Count) return false;
  float idx = _Base + v.uv.y;
  float4 a = Inst(idx, 2, 0), b = Inst(idx, 2, 1);
  float t = Time(); float R = a.w; float sz = b.z;
  float ta = t * b.y + b.x;
  float3 P = a.xyz + float3(R * cos(ta), 2.5 * sin(2. * ta + b.w), R * .75 * sin(ta));
  float3 T = normalize(float3(-R * sin(ta), 5. * cos(2. * ta + b.w), R * .75 * cos(ta))) * sign(b.y);
  float3 S = normalize(cross(float3(0., 1., 0.), T)); float3 Up = cross(T, S);
  float bank = -.28 * sign(b.y);
  float3 S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  float u = v.uv.x; float au = abs(u);
  float fp = t * 1.25 + b.w * 5. - au * 1.2;
  float amp = .36 * pow(au, 1.6);
  float3 l = v.vertex.xyz;
  l.y += amp * sin(fp) - .1 * sin(t * 1.25 + b.w * 5.);
  float tail = ss(-.5, -1.9, l.z) * step(au, .001);
  l.x += tail * sin(t * .8 + l.z * 2.) * .12;
  float sl = (.576 * pow(au, .6) * sin(fp) - .43 * pow(au, 1.6) * cos(fp)) * sign(u);
  float3 ln = normalize(float3(v.normal.x - sl * v.normal.y, v.normal.y + sl * v.normal.x, v.normal.z));
  float3 w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = v.vertex.xyz; o.sd = b.w;
  o.lt = 1.;
  return true;
}
float4 fragManta(v2f i) : SV_Target {
  UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
  float3 cam = CamPos();
  float dist = length(i.wp - cam);
  float3 ca = caus(i.wp, dist);
  float4 tx = _AbyssDetail.Sample(sampler_AbyssDetail, i.op.xz * .9 + i.sd);
  float3 n = normalize(i.n + (float3(tx.r, 0., tx.g) - float3(.5, 0., .5)) * .5); float3 L = ABYSS_SUN; float3 V = normalize(cam - i.wp);
  float z = zone(i.wp); float4 vv = vol(i.wp);
  float top = ss(-.2, .25, normalize(i.n).y);
  float au = abs(i.op.x);
  float gill = ss(.25, .0, abs(au - .13) * 8.) * ss(.04, .12, i.op.z) * ss(.34, .26, i.op.z) * ss(.2, .8, sin(i.op.z * 110.));
  float3 belly = float3(.13, .17, .21) * (.6 + .6 * tx.b) * (1. - .7 * gill);
  belly = lerp(belly, float3(.05, .08, .11), sat(ss(.45, .9, au + tx.a * .35) + ss(-.1, -.4, i.op.z + tx.b * .2) * .7));
  float3 back = float3(.04, .065, .10) + float3(.10, .16, .2) * ss(.5, .75, tx.a);
  back = lerp(back, float3(.36, .46, .52), ss(.25, .0, abs(au - .26) * 3.5 + abs(i.op.z - .12) * 5.) * .8);
  float3 alb = lerp(belly, back, top);
  float3 E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  float ndv = sat(dot(n, V));
  float3 ir = .5 + .5 * cos(TAU * (float3(0., .33, .67) + ndv * 1.1 + tx.a * 1.5 + .55));
  float3 fillN = float3(n.x, abs(n.y) * .55 + .25, n.z);
  float3 c = alb * (E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8);
  c += ir * float3(.35, .16, .6) * (.07 + .22 * tx.b) * (.4 + E.g * .2 * ca.g) * (1. - top * .3);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .5 * (.3 + ca);
  float3 sky = amb(i.wp, float3(0., 1., 0.), vv.g, z);
  c += alb * sky * ca * .45 * (1. - top) + sky * pow(1. - ndv, 3.) * .35;
  return fin(fog(c, i.wp, z));
}

#ifdef ABYSS_MANTA
  #define ANIM_VERTEX MantaVertex
#else
  #define ANIM_VERTEX FishVertex
#endif
v2f vert(appdata v) {
  v2f o;
  UNITY_SETUP_INSTANCE_ID(v);
  if (!ANIM_VERTEX(v, o)) o.pos = ABYSS_COLLAPSE; else o.pos = AbyssClip(o.wp);
  UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
  return o;
}
float4 fragDepth(v2f i) : SV_Target { return 0.; }
#endif
