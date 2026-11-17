// Abyssal Garden: volumetric light shafts (W_RAYS), added on top of the scene. Draw it on a sphere with huge bounds (the
// importer's "Light Shafts" object): the vertex shader wraps the sphere around the camera.
// It marches each pixel's view ray up to the scene depth, so it needs the camera depth texture: in VRChat that means a
// directional light with shadows in the scene (see the README). The web version marches at half resolution and blurs;
// here it is full resolution with fewer steps (ABYSS_RAYN, AbyssConfig.cginc) and the dither left in.
Shader "Abyssal Garden/Light Shafts" {
  Properties {
    _AbyssWater ("Water (caustics)", 2D) = "black" {}
    _AbyssVolume ("Volume", 3D) = "" {}
    _AbyssShadow ("Sun shadow", 2D) = "white" {}
    _Strength ("Strength", Float) = 0.54
    _MaxDist ("Max distance (m)", Float) = 120
  }
  SubShader {
    Tags { "RenderType" = "Transparent" "Queue" = "Transparent+50" "IgnoreProjector" = "True" "DisableBatching" = "True" }
    Pass {
      Blend One One
      ZWrite Off
      ZTest Always
      Cull Front
      CGPROGRAM
      #pragma target 4.5
      #pragma vertex vert
      #pragma fragment frag
      #include "AbyssCommon.cginc"
      UNITY_DECLARE_DEPTH_TEXTURE(_CameraDepthTexture);
      float _Strength, _MaxDist;
      struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
      struct v2f { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; float4 sp : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };
      v2f vert(appdata v) {
        v2f o;
        UNITY_SETUP_INSTANCE_ID(v);
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
        float3 d = normalize(v.vertex.xyz);
        o.pos = UnityWorldToClipPos(_WorldSpaceCameraPos.xyz + d);
        o.dir = AbyssFlip(d); o.sp = ComputeScreenPos(o.pos);
        return o;
      }
      float4 frag(v2f i) : SV_Target {
        UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
        float3 rd = normalize(i.dir), ro = CamPos(), sx = ABYSS_SUN;
        float zl = LinearEyeDepth(SAMPLE_DEPTH_TEXTURE(_CameraDepthTexture, i.sp.xy / i.sp.w));
        float tm = min(zl / max(dot(rd, CamFwd()), 1e-3), _MaxDist);
        if (rd.y > 1e-4) tm = min(tm, -ro.y / rd.y);
        float z = CamZone(); float3 k = kd(z), sgz = sg(z);
        float dt = tm / ABYSS_RAYN;
        float j = ign(i.pos.xy);
        float3 acc = 0.;
        for (int n = 0; n < ABYSS_RAYN; n++) {
          float t = (n + j) * dt;
          float3 p = ro + rd * t;
          float3 s = shUV(p);
          float vis = shTap(s.xy, s.z + .0001); // the web version biases the shafts by .0006, the surfaces by .0007
          float2 q = p.xz - sx.xz * (p.y / sx.y);
          float pat = ss(.3, .7, _AbyssWater.SampleLevel(sampler_AbyssWater, q / 27., 2.5).r) * ss(.15, .6, _AbyssWater.SampleLevel(sampler_AbyssWater, q.yx / 11. + .3, 2.).r);
          float o = vol(p).r;
          float mist = sat(1. - (o - .5) * 3.4);
          acc += exp(-sgz * t + k * (p.y / sx.y)) * (vis * (.012 + pat * 6.) * (1. + 1.2 * mist * mist));
        }
        float mu = max(dot(rd, sx), 0.);
        float ph = lerp(.2 + 2.0 * mu * mu * mu, .8, z);
        float3 wc = lerp(WCOL + float3(.04, .07, .05), PCOL + float3(.28, .16, .12), z);
        return float4(min(acc * dt * sgz * wc * SUNC * ph * _Strength * (1. - .55 * z), (float3)20.), 0.);
      }
      ENDCG
    }
  }
}
