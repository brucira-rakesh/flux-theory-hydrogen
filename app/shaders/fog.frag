// Soft, drifting mist for the fogone/fogtwo planes hovering just above the
// sea. Two independently-scrolling samples of a tileable Perlin noise
// texture are multiplied together for wispy, non-repeating patches (rather
// than a single uniform haze), faded to fully transparent toward the plane's
// own edge so its rectangular boundary never reads as a hard shape, and
// boosted at grazing view angles the way real low-lying mist looks denser
// edge-on than seen from directly above.
uniform float uTime;
uniform sampler2D uNoiseMap;

uniform vec2 uTiling;
uniform vec2 uFlowDirection; // normalized UV-space prevailing wind direction
uniform float uFlowSpeed;
uniform float uDensity; // contrast/thickness of the noise-driven alpha
uniform float uEdgeSoftness; // 0..0.5 — how far in from the plane's edge the fade starts
uniform float uGrazingBoost; // extra opacity at grazing view angles; 0 disables

// Sine-driven motion so the mist reads as alive rather than a fixed-speed
// linear scroll: the wind direction itself slowly swings back and forth
// around uFlowDirection (gusts changing heading), a sideways weave on top of
// that heading, and a slow density "breathing" pulse.
uniform float uWindVariation; // max heading swing either side of uFlowDirection, in radians
uniform float uWindVariationSpeed;
uniform float uWobbleAmount; // sideways weave distance (UV units)
uniform float uWobbleSpeed;
uniform float uPulseAmount; // 0..1, how deep the density pulse dips
uniform float uPulseSpeed;

uniform vec3 uColor;
uniform float uOpacity; // overall max opacity

// Cursor reactivity — a live little fluid sim (see SteamOverlay/
// useFogMouseInteraction for the JS side that advects + splats this every
// frame): xy is flow velocity used to warp the noise sampling so the mist
// visibly gets pushed/swirled by the cursor, z is a clear-mask amount that
// punches a hole in the fog around it. Off by default (uMouseStrength <= 0
// leaves the field unsampled), so every fog plane that doesn't opt in — e.g.
// SceneOneV2's fogone/fogtwo — is bit-for-bit unchanged.
uniform sampler2D uVelocityField;
uniform float uMouseStrength;

// Soft-particle depth fade — fades this fragment out as it nears whatever
// solid geometry is behind it, instead of a hard depthTest cutoff. Off by
// default (uSoftFadeDistance <= 0.0 skips the texture read below entirely),
// so this is a no-op for every fog plane that doesn't explicitly opt in and
// supply a real scene-depth texture (see makeFogMaterial's own comment).
uniform sampler2D uSceneDepth;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;
uniform float uSoftFadeDistance; // world units of fade; <= 0 disables

// Camera-proximity fade — fades this fragment out as the camera gets close
// to it, so a large plane can't turn into a wall of solid colour filling the
// screen when the camera dollies in near/through it. Off by default (<= 0.0
// disables), same opt-in shape as the soft-particle fade above.
uniform float uNearFadeDistance; // world units; alpha ramps 0 -> full over this span

// Reveal fade — a plain 0..1 multiplier a caller eases over time (e.g. once
// a cinematic transition covering this plane has cleared), NOT an opt-in
// like the two uniforms above: defaults to 1 (fully visible, no-op) so
// every fog plane that never touches this looks exactly as before.
uniform float uRevealFade;

varying vec2 vUv;
varying vec3 vWorldPos;

// Standard perspective depth-buffer value (0..1) -> linear eye-space
// distance from the camera, for a camera with the given near/far.
float linearEyeDepth(float depth, float near, float far) {
  return (near * far) / (far - depth * (far - near));
}

void main() {
  // Wind direction animation: the heading swings back and forth around the
  // prevailing uFlowDirection (a gust changing which way it's blowing)
  // rather than holding one fixed direction forever. Rotating the unit
  // direction vector by a small oscillating angle keeps it unit length.
  float windAngle = sin(uTime * uWindVariationSpeed) * uWindVariation;
  float windCos = cos(windAngle);
  float windSin = sin(windAngle);
  vec2 windDirection = vec2(
    uFlowDirection.x * windCos - uFlowDirection.y * windSin,
    uFlowDirection.x * windSin + uFlowDirection.y * windCos
  );

  vec2 flow = windDirection * uTime * uFlowSpeed;

  // Sideways sine weave across the (already wind-animated) drift direction —
  // real mist drifts in wandering currents, not a dead-straight line.
  vec2 perp = vec2(-windDirection.y, windDirection.x);
  flow += perp * sin(uTime * uWobbleSpeed) * uWobbleAmount;

  // Cursor warp: drag the noise sample point by the local flow field (a soft
  // rational clamp keeps it bounded under sustained fast movement) so the
  // mist reads as pushed/swirled by the cursor instead of a static pattern.
  vec2 mouseWarp = vec2(0.0);
  float mouseClear = 0.0;
  if (uMouseStrength > 0.0) {
    vec3 field = texture2D(uVelocityField, vUv).xyz;
    vec2 mouseFlow = field.xy * uMouseStrength;
    mouseWarp = mouseFlow / (1.0 + length(mouseFlow));
    mouseClear = clamp(field.z, 0.0, 1.0);
  }

  // Two scrolling samples of the same noise texture, different scale/phase/
  // speed, multiplied together — this produces drifting wispy patches
  // instead of one uniform tileable haze.
  vec2 uv1 = vUv * uTiling + flow + mouseWarp;
  vec2 uv2 = vUv * uTiling * 1.6 - flow * 0.6 + vec2(0.37, 0.21) + mouseWarp;

  float n1 = texture2D(uNoiseMap, uv1).r;
  float n2 = texture2D(uNoiseMap, uv2).r;
  float density = clamp(n1 * n2 * uDensity, 0.0, 1.0);
  // Punch the fog away around the cursor and let it drift/decay back in on
  // its own once the cursor moves off (mouseClear rides the same fluid sim
  // as the warp above, see uVelocityField's own comment).
  density *= 1.0 - mouseClear;

  // Slow density "breathing" pulse — patches of mist thicken/thin over time
  // instead of holding one constant density forever.
  float pulse = mix(1.0 - uPulseAmount, 1.0, 0.5 + 0.5 * sin(uTime * uPulseSpeed));
  density *= pulse;

  // Soft radial fade so the plane's rectangular edge disappears into the
  // scene instead of reading as a hard-edged card.
  vec2 centered = vUv - 0.5;
  float edgeDist = length(centered) * 2.0; // 0 at center, ~1 at the inscribed edge
  float edgeFade = 1.0 - smoothstep(1.0 - uEdgeSoftness, 1.0, edgeDist);

  // Real low, thin mist looks thicker viewed edge-on than from directly
  // above/below; approximate via the view ray's angle to the flat plane's
  // vertical normal.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float grazing = pow(1.0 - clamp(abs(V.y), 0.0, 1.0), 2.0);
  float boost = mix(1.0, 1.0 + uGrazingBoost, grazing);

  float alpha = clamp(density * edgeFade * uOpacity * boost, 0.0, 1.0);

  if (uSoftFadeDistance > 0.0) {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float sceneDepthRaw = texture2D(uSceneDepth, screenUv).x;
    float sceneEyeDepth = linearEyeDepth(sceneDepthRaw, uCameraNear, uCameraFar);
    float fragEyeDepth = linearEyeDepth(gl_FragCoord.z, uCameraNear, uCameraFar);
    float soft = clamp((sceneEyeDepth - fragEyeDepth) / uSoftFadeDistance, 0.0, 1.0);
    alpha *= soft;
  }

  if (uNearFadeDistance > 0.0) {
    float camDist = length(cameraPosition - vWorldPos);
    alpha *= smoothstep(0.0, uNearFadeDistance, camDist);
  }

  alpha *= uRevealFade;

  gl_FragColor = vec4(uColor, alpha);
}
