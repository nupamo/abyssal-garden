// Abyssal Garden: manta (vertex-animated instances). See AbyssAnim.cginc.
Shader "Abyssal Garden/Manta" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssDetail ("Rock detail", 2D) = "gray" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssInst ("Instances", 2D) = "black" {}
  }
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry+20" "DisableBatching" = "True" }
    Pass {
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment fragManta
      #define ABYSS_MANTA
      #include "AbyssAnim.cginc"
      ENDCG
    }
    Pass {
      Tags { "LightMode" = "ShadowCaster" }
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment fragDepth
      #define ABYSS_MANTA
      #include "AbyssAnim.cginc"
      ENDCG
    }
  }
}
