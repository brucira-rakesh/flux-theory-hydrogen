import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Camera-facing cloud wipe used to conceal the last-scene -> product swap —
// the SAME billowing-fbm look as CloudTransition.jsx (the Seawave -> SceneV2
// hand-off overlay), ported into a Three.js plane living inside this Canvas
// instead of that component's own standalone WebGL context: this transition
// already runs on a single gsap-owned `opacity` value (see
// useSceneToProductHandoff), not a second scroll-driven auto-complete state
// machine, so only the fragment shader's visual math is shared — CloudTransition
// itself is not reused here.
//
// This plane is deliberately on the SAME default layer/render pass as
// everything else, not split out — an earlier attempt at rendering it on
// its own THREE.Layers bit, in a second un-bloomed gl.render() call after
// PostFXV2's composer.render(), caused a worse regression (a black frame
// for the whole fog-covered span of every transition) than the bloom halo
// it was trying to fix. The halo is instead suppressed by PostFXV2 itself,
// which scales bloom's own intensity down as this plane's opacity rises —
// see its own comment.
export default function HandoffFogWipe({ opacityRef }) {
  useFrame(({ camera, clock }) => {
    const mesh = opacityRef.current.mesh;
    if (!mesh) return;
    const opacity = opacityRef.current.opacity;
    mesh.visible = opacity > 0.001;
    if (!mesh.visible) return;

    const distance = 0.25;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    mesh.position
      .copy(camera.position)
      .add(new THREE.Vector3(0, 0, -distance).applyQuaternion(camera.quaternion));
    mesh.quaternion.copy(camera.quaternion);
    mesh.scale.set(height * camera.aspect, height, 1);
    mesh.material.uniforms.uOpacity.value = opacity;
    mesh.material.uniforms.uAspect.value = camera.aspect;
    mesh.material.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh
      ref={(mesh) => {
        opacityRef.current.mesh = mesh;
      }}
      renderOrder={1000}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        uniforms={{
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
        }}
        vertexShader={`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`
          uniform float uOpacity;
          uniform float uTime;
          uniform float uAspect;
          varying vec2 vUv;

          // --- value-noise fbm — verbatim from CloudTransition.jsx's own
          // fragment shader, so the two read as the same material. ---
          float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }
          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
            for (int i = 0; i < 6; i++) {
              v += a * noise(p);
              p = m * p;
              a *= 0.5;
            }
            return v;
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            p.x *= uAspect;

            // Subtle zoom-out as coverage rises so it reads like drifting
            // INTO the bank rather than clouds simply fading up in place.
            p *= mix(1.35, 0.92, uOpacity);

            float t = uTime * 0.03;
            float clouds  = fbm(p * 2.6 + vec2(t, t * 0.4));
            clouds       += 0.35 * fbm(p * 5.5 - vec2(t * 1.3, t * 0.7));
            clouds /= 1.35;

            float density = smoothstep(0.0, 0.55, clouds + uOpacity * 1.9 - 1.0);
            // Guaranteed opaque core near the peak so the scene swap can
            // never peek through, however the noise field happens to fall.
            density = max(density, smoothstep(0.72, 1.0, uOpacity));

            vec3 col = mix(vec3(0.80, 0.84, 0.93), vec3(1.0), density);
            gl_FragColor = vec4(col, density);
          }
        `}
      />
    </mesh>
  );
}
