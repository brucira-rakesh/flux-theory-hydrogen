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

varying vec2 vUv;
varying vec3 vWorldPos;

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

  // Two scrolling samples of the same noise texture, different scale/phase/
  // speed, multiplied together — this produces drifting wispy patches
  // instead of one uniform tileable haze.
  vec2 uv1 = vUv * uTiling + flow;
  vec2 uv2 = vUv * uTiling * 1.6 - flow * 0.6 + vec2(0.37, 0.21);

  float n1 = texture2D(uNoiseMap, uv1).r;
  float n2 = texture2D(uNoiseMap, uv2).r;
  float density = clamp(n1 * n2 * uDensity, 0.0, 1.0);

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

  gl_FragColor = vec4(uColor, alpha);
}
