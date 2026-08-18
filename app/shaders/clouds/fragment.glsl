// clouds.glb packs cloud reference data into JPEG channels:
//   R = body density / internal luminance structure
//   G = green-screen matte (coverage; keyed out where green dominates)
uniform sampler2D uMap;
uniform float uOpacity;

uniform vec3 uSkyTopColor;
uniform vec3 uSkyHorizonColor;
uniform float uHeightMin;
uniform float uHeightMax;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAccentWarm;
uniform vec3 uAccentCool;

uniform float uSilverStrength;
uniform float uShadowDepth;
uniform float uSolidity;
uniform float uCoolTint;
uniform float uOpaque;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vInstanceFade;

#include ../includes/cloudShading.glsl

void main() {
  vec3 packed = texture2D(uMap, vUv).rgb;

  float density = packed.r;
  float greenKey = packed.g;

  // Softer green-screen key — wide feather so fringes don't clip to black.
  float key = max(greenKey - density * 0.28, 0.0);
  float coverage = density * (1.0 - smoothstep(0.02, 0.82, key));

  float heightT = clamp(
    (vWorldPos.y - uHeightMin) / max(uHeightMax - uHeightMin, 0.001),
    0.0,
    1.0
  );

  float alpha;
  vec3 body = shadeCloud(
    density,
    normalize(vWorldNormal), normalize(uSunDirection),
    uSkyTopColor, uSkyHorizonColor, heightT,
    uSunColor, uAccentWarm, uAccentCool,
    uSilverStrength, uShadowDepth,
    uSolidity, uCoolTint,
    alpha
  );

  alpha *= (1.0 - smoothstep(0.15, 0.92, key));
  alpha *= coverage * uOpacity;
  float shapeAlpha = alpha;

  // Per-instance atmospheric fade (see CLOUD_INSTANCE_DEFS in Seawave.jsx):
  // hazier/farther instances lean toward the sky tone for a cheap layered-
  // depth read. fade = 1.0 (the hero instance) reproduces the original body
  // exactly, so this is a no-op for the primary cloud band.
  vec3 lightSky = mix(uSkyHorizonColor, vec3(0.94), 0.42);
  body = mix(lightSky, body, mix(0.55, 1.0, vInstanceFade));

  if (uOpaque > 0.5) {
    // Wide soft fringe at the silhouette; core stays dense but never snaps
    // to a hard binary cutout. Exponent < 1 lengthens the transparent tail.
    alpha = smoothstep(0.012, 0.58, shapeAlpha);
    alpha *= mix(0.55, 1.0, smoothstep(0.1, 0.72, shapeAlpha));
    alpha = pow(clamp(alpha, 0.0, 1.0), 0.72);

    if (alpha < 0.002) discard;

    // Fringe pixels pick up a grey sky tint before premultiply.
    body = mix(mix(lightSky, vec3(0.72, 0.74, 0.78), 0.4), body, smoothstep(0.06, 0.45, alpha));

    gl_FragColor = vec4(body, alpha);
  } else {
    alpha *= vInstanceFade;
    // Exponent closer to 1 than the old 0.78 — that value over-boosted faint
    // edge alpha toward opaque, snapping the fade-out short. This keeps more
    // of the gradual ramp from the widened smoothstep bands above.
    alpha = pow(clamp(alpha, 0.0, 1.0), 0.92);

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(body, alpha);
  }

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Premultiply after tone map — correct soft blend, no dark halos.
  gl_FragColor.rgb *= gl_FragColor.a;
}
