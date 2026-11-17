// Abyssal Garden: the water beyond the draw distance (fsB in W_SURF). Draw it on a sphere (any size, huge bounds):
// it is pushed to the far plane and only fills pixels nothing else covered, with the haze the water has at 240 m.
Shader "Abyssal Garden/Backdrop" {
  Properties {
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
  }
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry+450" "DisableBatching" = "True" "IgnoreProjector" = "True" }
    Pass {
      Cull Off
      ZWrite Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssCommon.cginc"
      struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
      struct v2f { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        float3 d = normalize(v.vertex.xyz);
        o.pos = UnityWorldToClipPos(_WorldSpaceCameraPos.xyz + d * 10.);
        #if UNITY_REVERSED_Z
          o.pos.z = o.pos.w * 1e-6;
        #else
          o.pos.z = o.pos.w * (1. - 1e-6);
        #endif
        o.dir = AbyssFlip(d);
        return o;
      }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 p = CamPos() + normalize(i.dir) * 240.;
        return fin(fog((float3)0., p, zone(p)));
      }
      ENDCG
    }
  }
}
