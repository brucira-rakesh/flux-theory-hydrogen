// Flat, unlit fog/mist plane (fogone / fogtwo). UV + world-position
// pass-through, plus a gentle vertical bob so the whole plane rises and
// sinks over time (real mist convects upward, not just drifts sideways) —
// the noise-driven drift/wind and edge fade all happen in fog.frag.
uniform float uTime;
uniform float uBobAmount; // vertical rise/fall amplitude, world units
uniform float uBobSpeed;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;

  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  modelPosition.y += sin(uTime * uBobSpeed) * uBobAmount;
  vWorldPos = modelPosition.xyz;

  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
