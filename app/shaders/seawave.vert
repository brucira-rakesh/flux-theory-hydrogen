// Flat water pass-through for Mainbase.005 — no vertex displacement.
// All ripple/wave detail now comes from scrolling normal-map textures in
// seawave.frag; the mesh itself never moves.
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vLocalPos; // pre-transform position, used for the local-space edge fade

void main() {
  vUv = uv;
  vLocalPos = position;

  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = modelPosition.xyz;

  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
