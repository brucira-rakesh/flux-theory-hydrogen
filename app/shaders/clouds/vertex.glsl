// Cloud cards — UV + world-space data for sky-tinted shading. Rendered via
// InstancedMesh (see the CLOUD_INSTANCE_DEFS loader in Seawave.jsx): several
// offset/scaled copies of the same authored card drawn in one call, so
// `instanceMatrix` (auto-declared by three for instanced draws) carries each
// copy's own placement on top of the shared `modelMatrix`.
attribute float aInstanceFade; // per-instance depth/haze fade, 0..1 — see fragment.glsl

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vInstanceFade;

void main() {
  vUv = uv;
  vInstanceFade = aInstanceFade;

  vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
  vec3 instanceNormal = normalize(mat3(instanceMatrix) * normal);

  vec4 worldPos = modelMatrix * instancePosition;
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * instanceNormal);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
