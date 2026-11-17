// Abyssal Garden: rising bubbles (premultiplied alpha, pass "Bubbles") and drifting particles (additive, pass "Snow").
// A port of W_SPR. One shader, two materials: the importer sets _Mode (0 bubbles, 1 snow) and the matching blend.
// Bubbles (2 texels): (vent x, y, z, size), (seed, rise speed, height to the surface, wobble).
// Snow (1 texel): (x, y, z, size) in 0..1, wrapped around the camera in a 44 m box.
Shader "Abyssal Garden/Sprites" {
  Properties {
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssInst ("Instances", 2D) = "black" {}
    [Enum(Bubbles, 0, Snow, 1)] _Mode ("Mode", Float) = 0
    [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Destination blend", Float) = 10
  }
  SubShader {
    Tags { "RenderType" = "Transparent" "Queue" = "Transparent+10" "IgnoreProjector" = "True" "DisableBatching" = "True" }
    Pass {
      Blend One [_DstBlend]
      ZWrite Off
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssCommon.cginc"
      float _Mode;
      struct appdata { float4 vertex : POSITION; float4 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
      struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; nointerpolation float4 pr : TEXCOORD1; float3 wp : TEXCOORD2; UNITY_VERTEX_OUTPUT_STEREO };
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        if (v.uv.y >= _Count) { o.pos = ABYSS_COLLAPSE; return o; }
        float idx = _Base + v.uv.y; float2 q = v.uv.zw; float t = Time(); float3 cam = CamPos();
        if (_Mode < .5) {
          float4 a = Inst(idx, 2, 0), b = Inst(idx, 2, 1);
          float life = frac(t * b.y / b.z + b.x);
          float h = life * b.z;
          float3 p = a.xyz + float3(0., h, 0.);
          float wob = b.w * (.3 + h * .035);
          p.x += sin(t * 1.7 + b.x * 50. + h * .6) * wob + sin(h * .13 + b.x * 9.) * b.w * 2.;
          p.z += cos(t * 1.3 + b.x * 33. + h * .5) * wob + cos(h * .11 + b.x * 7.) * b.w * 2.;
          float sz = a.w * (.55 + .7 * life) * ss(0., .03, life) * ss(0., -1.2, p.y);
          float3 w = p + (CamRight() * q.x + CamUp() * q.y) * sz;
          o.pos = AbyssClip(w); o.uv = q; o.wp = p;
          o.pr = float4(b.x, sz, shadow1(p), 0.);
        } else {
          float4 a = Inst(idx, 1, 0);
          float B = 44.;
          float3 p = a.xyz * B + float3(t * .22, t * .05, t * .13) + .5 * float3(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
          p = cam + (frac((p - cam) / B + .5) - .5) * B;
          float d = length(p - cam);
          float sz = (.012 + .045 * a.w * a.w * a.w);
          float3 w = p + (CamRight() * q.x + CamUp() * q.y) * max(sz, d * .0011);
          o.pos = AbyssClip(w); o.uv = q; o.wp = p;
          float fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * ss(-.3, -1.5, p.y);
          float tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
          o.pr = float4(fade * tw, shadow1(p), a.w, d);
        }
        return o;
      }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 cam = CamPos(); float t = Time();
        float z = zone(i.wp);
        if (_Mode > .5) {
          float r = length(i.uv);
          float m = ss(1., .2, r);
          float3 c = (sunE(i.wp.y, z) * i.pr.y * .8 + amb(i.wp, float3(0., 1., 0.), 1., z) * .3) * lerp((float3)1., float3(.7, 1., .9), i.pr.z);
          return float4(min(max(c * m * m * i.pr.x * exp(-SIG.g * i.pr.w), (float3)0.), (float3)8.), 0.);
        }
        float an = atan2(i.uv.y, i.uv.x + 1e-4);
        float big = ss(.04, .22, i.pr.y);
        float r = length(i.uv) / (.9 + big * .05 * sin(an * 3. + t * 5. + i.pr.x * 40.) + big * .02 * sin(an * 5. - t * 7.));
        float aa = fwidth(r) * 1.5;
        float disc = 1. - ss(1. - aa, 1., r);
        float rim = ss(.55, .98, r);
        float hl = ss(.34, .0, length(i.uv - float2(-.36, .42))) + .5 * ss(.2, .0, length(i.uv - float2(.4, -.42)));
        float3 E = sunE(i.wp.y, z) * (.25 + .75 * i.pr.z);
        float3 hi = fogIn(i.wp, float3(0., 1., 0.), 80., z, ABYSS_SUN) * 1.5;
        float3 lo = fogIn(i.wp, float3(0., -1., 0.), 80., z, ABYSS_SUN);
        float3 c = lerp(lo, hi, ss(-.5, .8, i.uv.y + rim * .4)) * (.5 + 1.2 * rim) + E * hl * 1.6;
        float al = disc * sat(.03 + rim * rim * rim * .9 + hl);
        float3 v = i.wp - cam; float d = length(v);
        float T = exp(-SIG.g * d) * ss(1.2, 3., d);
        c = c * T + fogIn(cam, v / d, d, z, ABYSS_SUN) * (1. - T);
        al *= lerp(.35, 1., T);
        return float4(min(max(c * al, (float3)0.), (float3)20.), al);
      }
      ENDCG
    }
  }
}
