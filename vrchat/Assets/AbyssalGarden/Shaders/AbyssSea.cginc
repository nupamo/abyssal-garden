// The water surface seen from below and the water beyond the draw distance (fs / fsB in W_SURF), as functions.
#ifndef ABYSS_SEA_INCLUDED
#define ABYSS_SEA_INCLUDED
#include "AbyssCommon.cginc"

// wp: a point on the surface (y = 0), abyss space
float4 ShadeSurface(float3 wp) {
  float3 cam = CamPos();
  float3 v = wp - cam; float d = length(v); float3 V = v / d;
  float fl = ss(260., 60., d);
  float2 s = (tW(wp.xz / 13.).ba + tW(wp.zx / 4.7 + .2).ba * .7 + tW(wp.xz / 37. + .6).ba * .8) * fl;
  float3 n = normalize(float3(-s.x * .8, -1., -s.y * .8));
  float ci = sat(dot(V, -n));
  float k = 1. - 1.769 * (1. - ci * ci);
  float win = ss(0., .22, k);
  float3 rr = refract(V, n, 1.33);
  float sd = max(dot(rr, ABYSS_SUN), 0.);
  float fr = pow(1. - sqrt(max(k, 0.)), 5.);
  float3 sky = (float3(.30, .78, 1.) * 1.3 * clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.) + float3(1., .95, .85) * (pow(sd, 60.) * 1.3 + pow(sd, 500.) * 12.)) * (1. - fr);
  float z = zone(wp);
  float3 R = reflect(V, n);
  float3 refl = fogIn(wp, R, 300., z, ABYSS_SUN) * 1.15;
  return fin(fog(lerp(refl, sky, win), wp, z));
}
// rd: view direction, abyss space
float4 ShadeBackdrop(float3 rd) {
  float3 p = CamPos() + rd * 240.;
  return fin(fog((float3)0., p, zone(p)));
}
#endif
