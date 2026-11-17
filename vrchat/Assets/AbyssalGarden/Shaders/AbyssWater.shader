// Abyssal Garden: the animated water texture (r = caustics, ba = surface slope), for a CustomRenderTexture that updates
// every frame (Update Mode: Realtime, wrap Repeat, mipmaps on). A port of W_WATER.
Shader "Abyssal Garden/Water (Custom Render Texture)" {
  SubShader {
    Lighting Off Blend One Zero
    Pass {
      CGPROGRAM
      #pragma target 4.5
      #include "UnityCustomRenderTexture.cginc"
      #pragma vertex CustomRenderTextureVertexShader
      #pragma fragment frag
      float caus(float2 uv, float t) {
        float2 p = uv * 6.2831853;
        float2 i = p; float c = 0.;
        [unroll] for (int n = 1; n <= 5; n++) {
          float tt = t * (1. - 3.5 / n);
          i = p + float2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          float s = sin(i.x + tt), k = cos(i.y + tt);
          c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
        }
        c = 1.17 - pow(c / 5., 1.4);
        return pow(abs(c), 8.);
      }
      static const float3 WK[10] = { float3(1., 2., 1.), float3(-2., 1., .9), float3(3., 1., .6), float3(1., -4., .5), float3(4., 3., .4),
        float3(-3., 5., .32), float3(6., -2., .28), float3(5., 7., .2), float3(-8., 3., .18), float3(2., 11., .14) };
      float4 frag(v2f_customrendertexture IN) : SV_Target {
        float2 uv = IN.localTexcoord.xy; float t = _Time.y;
        float c = caus(uv, t * .45 + 23.);
        float2 wu = uv + .02 * float2(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
        float2 s = 0.;
        [unroll] for (int i = 0; i < 10; i++) {
          float3 k = WK[i];
          s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * ((i & 1) == 0 ? 1. : -1.) + i * 1.7);
        }
        return float4(c, c, s * .06);
      }
      ENDCG
    }
  }
}
