import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneEngine } from "./SceneEngineContext";

// Subtle camera-facing steam/mist veil — always resting in front of the
// fixed camera (same "resize every frame to fill the FOV at a fixed
// distance" trick as HandoffFogWipe), at very low opacity so it just softens
// the whole picture rather than reading as its own object. Unlike
// HandoffFogWipe (a big, externally gsap-choreographed opaque wipe owned by
// useSceneToProductHandoff), this one is fully self-contained: it drives its
// own mouse/scroll reactivity and its own fade, and builds its own GUI
// folder off SceneEngineContext exactly like a normal scene's fog material
// (see SceneOneV2's addFogGui usage) instead of being wired up from
// Scene.v2.jsx's own top-level gui-building effect.
//
// The mouse reactivity is a tiny fluid sim (same idea as PavelDoGreat's
// WebGL-Fluid-Simulation, minus the dye/glow render): a low-res velocity
// field texture that the pointer "splats" velocity into, which then
// self-advects and dissipates every frame. The steam shader reads that
// field at each pixel and uses it to warp its noise sampling, so drags
// leave swirling, drifting trails instead of an instantaneous cursor-locked
// distortion.
const DEFAULTS = {
  opacity: 0.06,
  density: 1,
  tilingX: 1.4,
  tilingY: 1.4,
  riseSpeed: 0.04,
  driftSpeed: 0.05,
  mouseStrength: 0.5,
  scrollStrength: 0.6,
  dissipation: 0.94,
  splatRadius: 0.12,
  splatForce: 0.09,
  clearRadius: 0.045,
  clearStrength: 6,
  clearPersist: 0.92,
  color: "#e8ecf2",
};

// How fast the layer's opacity eases toward 0 (transitioning) or back to its
// GUI opacity (settled) — THREE.MathUtils.damp rates, not durations. Fading
// out is snappier than fading in so the veil gets out of the way quickly
// once a transition starts, while the fade-in stays in roughly the same
// half-second ballpark as the rest of this scene's own fades (see
// useSceneToProductHandoff's FOG_IN/OUT_DURATION).
const FADE_OUT_LAMBDA = 16;
const FADE_IN_LAMBDA = 6;
const MOUSE_LAMBDA = 4;
const SCROLL_DECAY_LAMBDA = 2.5;

// Low-res velocity field is plenty — it's sampled with linear filtering and
// only needs to carry broad swirl/drift shapes, not fine detail.
const SIM_RESOLUTION = 128;
// Individual velocity components injected per splat are clamped before
// being written in, so a stray huge pointer jump (window blur/refocus, a
// dropped-frame delta spike) can't inject a single oversized impulse.
const MAX_SPLAT_COMPONENT = 6;

const SIM_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Semi-Lagrangian self-advection: each texel looks up where its velocity
// came from one step ago and pulls that value forward, which is what makes
// the field carry and curl its own structure over time instead of just
// sitting still and decaying in place. The clear mask (z) rides along in
// the same texture and gets advected by the same velocity — so a hole
// punched near the cursor drifts with the flow instead of staying static —
// and dissipates on its own lambda so it fills back in over time.
const ADVECT_FRAGMENT = `
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform float uDt;
  uniform float uDissipation;
  uniform float uMaskDissipation;
  void main() {
    vec3 state = texture2D(uVelocity, vUv).xyz;
    vec2 coord = clamp(vUv - state.xy * uDt, 0.0, 1.0);
    vec3 advected = texture2D(uVelocity, coord).xyz;
    // Dissipation is expressed as "multiplier per 1/60s" so it reads the
    // same regardless of actual frame rate.
    advected.xy *= pow(uDissipation, uDt * 60.0);
    advected.z *= pow(uMaskDissipation, uDt * 60.0);
    gl_FragColor = vec4(advected.xy, clamp(advected.z, 0.0, 1.0), 1.0);
  }
`;

// Additive gaussian blobs centered on the pointer, rendered on top of the
// just-advected field (see the additive-blend, no-clear pass in useFrame
// below): velocity in xy (for the swirl warp) and a clear-mask amount in z
// (punches a hole in the steam around the cursor).
const SPLAT_FRAGMENT = `
  varying vec2 vUv;
  uniform vec2 uPoint;
  uniform vec2 uVelocityDelta;
  uniform float uRadius;
  uniform float uAspect;
  uniform float uClearRadius;
  uniform float uClearAmount;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float d2 = dot(p, p);
    float velFalloff = exp(-d2 / uRadius);
    float clearFalloff = exp(-d2 / uClearRadius);
    gl_FragColor = vec4(uVelocityDelta * velFalloff, uClearAmount * clearFalloff, 1.0);
  }
`;

export default function SteamOverlay({ progressRef, handoffActiveRef }) {
  const { gui } = useSceneEngine();
  const { gl } = useThree();
  const meshRef = useRef(null);
  const materialRef = useRef(null);
  const paramsRef = useRef({ ...DEFAULTS });
  const mouseTarget = useRef({ x: 0, y: 0 });
  const mouseCurrent = useRef({ x: 0, y: 0 });
  const pointerLastUv = useRef({ x: 0.5, y: 0.5 });
  const scrollEnergy = useRef(0);
  const opacityMulRef = useRef(1);
  const simRef = useRef(null);
  // Stays false until the pointer has actually moved once — without this
  // gate the clear-mask splat would punch a permanent hole at (0,0) (the
  // default mouseCurrent position) before the user ever touches the mouse.
  const pointerActive = useRef(false);

  useEffect(() => {
    const handleMove = (event) => {
      pointerActive.current = true;
      mouseTarget.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      // CSS Y grows downward but UV space grows upward (see CameraRig's own
      // parallax handler for the same flip) — without this the warp reacts
      // as if the cursor were mirrored vertically.
      mouseTarget.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    // Mouse-wheel deltas (not page scroll position) read as a short-lived
    // energy impulse that decays every frame (see SCROLL_DECAY_LAMBDA below)
    // — it boosts the strength of splats injected into the fluid sim while
    // it's active, like the gesture actually stirring the mist harder,
    // rather than tracking scroll position directly.
    const handleWheel = (event) => {
      scrollEnergy.current = THREE.MathUtils.clamp(
        scrollEnergy.current + Math.min(Math.abs(event.deltaY), 120) / 120,
        0,
        2,
      );
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Sets up the ping-pong velocity field + the offscreen scene/camera/quad
  // used to simulate it. Runs once per renderer.
  useEffect(() => {
    const options = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    const rtA = new THREE.WebGLRenderTarget(SIM_RESOLUTION, SIM_RESOLUTION, options);
    const rtB = new THREE.WebGLRenderTarget(SIM_RESOLUTION, SIM_RESOLUTION, options);

    const simScene = new THREE.Scene();
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const advectMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVelocity: { value: null },
        uDt: { value: 0 },
        uDissipation: { value: DEFAULTS.dissipation },
        uMaskDissipation: { value: DEFAULTS.clearPersist },
      },
      vertexShader: SIM_VERTEX,
      fragmentShader: ADVECT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const splatMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPoint: { value: new THREE.Vector2(0.5, 0.5) },
        uVelocityDelta: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: DEFAULTS.splatRadius },
        uAspect: { value: 1 },
        uClearRadius: { value: DEFAULTS.clearRadius },
        uClearAmount: { value: 0 },
      },
      vertexShader: SIM_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    const simMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), advectMaterial);
    simScene.add(simMesh);

    simRef.current = {
      read: rtA,
      write: rtB,
      scene: simScene,
      camera: simCamera,
      mesh: simMesh,
      advectMaterial,
      splatMaterial,
    };

    return () => {
      rtA.dispose();
      rtB.dispose();
      advectMaterial.dispose();
      splatMaterial.dispose();
      simMesh.geometry.dispose();
      simRef.current = null;
    };
  }, [gl]);

  useEffect(() => {
    if (!gui) return undefined;
    const folder = gui.addFolder("Steam");
    const p = paramsRef.current;
    folder.add(p, "opacity", 0, 0.3, 0.001).name("Opacity");
    folder.add(p, "density", 0, 2, 0.01).name("Density");
    folder.add(p, "tilingX", 0.2, 5, 0.01).name("Tiling X");
    folder.add(p, "tilingY", 0.2, 5, 0.01).name("Tiling Y");
    folder.add(p, "riseSpeed", 0, 0.3, 0.001).name("Rise speed");
    folder.add(p, "driftSpeed", 0, 0.3, 0.001).name("Drift speed");
    folder.add(p, "mouseStrength", 0, 2, 0.01).name("Flow strength");
    folder.add(p, "scrollStrength", 0, 2, 0.01).name("Scroll boost");
    folder.add(p, "dissipation", 0.8, 0.999, 0.001).name("Fluid dissipation");
    folder.add(p, "splatRadius", 0.02, 0.4, 0.001).name("Splat radius");
    folder.add(p, "splatForce", 0, 0.3, 0.001).name("Splat force");
    folder.add(p, "clearRadius", 0.01, 0.3, 0.001).name("Clear radius");
    folder.add(p, "clearStrength", 0, 20, 0.1).name("Clear strength");
    folder.add(p, "clearPersist", 0.5, 0.999, 0.001).name("Clear persist");
    folder
      .addColor(p, "color")
      .name("Color")
      .onChange((v) => materialRef.current?.uniforms.uColor.value.set(v));
    return () => folder.destroy();
  }, [gui]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    const { camera, clock } = state;
    const p = paramsRef.current;

    mouseCurrent.current.x = THREE.MathUtils.damp(
      mouseCurrent.current.x,
      mouseTarget.current.x,
      MOUSE_LAMBDA,
      delta,
    );
    mouseCurrent.current.y = THREE.MathUtils.damp(
      mouseCurrent.current.y,
      mouseTarget.current.y,
      MOUSE_LAMBDA,
      delta,
    );
    scrollEnergy.current = THREE.MathUtils.damp(
      scrollEnergy.current,
      0,
      SCROLL_DECAY_LAMBDA,
      delta,
    );

    // --- Fluid velocity field step -----------------------------------
    // Advect the field by itself, then (if the pointer is moving) splat
    // fresh velocity in on top — same two-pass shape as the reference
    // sim's advection + splat passes, just without the dye/pressure/curl
    // stages since we only need the raw flow to warp the steam noise.
    const sim = simRef.current;
    if (sim) {
      const uvX = mouseCurrent.current.x * 0.5 + 0.5;
      const uvY = mouseCurrent.current.y * 0.5 + 0.5;
      let velX = 0;
      let velY = 0;
      if (delta > 0) {
        velX = (uvX - pointerLastUv.current.x) / delta;
        velY = (uvY - pointerLastUv.current.y) / delta;
      }
      pointerLastUv.current.x = uvX;
      pointerLastUv.current.y = uvY;
      velX = THREE.MathUtils.clamp(velX, -MAX_SPLAT_COMPONENT, MAX_SPLAT_COMPONENT);
      velY = THREE.MathUtils.clamp(velY, -MAX_SPLAT_COMPONENT, MAX_SPLAT_COMPONENT);

      const prevTarget = gl.getRenderTarget();
      const simDt = Math.min(delta, 1 / 30);

      sim.mesh.material = sim.advectMaterial;
      sim.advectMaterial.uniforms.uVelocity.value = sim.read.texture;
      sim.advectMaterial.uniforms.uDt.value = simDt;
      sim.advectMaterial.uniforms.uDissipation.value = p.dissipation;
      sim.advectMaterial.uniforms.uMaskDissipation.value = p.clearPersist;
      gl.setRenderTarget(sim.write);
      gl.render(sim.scene, sim.camera);

      // The clear-mask splat runs every frame the pointer is active (a hole
      // stays open while hovering), independent of the velocity splat below
      // which only fires while the pointer is actually moving.
      if (pointerActive.current) {
        const speed = Math.hypot(velX, velY);
        const boost = 1 + scrollEnergy.current * p.scrollStrength;
        sim.mesh.material = sim.splatMaterial;
        sim.splatMaterial.uniforms.uPoint.value.set(uvX, uvY);
        sim.splatMaterial.uniforms.uVelocityDelta.value.set(
          speed > 0.02 ? velX * p.splatForce * boost : 0,
          speed > 0.02 ? velY * p.splatForce * boost : 0,
        );
        sim.splatMaterial.uniforms.uRadius.value = p.splatRadius;
        sim.splatMaterial.uniforms.uAspect.value = camera.aspect;
        sim.splatMaterial.uniforms.uClearRadius.value = p.clearRadius;
        sim.splatMaterial.uniforms.uClearAmount.value = p.clearStrength * simDt;
        gl.autoClear = false;
        gl.render(sim.scene, sim.camera);
        gl.autoClear = true;
      }

      gl.setRenderTarget(prevTarget);

      const tmp = sim.read;
      sim.read = sim.write;
      sim.write = tmp;

      material.uniforms.uVelocityField.value = sim.read.texture;
    }

    // Hidden while the carousel is actively swinging between scenes
    // (progressRef.step is only fractional mid-swing, see swingCarousel.js)
    // or during the cinematic carousel->product handoff (handoffActiveRef,
    // see useSceneToProductHandoff) — both read as "a transition is
    // happening", not "we're on the product page", so the veil stays put
    // once product settles rather than disappearing for the whole flythrough.
    const step = progressRef?.current?.step ?? 0;
    const transitioning = Math.abs(step - Math.round(step)) > 0.001;
    const hidden = transitioning || Boolean(handoffActiveRef?.current);
    opacityMulRef.current = THREE.MathUtils.damp(
      opacityMulRef.current,
      hidden ? 0 : 1,
      hidden ? FADE_OUT_LAMBDA : FADE_IN_LAMBDA,
      delta,
    );

    const finalOpacity = p.opacity * opacityMulRef.current;
    mesh.visible = finalOpacity > 0.0008;
    if (!mesh.visible) return;

    const distance = 0.4;
    const height =
      2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    mesh.position
      .copy(camera.position)
      .add(new THREE.Vector3(0, 0, -distance).applyQuaternion(camera.quaternion));
    mesh.quaternion.copy(camera.quaternion);
    mesh.scale.set(height * camera.aspect, height, 1);

    const u = material.uniforms;
    u.uOpacity.value = finalOpacity;
    u.uTime.value = clock.getElapsedTime();
    u.uAspect.value = camera.aspect;
    u.uDensity.value = p.density;
    u.uTiling.value.set(p.tilingX, p.tilingY);
    u.uRiseSpeed.value = p.riseSpeed;
    u.uDriftSpeed.value = p.driftSpeed;
    u.uMouseStrength.value = p.mouseStrength;
  });

  return (
    <mesh ref={meshRef} renderOrder={999} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        uniforms={{
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uDensity: { value: DEFAULTS.density },
          uTiling: {
            value: new THREE.Vector2(DEFAULTS.tilingX, DEFAULTS.tilingY),
          },
          uRiseSpeed: { value: DEFAULTS.riseSpeed },
          uDriftSpeed: { value: DEFAULTS.driftSpeed },
          uVelocityField: { value: null },
          uMouseStrength: { value: DEFAULTS.mouseStrength },
          uColor: { value: new THREE.Color(DEFAULTS.color) },
        }}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uOpacity;
          uniform float uTime;
          uniform float uAspect;
          uniform float uDensity;
          uniform vec2 uTiling;
          uniform float uRiseSpeed;
          uniform float uDriftSpeed;
          uniform sampler2D uVelocityField;
          uniform float uMouseStrength;
          uniform vec3 uColor;
          varying vec2 vUv;

          // Same value-noise fbm as HandoffFogWipe/CloudTransition, so this
          // reads as the same family of "misty" material.
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
            for (int i = 0; i < 5; i++) {
              v += a * noise(p);
              p = m * p;
              a *= 0.5;
            }
            return v;
          }

          void main() {
            // The velocity field is a live little fluid sim (advected +
            // splatted by the pointer in JS, see SteamOverlay's useFrame) —
            // sampling it here and using it to drag the noise-sample point
            // around is what makes the steam actually get pushed/swirled
            // by the cursor instead of snapping to an instantaneous
            // distance-from-cursor falloff. A soft rational clamp keeps the
            // warp bounded even if the field builds up from sustained fast
            // movement, so it can never blow the pattern apart.
            vec3 field = texture2D(uVelocityField, vUv).xyz;
            vec2 flow = field.xy * uMouseStrength;
            vec2 warp = flow / (1.0 + length(flow));
            float clearAmt = clamp(field.z, 0.0, 1.0);

            vec2 p = (vUv - 0.5) * 2.0;
            p.x *= uAspect;
            p *= uTiling;
            p += warp;
            // Sampling the noise field at an increasing offset makes the
            // pattern APPEAR to drift the opposite way on screen, so a
            // rising steam look needs the sample point moving DOWN.
            p.y -= uTime * uRiseSpeed;
            p -= vec2(uTime * uDriftSpeed * 0.3, uTime * uDriftSpeed * 0.15);

            float steam = fbm(p * 2.0);
            steam += 0.4 * fbm(p * 4.0 + 7.3);
            steam /= 1.4;

            float density = smoothstep(0.35, 0.75, steam) * uDensity;
            float vignette = smoothstep(1.4, 0.2, length((vUv - 0.5) * vec2(uAspect, 1.0)) * 2.0);
            density *= mix(0.65, 1.0, vignette);
            // Punch the steam away around the cursor (clearAmt from the
            // same fluid sim as the warp above) and let it drift/decay back
            // in on its own once the cursor moves off.
            density *= 1.0 - clearAmt;

            float alpha = clamp(density, 0.0, 1.0) * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `}
      />
    </mesh>
  );
}
