// Abyssal Garden: sparkling specks in the kelp and ground cover (additive). A port of vsGl / fsGl in W_LEAF.
// Grown from the placement records (AbyssGrow.cginc): _Mode 0 = kelp columns (slot -> glint _Base + slot),
// 1 = ground-cover spots (slot -> spot _Base + slot; 30% of the carpet tufts have one).
Shader "Abyssal Garden/Glint" {
  Properties {
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssGroups ("Plant groups", 2D) = "black" {}
    _AbyssGlintGroup ("Glint groups", 2D) = "black" {}
    _AbyssDots ("Ground-cover spots", 2D) = "black" {}
    _Mode ("Mode (0 kelp, 1 ground cover)", Float) = 0
    _MinD ("Band start (m)", Float) = 0
    _MaxD ("Band end (m)", Float) = 120
    _AbyssDetailScale ("Draw distance scale", Float) = 1
  }
  SubShader {
    Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "IgnoreProjector" = "True" "DisableBatching" = "True" }
    Pass {
      Blend One One
      ZWrite Off
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssGrow.cginc"
      float _Mode;
      float2 sway(float2 p, float h, float t) {
        float ph = dot(p, float2(.031, .017));
        float a = .024 * pow(max(h, 0.), 1.25);
        return a * (float2(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * float2(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
      }
      float3 pal(float h) {
        if (h < .3) return float3(1., .62, .08);
        if (h < .6) return float3(.12, 1., .22);
        if (h < .8) return float3(.2, .85, 1.);
        return float3(1., .3, .8);
      }
      struct appdata { float4 vertex : POSITION; float4 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
      struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; nointerpolation float3 col : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        if (v.uv.y >= _Count) { o.pos = ABYSS_COLLAPSE; return o; }
        int idx = (int)(_Base + v.uv.y);
        float4 a, b;
        if (_Mode < .5) { int gi = Index16(_AbyssGlintGroup, idx); GrowGroupGlint(gi, idx - (int)Group(gi, 3).w, a, b); }
        else if (!GrowDotGlint(Dot(idx), idx, a, b)) { o.pos = ABYSS_COLLAPSE; return o; }
        float2 q = v.uv.zw; float t = Time(); float3 cam = CamPos();
        float3 p = a.xyz; float2 sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
        p += .1 * float3(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
        float d = length(p - cam);
        if (d > _MaxD * Det() || dot(p - cam, CamFwd()) < -1.) { o.pos = ABYSS_COLLAPSE; return o; }
        float tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
        float sz = min(max(b.z, d * .0026), d * .0045);
        float3 w = p + (CamRight() * q.x + CamUp() * q.y) * sz;
        o.pos = AbyssClip(w); o.uv = q;
        float z = zone(p);
        float lit = .3 + 1.8 * shadow1(p) * sunE(p.y, z).g;
        float e = b.z / sz;
        o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-SIG.g * d) * ss(.4, 1.5, d) * 17.;
        return o;
      }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float r = dot(i.uv, i.uv);
        return float4(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), (float3)10.), 0.);
      }
      ENDCG
    }
  }
}
