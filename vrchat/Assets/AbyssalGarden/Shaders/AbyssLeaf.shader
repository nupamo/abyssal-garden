// Abyssal Garden: kelp, grasses and ground cover. See AbyssLeaf.cginc.
Shader "Abyssal Garden/Leaf" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssDetail ("Rock detail", 2D) = "gray" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssGround ("Ground map", 2D) = "black" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _AbyssGroups ("Plant groups", 2D) = "black" {}
    _AbyssLeafGroup ("Leaf groups", 2D) = "black" {}
    _AbyssDots ("Ground-cover spots", 2D) = "black" {}
    _Mode ("Mode (0 groups, 1 ground cover)", Float) = 0
    _Stride ("Leaf stride", Float) = 1
    _WidthScale ("Width scale", Float) = 1
    _Thin ("Thinning (1, 2, 4)", Float) = 1
    _MinD ("Band start (m)", Float) = 0
    _MaxD ("Band end (m)", Float) = 24
    _Far ("Fade-out distance (m)", Float) = 150
    _AbyssDetailScale ("Draw distance scale", Float) = 1
  }
  SubShader {
    Tags { "RenderType" = "Opaque" "Queue" = "Geometry+10" "DisableBatching" = "True" }
    Pass {
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssLeaf.cginc"
      ENDCG
    }
    Pass {
      Tags { "LightMode" = "ShadowCaster" }
      Cull Off
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vertDepth
      #pragma fragment fragDepth
      #include "AbyssLeaf.cginc"
      ENDCG
    }
  }
}
