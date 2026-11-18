// Abyssal Garden: the terrain, water surface and backdrop, raymarched. Draw it on a sphere with huge bounds (it wraps
// the sphere around the camera) before the other opaque objects: it writes depth, so the rasterized plants, rocks and
// fish sit in it correctly.
//
// The terrain is a signed distance field baked from the web version's density grid (vrchat/exporter/sdf.mjs):
// _AbyssSDF, the full 0.75 m grid, holds the distance near the surface (+-ABYSS_SDF_NEAR m, 8 bit); _AbyssSDFFar, 3 m
// blocks, a lower bound of the distance further out, for long steps. Shading is the terrain material of AbyssSolid.
Shader "Abyssal Garden/Raymarch Terrain" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssDetail ("Rock detail", 2D) = "gray" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssSDF ("Terrain SDF (near)", 3D) = "" {}
    _AbyssSDFFar ("Terrain SDF (far)", 3D) = "" {}
    _MaxSteps ("Max steps", Range(32, 400)) = 256
  }
  CGINCLUDE
  #include "AbyssSolid.cginc"
  #include "AbyssSea.cginc"
  Texture3D _AbyssSDF, _AbyssSDFFar;
  float _MaxSteps;
  static const float3 GO = float3(-192., -56., -192.), GN = float3(512., 80., 512.);
  static const float GV = .75;

  // distance to rock (> 0 in water), abyss space; far from the surface a cheaper lower bound
  float SDF(float3 p) {
    float3 g = (p - GO) / GV;
    float n = (_AbyssSDF.SampleLevel(abyss_linear_clamp_sampler, (g + .5) / GN, 0.).r * 2. - 1.) * ABYSS_SDF_NEAR;
    if (n < ABYSS_SDF_NEAR * .9) return n;
    int3 b = clamp(int3(floor(g / 4.)), (int3)0, int3(GN / 4.) - 1);
    return max(_AbyssSDFFar.Load(int4(b, 0)).r * ABYSS_SDF_FAR, ABYSS_SDF_NEAR * .5);
  }
  float3 SDFNormal(float3 p) {
    const float e = .45;
    return normalize(float3(SDF(p + float3(e, 0., 0.)) - SDF(p - float3(e, 0., 0.)), SDF(p + float3(0., e, 0.)) - SDF(p - float3(0., e, 0.)), SDF(p + float3(0., 0., e)) - SDF(p - float3(0., 0., e))));
  }
  // first hit along the ray within the grid and 240 m (the web version's terrain draw distance)
  bool March(float3 ro, float3 rd, out float t) {
    float3 lo = (GO - ro) / rd, hi = (GO + GN * GV - ro) / rd;
    float t0 = max(max(min(lo.x, hi.x), min(lo.y, hi.y)), min(lo.z, hi.z));
    float t1 = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));
    t = max(t0, 0.); float tEnd = min(t1, 240.);
    bool hit = false;
    [loop] for (int i = 0; i < (int)_MaxSteps; i++) {
      if (t > tEnd) break;
      float s = SDF(ro + rd * t);
      if (s < .002 * t + .005) { hit = true; break; }
      t += s * .9;
    }
    if (hit) { t += SDF(ro + rd * t); t += SDF(ro + rd * t); } // two secant steps onto the surface
    return hit;
  }
  float ClipDepth(float3 pA) { float4 c = UnityWorldToClipPos(AbyssFlip(pA)); return c.z / c.w; }
  #if UNITY_REVERSED_Z
    #define FAR_DEPTH 0.
  #else
    #define FAR_DEPTH 1.
  #endif

  struct appdata_rm { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
  struct v2f_rm { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
  v2f_rm vertRM(appdata_rm v) {
    v2f_rm o;
    UNITY_SETUP_INSTANCE_ID(v);
    UNITY_INITIALIZE_OUTPUT(v2f_rm, o);
    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
    float3 d = normalize(v.vertex.xyz);
    o.pos = UnityWorldToClipPos(_WorldSpaceCameraPos.xyz + d);
    o.dir = AbyssFlip(d);
    return o;
  }
  ENDCG
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry-100" "DisableBatching" = "True" "IgnoreProjector" = "True" }
    Pass {
      Cull Front
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vertRM
      #pragma fragment frag
      float4 frag(v2f_rm i, out float depth : SV_Depth) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 rd = normalize(i.dir), ro = CamPos();
        float t; bool hit = March(ro, rd, t);
        float tS = rd.y > 1e-4 ? -ro.y / rd.y : 1e9;
        // everything is shaded and then one is picked: texture sampling (derivatives) must not sit in branches
        float3 p = ro + rd * t, n = SDFNormal(p);
        SolidIn si; si.wp = p; si.n = n; si.op = p; si.on = n; si.m = float4(0., 0., 1., 0.); si.q = float4(0., 0., 0., 1.); si.ao = 1.;
        float4 cT = ShadeSolid(si, 1.);
        float3 ps = ro + rd * min(tS, 2000.);
        float4 cS = ShadeSurface(ps), cB = ShadeBackdrop(rd);
        if (hit && t < tS) { depth = ClipDepth(p); return cT; }
        if (tS < 1e8) { depth = ClipDepth(ps); return cS; }
        depth = FAR_DEPTH; return cB;
      }
      ENDCG
    }
    // depth texture (light shafts)
    Pass {
      Tags { "LightMode" = "ShadowCaster" }
      Cull Front
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vertRM
      #pragma fragment fragDepthRM
      float4 fragDepthRM(v2f_rm i, out float depth : SV_Depth) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 rd = normalize(i.dir), ro = CamPos();
        float t; bool hit = March(ro, rd, t);
        float tS = rd.y > 1e-4 ? -ro.y / rd.y : 1e9;
        depth = hit && t < tS ? ClipDepth(ro + rd * t) : tS < 1e8 ? ClipDepth(ro + rd * tS) : FAR_DEPTH;
        return 0.;
      }
      ENDCG
    }
  }
}
