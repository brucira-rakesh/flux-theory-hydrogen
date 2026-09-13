import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneEngine } from "../SceneEngineContext";

// Cursor reactivity for the product's shower-fog plane — same fluid-sim idea
// as SteamOverlay's screen-space veil (a low-res velocity field the pointer
// "splats" into, which self-advects/dissipates every frame and warps the
// fog's noise sampling), but driven by a raycast hit on the fog MESH itself
// rather than a fixed screen-facing quad, since this fog is a real object
// sitting in the shower stall rather than a veil resting in front of the
// camera. See fog.frag's own uVelocityField/uMouseStrength comment for the
// shader side.
// GUI-tuned via the "Shower Fog Mouse" folder.
const DEFAULTS = {
  mouseStrength: 0.32,
  dissipation: 0.832,
  splatRadius: 0.077,
  splatForce: 0.09,
  clearRadius: 0.099,
  clearStrength: 1.8,
  clearPersist: 0.775,
};

const MOUSE_LAMBDA = 4;
const SIM_RESOLUTION = 96;
const MAX_SPLAT_COMPONENT = 6;

const SIM_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Same semi-Lagrangian self-advection as SteamOverlay's ADVECT_FRAGMENT — see
// its own comment for why.
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
    advected.xy *= pow(uDissipation, uDt * 60.0);
    advected.z *= pow(uMaskDissipation, uDt * 60.0);
    gl_FragColor = vec4(advected.xy, clamp(advected.z, 0.0, 1.0), 1.0);
  }
`;

const SPLAT_FRAGMENT = `
  varying vec2 vUv;
  uniform vec2 uPoint;
  uniform vec2 uVelocityDelta;
  uniform float uRadius;
  uniform float uClearRadius;
  uniform float uClearAmount;
  void main() {
    vec2 p = vUv - uPoint;
    float d2 = dot(p, p);
    float velFalloff = exp(-d2 / uRadius);
    float clearFalloff = exp(-d2 / uClearRadius);
    gl_FragColor = vec4(uVelocityDelta * velFalloff, uClearAmount * clearFalloff, 1.0);
  }
`;

// `fogMeshRef` — the shower fog plane (see ProductSceneV2); its material is
// read via the ref each frame rather than taken as a prop, same "mutating a
// memoized value's own fields from outside render" reasoning as
// ProductSceneV2's own uRevealFade useFrame. `enabledRef` — only run the
// raycast/sim while truthy (e.g. the fog is actually visible/revealed), so
// this stays idle for the rest of the carousel/flythrough.
export function useFogMouseInteraction({ fogMeshRef, enabledRef }) {
  const { gl } = useThree();
  const { gui } = useSceneEngine();
  // A fresh copy, not the shared DEFAULTS object itself — the GUI folder
  // below mutates these fields in place, which would otherwise leak into
  // every other instance/reload sharing the same module-level constant.
  const paramsRef = useRef({ ...DEFAULTS });
  const mouseNdc = useRef(new THREE.Vector2(-10, -10)); // off-screen until moved
  const pointerActive = useRef(false);
  const raycaster = useRef(new THREE.Raycaster());
  const hitUv = useRef(new THREE.Vector2(0.5, 0.5));
  const hitUvTarget = useRef(new THREE.Vector2(0.5, 0.5));
  const havingHit = useRef(false);
  const pointerLastUv = useRef({ x: 0.5, y: 0.5 });
  const simRef = useRef(null);

  useEffect(() => {
    const handleMove = (event) => {
      pointerActive.current = true;
      mouseNdc.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseNdc.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

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

  // Own folder, separate from the "Shower Fog" one addFogGui builds in
  // ProductSceneV2 — these params drive the JS-side fluid sim, not the fog
  // material's own shader uniforms directly, so they don't belong nested
  // under the material's own controls.
  useEffect(() => {
    if (!gui) return undefined;
    const folder = gui.addFolder("Shower Fog Mouse");
    const p = paramsRef.current;
    folder.add(p, "mouseStrength", 0, 3, 0.01).name("Flow strength");
    folder.add(p, "dissipation", 0.8, 0.999, 0.001).name("Fluid dissipation");
    folder.add(p, "splatRadius", 0.01, 0.4, 0.001).name("Splat radius");
    folder.add(p, "splatForce", 0, 0.3, 0.001).name("Splat force");
    folder.add(p, "clearRadius", 0.01, 0.3, 0.001).name("Clear radius");
    folder.add(p, "clearStrength", 0, 20, 0.1).name("Clear strength");
    folder.add(p, "clearPersist", 0.5, 0.999, 0.001).name("Clear persist");
    return () => folder.destroy();
  }, [gui]);

  useFrame((state, delta) => {
    const mesh = fogMeshRef.current;
    const material = mesh?.material;
    const sim = simRef.current;
    if (!material || !sim) return;

    if (!enabledRef?.current) {
      material.uniforms.uMouseStrength.value = 0;
      return;
    }

    // Raycast the pointer against the fog plane itself to get a UV hit —
    // unlike SteamOverlay's screen-facing veil, this fog sits at a fixed
    // world position/orientation, so the pointer has to actually be over it.
    raycaster.current.setFromCamera(mouseNdc.current, state.camera);
    const hits = raycaster.current.intersectObject(mesh, false);
    const hit = hits[0];
    havingHit.current = Boolean(hit?.uv);
    if (hit?.uv) hitUvTarget.current.copy(hit.uv);

    hitUv.current.x = THREE.MathUtils.damp(
      hitUv.current.x,
      hitUvTarget.current.x,
      MOUSE_LAMBDA,
      delta,
    );
    hitUv.current.y = THREE.MathUtils.damp(
      hitUv.current.y,
      hitUvTarget.current.y,
      MOUSE_LAMBDA,
      delta,
    );

    const p = paramsRef.current;
    const uvX = hitUv.current.x;
    const uvY = hitUv.current.y;
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

    if (pointerActive.current && havingHit.current) {
      const speed = Math.hypot(velX, velY);
      sim.mesh.material = sim.splatMaterial;
      sim.splatMaterial.uniforms.uPoint.value.set(uvX, uvY);
      sim.splatMaterial.uniforms.uVelocityDelta.value.set(
        speed > 0.02 ? velX * p.splatForce : 0,
        speed > 0.02 ? velY * p.splatForce : 0,
      );
      sim.splatMaterial.uniforms.uRadius.value = p.splatRadius;
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
    material.uniforms.uMouseStrength.value = p.mouseStrength;
  });
}
