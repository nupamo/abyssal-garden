// Abyssal Garden: the final grade (W_POST): exposure by depth, vignette, filmic tone curve, contrast and a touch of
// desaturation, then dither. Reads the HDR scene through a GrabPass, so the camera must render HDR (the importer's
// Reference Camera has HDR on). Draw it on a sphere with huge bounds (the importer's "Post" object), last.
// Not ported: the web version's soft bloom (6% blend). Unity's Post Processing v2 Bloom can stand in for it; leave its
// tonemapping off, this shader does that.
Shader "Abyssal Garden/Post" {
  Properties {
    _Exposure ("Exposure", Float) = 0.62
    _Vignette ("Vignette", Float) = 0.55
  }
  SubShader {
    Tags { "RenderType" = "Transparent" "Queue" = "Transparent+1000" "IgnoreProjector" = "True" "DisableBatching" = "True" }
    GrabPass { "_AbyssGrab" }
    Pass {
      ZWrite Off
      ZTest Always
      Cull Front
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssCommon.cginc"
      UNITY_DECLARE_SCREENSPACE_TEXTURE(_AbyssGrab);
      float _Exposure, _Vignette;
      struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
      struct v2f { float4 pos : SV_POSITION; float4 gp : TEXCOORD0; float4 sp : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        o.pos = UnityWorldToClipPos(_WorldSpaceCameraPos.xyz + normalize(v.vertex.xyz));
        o.gp = ComputeGrabScreenPos(o.pos); o.sp = ComputeScreenPos(o.pos);
        return o;
      }
      float3 tmap(float3 x) { return saturate((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 c = UNITY_SAMPLE_SCREENSPACE_TEXTURE(_AbyssGrab, i.gp.xy / i.gp.w).rgb;
        float ek = sat((-CamPos().y - 8.) / 26.);
        c *= _Exposure * (.6 + .4 * ek);
        float2 q = i.sp.xy / i.sp.w - .5;
        c *= 1. - dot(q, q) * _Vignette;
        c = tmap(c);
        float l0 = dot(c, float3(.2126, .7152, .0722));
        float l = lerp(l0, l0 * l0 * (3. - 2. * l0), .55);
        c *= l / max(l0, 1e-4);
        c = lerp(c, (float3)l, ss(.55, 1., l) * .1);
        c = lerp((float3)l, c, .93) + float3(.008, .002, 0.);
        c = pow(max(c, (float3)0.), (float3)(1. / 2.2));
        float n = ign(i.pos.xy) + ign(i.pos.xy + 37.) - 1.;
        c += n / 255.;
        // the web version writes these values to the screen as they are; Unity (linear colour space) encodes to sRGB
        return float4(GammaToLinearSpace(saturate(c)), 1.);
      }
      ENDCG
    }
  }
}
