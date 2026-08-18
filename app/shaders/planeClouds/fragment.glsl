// plane_clouds.glb stores its cloud atlas as a plain grayscale JPEG: pure
// black is empty sky, white/grey is cloud — luminance IS the density, and
// (once black is keyed to zero) the coverage too. Unlike clouds.glb's
// texture there is no separate green-screen matte channel to key against.
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

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vInstanceFade;

#include ../includes/cloudShading.glsl

void main() {
  // Source is greyscale (R == G == B) — sample one channel as luminance.
  float density = texture2D(uMap, vUv).r;

  // Treat black as alpha: a soft threshold just above 0 so JPEG ringing near
  // pure black doesn't leave a faint haze/speckle across empty sky, while
  // still letting genuinely faint wisps through. Deliberately wide (this
  // layer's own puff silhouettes read harder-edged than clouds.glb's
  // connected band otherwise) so each puff fades out over a long gradient
  // instead of cutting off against the black background.
  float coverage = smoothstep(0.01, 0.55, density);

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

  alpha *= coverage * uOpacity;
  alpha *= vInstanceFade;
  // Exponent > 1 (vs. the shared layer's 0.92) pulls mid-low alpha DOWN
  // rather than boosting it — the old 0.78 did the opposite, snapping the
  // fade-out short by lifting faint edge pixels toward opaque. Combined with
  // the wide coverage band above, this gives this layer's puffs a long,
  // soft, sky-tone-blended fringe instead of a defined silhouette.
  alpha = pow(clamp(alpha, 0.0, 1.0), 1.3);

  if (alpha < 0.002) discard;

  // Per-instance atmospheric fade — see CLOUD_INSTANCE_DEFS/PLANE_CLOUD_
  // INSTANCE_DEFS in Seawave.jsx. fade = 1.0 reproduces the plain body.
  vec3 lightSky = mix(uSkyHorizonColor, vec3(0.94), 0.42);
  body = mix(lightSky, body, mix(0.55, 1.0, vInstanceFade));

  gl_FragColor = vec4(body, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Premultiply after tone map — correct soft blend, no dark halos.
  gl_FragColor.rgb *= gl_FragColor.a;
}
