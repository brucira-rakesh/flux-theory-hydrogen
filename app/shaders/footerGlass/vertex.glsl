// Fullscreen-triangle vertex shader shared by the trail-sim and droplet
// passes in FooterWaterGlass. `position` is already NDC (-1..1 plane from
// FooterWaterGlass's geometry), so it bypasses the camera's view/projection
// matrices entirely rather than needing an orthographic camera set up.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
