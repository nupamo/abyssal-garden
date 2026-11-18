// Abyssal Garden: the tileable rock detail texture (rg = slope, b = height, a = mottling), generated once when the world
// loads, by a CustomRenderTexture (Update Mode: On Load, 1024 x 1024, ARGB32 linear, mipmaps, wrap Repeat). Nothing is
// stored: a port of W_DETAIL (source/src/shaders.js), checked on the CPU by vrchat/exporter/verify-detail.mjs.
Shader "Abyssal Garden/Detail (Custom Render Texture)" {
  SubShader {
    Lighting Off Blend One Zero
    Pass {
      CGPROGRAM
      #pragma target 4.5
      #include "UnityCustomRenderTexture.cginc"
      #pragma vertex CustomRenderTextureVertexShader
      #pragma fragment frag
      float h31(float3 p) { float3 q = frac(p * float3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return frac((q.x + q.y) * q.z); }
      float3 h33(float3 p) { float3 q = frac(p * float3(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return frac((q.xxy + q.yxx) * q.zyx); }
      float ss(float a, float b, float x) { float t = saturate((x - a) / (b - a)); return t * t * (3. - 2. * t); }
      float hp(float2 p, float per) { return h31(float3(p - per * floor(p / per), per)); }
      float tn(float2 p, float per) {
        float2 i = floor(p), f = frac(p), u = f * f * (3. - 2. * f);
        return lerp(lerp(hp(i, per), hp(i + float2(1., 0.), per), u.x), lerp(hp(i + float2(0., 1.), per), hp(i + float2(1., 1.), per), u.x), u.y);
      }
      float tf(float2 uv, float per, int n) { float a = .5, s = 0., pr = per; for (int i = 0; i < n; i++) { s += a * tn(uv * pr + i * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
      float3 tw(float2 p, float per) {
        float2 i = floor(p), f = frac(p), d = 9.; float id = 0.;
        for (int x = -1; x <= 1; x++) { for (int y = -1; y <= 1; y++) {
          float2 o = float2(x, y), c = i + o, cw = c - per * floor(c / per);
          float3 hh = h33(float3(cw, per)); float2 r = o + hh.xy - f; float l = dot(r, r);
          if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
        } }
        return float3(sqrt(d), id);
      }
      float H(float2 uv) {
        float2 wq = uv + .11 * (float2(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
        float f = tf(wq, 3., 8);
        float r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
        float cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
        float cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
        float3 pt = tw(wq * 29., 29.);
        float pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
        return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
      }
      float4 frag(v2f_customrendertexture IN) : SV_Target {
        float2 uv = IN.localTexcoord.xy; float e = 1. / 1024.;
        float h = H(uv);
        float gx = H(uv + float2(e, 0.)) - H(uv - float2(e, 0.)), gy = H(uv + float2(0., e)) - H(uv - float2(0., e));
        float2 s = clamp(float2(gx, gy) * 1024. * .5 * .075, -1., 1.);
        return float4(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
      }
      ENDCG
    }
  }
}
