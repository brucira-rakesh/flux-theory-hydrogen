// Procedural water-droplet shader for shower water.001.
// Layers of drifting droplet blobs slowly running downward, with bright glints.
uniform float uTime;
uniform float uSpeed;    // flow / animation speed
uniform float uDensity;  // droplet density (scales the grid)
uniform float uOpacity;  // overall opacity multiplier
uniform float uBaseAlpha; // transparency of the sheet between droplets (0 = clear)
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// One grid layer of animated droplets. Returns 0..1 coverage.
float dropLayer(vec2 uv, float cells, float seed, float time) {
  vec2 st = uv * cells;
  vec2 id = floor(st);
  vec2 gv = fract(st) - 0.5;
  float r = hash(id + seed);
  vec2 offset = 0.32 * vec2(
    sin(r * 6.2831 + time * (0.4 + r * 0.6)),
    cos(r * 4.0 + time * 0.3)
  );
  float d = length(gv - offset);
  float size = 0.12 + 0.22 * r;
  return smoothstep(size, size * 0.4, d);
}

void main() {
  float time = uTime * uSpeed;

  // Whole field runs slowly upward (bottom -> top).
  vec2 uv = vUv - vec2(0.0, time * 0.05);

  float drops = 0.0;
  drops += dropLayer(uv, 16.0 * uDensity, 0.0, time);
  drops += dropLayer(uv * 1.7 + 0.5, 22.0 * uDensity, 7.0, time) * 0.7;
  drops = clamp(drops, 0.0, 1.0);

  vec3 col = mix(uColor, vec3(1.0), drops);
  // Base sheet transparency, going fully opaque under droplets.
  float alpha = (uBaseAlpha + (1.0 - uBaseAlpha) * drops) * uOpacity;

  gl_FragColor = vec4(col, alpha);
}
