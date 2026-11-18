// Abyssal Garden: instanced rocks, set pieces, sponges and coral. See AbyssSolid.cginc.
Shader "Abyssal Garden/Solid" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssDetail ("Rock detail", 2D) = "gray" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssInst ("Instances", 2D) = "black" {}
    _MinD ("Band start (m)", Float) = 0
    _MaxD ("Band end (m)", Float) = 100000
    _Compact ("Compact records", Float) = 0
    _Mat ("Material (compact)", Float) = 1
    _TexScale ("Texture scale / fade distance (compact)", Float) = 1
    _AbyssDetailScale ("Draw distance scale", Float) = 1
  }
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry" "DisableBatching" = "True" }
    Pass {
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssSolid.cginc"
      ENDCG
    }
    Pass {
      Tags { "LightMode" = "ShadowCaster" }
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vertDepth
      #pragma fragment fragDepth
      #include "AbyssSolid.cginc"
      ENDCG
    }
  }
}
