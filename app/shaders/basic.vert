// Simple UV pass-through vertex shader (three.js injects position/uv + matrices).
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
