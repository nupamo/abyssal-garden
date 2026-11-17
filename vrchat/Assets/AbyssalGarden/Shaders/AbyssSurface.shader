// Abyssal Garden: the water surface seen from below (pass 1) and the backdrop behind everything (pass 2).
// A port of W_SURF. Draw it on a mesh with huge bounds (the importer's "Surface" object): the vertex shader ignores the
// mesh except for its uv, which picks the corner, and builds the geometry around the camera.
Shader "Abyssal Garden/Surface" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
  }
  CGINCLUDE
  #include "AbyssCommon.cginc"
  struct appdata { float4 vertex : POSITION; float4 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
  struct v2f { float4 pos : SV_POSITION; float3 wp : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
  ENDCG
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry+30" "DisableBatching" = "True" "IgnoreProjector" = "True" }
    // the surface: a 1.8 km square at y = 0 that follows the camera
    Pass {
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        float3 cam = CamPos(); float2 p = v.uv.zw;
        o.wp = float3(cam.x + p.x * 900., 0., cam.z + p.y * 900.);
        o.pos = AbyssClip(o.wp);
        return o;
      }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 cam = CamPos();
        float3 v = i.wp - cam; float d = length(v); float3 V = v / d;
        float fl = ss(260., 60., d);
        float2 s = (tW(i.wp.xz / 13.).ba + tW(i.wp.zx / 4.7 + .2).ba * .7 + tW(i.wp.xz / 37. + .6).ba * .8) * fl;
        float3 n = normalize(float3(-s.x * .8, -1., -s.y * .8));
        float ci = sat(dot(V, -n));
        float k = 1. - 1.769 * (1. - ci * ci);
        float win = ss(0., .22, k);
        float3 rr = refract(V, n, 1.33);
        float sd = max(dot(rr, ABYSS_SUN), 0.);
        float fr = pow(1. - sqrt(max(k, 0.)), 5.);
        float3 sky = (float3(.30, .78, 1.) * 1.3 * clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.) + float3(1., .95, .85) * (pow(sd, 60.) * 1.3 + pow(sd, 500.) * 12.)) * (1. - fr);
        float z = zone(i.wp);
        float3 R = reflect(V, n);
        float3 refl = fogIn(i.wp, R, 300., z, ABYSS_SUN) * 1.15;
        float3 c = lerp(refl, sky, win);
        return fin(fog(c, i.wp, z));
      }
      ENDCG
    }
  }
}
