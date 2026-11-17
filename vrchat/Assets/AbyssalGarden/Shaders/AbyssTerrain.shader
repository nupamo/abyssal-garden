// Abyssal Garden: terrain cells (ordinary meshes). See AbyssSolid.cginc.
Shader "Abyssal Garden/Terrain" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssDetail ("Rock detail", 2D) = "gray" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssDetailScale ("Draw distance scale", Float) = 1
  }
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry" "DisableBatching" = "True" }
    Pass {
      Cull Back
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #define ABYSS_TERRAIN
      #include "AbyssSolid.cginc"
      ENDCG
    }
    Pass {
      Tags { "LightMode" = "ShadowCaster" }
      Cull Back
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vertDepth
      #pragma fragment fragDepth
      #define ABYSS_TERRAIN
      #include "AbyssSolid.cginc"
      ENDCG
    }
  }
}
