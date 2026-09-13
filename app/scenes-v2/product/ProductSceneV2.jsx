import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import { useSceneEngine } from "../SceneEngineContext";
import { useModelNudgeZ } from "./useModelNudgeZ";
import { useProductAlignment } from "./useProductAlignment";
import { useProductHotspots } from "./useProductHotspots";
import { useBottleReveal } from "./useBottleReveal";
import ProductLights from "./ProductLights";
import SelectiveBlurRenderer from "./SelectiveBlurRenderer";
import { makeFogMaterial, fogSharedDefaults } from "../materials";
import { addFogGui } from "../gui/guiHelpers";
import { useFogMouseInteraction } from "./useFogMouseInteraction";
import { MAX_BLUR_RADIUS, DEFAULT_MASK_FEATHER_RADIUS } from "./constants";

// Mounted as the carousel's own 6th ring slot (see Scene.v2.jsx) — same
// shared Canvas/scene graph as every other scene, not a Canvas of its own.
//
// Everything product owns lives under ONE alignment group, whose transform
// is solved for (see useProductAlignment) rather than dialed in: it places
// the room so that when this ring slot rests at FRONT, the flythrough's own
// frame-0 camera pose coincides exactly with the carousel's resting camera.
// That's what makes the arrival framed correctly AND the camera switch
// seamless. Lights included — their positions are room-local, so they have
// to ride the same transform (see ProductLights' own comment).
//
// `activeRef` (from useProductPhase) — has scroll carried PAST resting here
// into the flythrough's own scrub? Gates which render pipeline and camera own
// the frame (see SelectiveBlurRenderer/PostFXV2) and pointer interaction.
//
// `assetsRef`/`ready`/`alignRef` are no longer owned here — product is no
// longer a ring slot (see useSceneToProductHandoff), so these are created
// once, up in SceneContents (Scene.v2.jsx), and passed down: the handoff
// orchestrator needs direct read access to the same assets (e.g.
// bathroomBottleModel's resting world pose) and the same alignment group,
// which it couldn't reach if this component owned them privately.
//
// `roomVisible` mounts the room/bottle geometry once the carousel has
// actually reached its last scene — same "don't pay for it until it's about
// to matter" gate the old ring slot's `visibleIndices` membership gave for
// free. Product's own materials additionally default to opacity 0 (see
// useProductAssets.js) as a second, defensive layer: the handoff timeline is
// what actually fades them in, this gate just avoids drawing a fully
// transparent room for the whole rest of the carousel before that.
//
// `lightsActiveRef` is DELIBERATELY separate from `roomVisible`: the room's
// meshes are safe to mount early (they render at opacity 0 until the handoff
// fades them in), but ProductLights' real THREE.Light objects light the
// WHOLE shared scene regardless of mount timing or opacity — turning them on
// as soon as `roomVisible` flips (i.e. the instant the carousel rests on its
// last scene) blows out that scene's own bottle under a lighting rig that
// was never meant to touch it. Flipped by useSceneToProductHandoff itself,
// exactly when the room actually starts revealing — see its own comment.
// Lightweight steam veil for the shower stall — a single fog quad reusing
// the same fog.vert/fog.frag shader every carousel scene's fogone/fogtwo
// already run (see makeFogMaterial). Shader-parameter values below are the
// hand-tuned settings dialed in via the "Shower Fog" GUI folder (nested
// under "Product V2", see addFogGui) — drift turned off in favor of the
// shader's own wobble/pulse/rise-fall micro-motion. Position/scale are
// deliberately NOT frozen here (see the mesh's own ref callback below,
// which anchors them to the shower floor's actual geometry instead) — a
// hand-copied absolute position broke visibility once (landed at/below the
// floor, depth-tested out by the opaque floor mesh), so only the
// position-independent shader look is baked in as a default.
// Shower mist plane — temporarily disabled. Flip back to true to re-enable.
const PRODUCT_FOG_ENABLED = false;
const PRODUCT_FOG_DEFAULTS = {
  ...fogSharedDefaults,
  flowAngleDeg: 125,
  speed: 0,
  tiling: [1.1, 0.9],
  density: 2.13,
  opacity: 0.1,
  bobSpeed: 0.86,
};
// uPulseAmount/uBobAmount aren't part of fogSharedDefaults/makeFogMaterial's
// own `defaults` param (they're hardcoded there at 0.35/0.08 for every other
// fog plane) — applied directly to this material's uniforms instead, see
// below.
const PRODUCT_FOG_PULSE_AMOUNT = 0.12;
const PRODUCT_FOG_BOB_AMOUNT = 0.13;
// Position/Scale hand-tuned via the "Shower Fog" GUI folder once the
// floor-anchor fix (see the mesh's own ref callback below) made the plane
// actually visible — unlike the position-only attempt before that fix, this
// one was confirmed on-screen before being copied in here.
const PRODUCT_FOG_DEFAULT_POSITION = [5.252666, 4.681903, 0.339928];
const PRODUCT_FOG_DEFAULT_SCALE = [41.02239, 26.80491, 1];
// Soft-particle fade distance (world units) — how far short of whatever's
// behind the fog it starts fading its own alpha to 0, instead of a hard
// depthTest cutoff at their exact intersection (see fog.frag's own
// uSoftFadeDistance). GUI-tunable; 0 would fall back to the old hard edge.
const PRODUCT_FOG_SOFT_FADE_DISTANCE = 1;
// Camera-proximity fade (world units, see fog.frag's own uNearFadeDistance)
// — the flythrough camera dollies close to this plane at points in the
// reveal, and a plane this large (see PRODUCT_FOG_DEFAULT_SCALE) turning
// solid-white up close read as the fog's position "jumping" rather than
// what it actually is: a fixed-size plane covering wildly different amounts
// of the frame at different camera distances. GUI-tunable; 0 disables.
const PRODUCT_FOG_NEAR_FADE_DISTANCE = 4;

// Shower "rain" curtain — the same fog.vert/fog.frag shader as the mist
// plane above (makeFogMaterial), just tiled long-and-thin so the noise reads
// as falling streaks instead of drifting cloud.
// Disabled for now — flip back to true to re-enable.
const PRODUCT_RAIN_ENABLED = false;
const PRODUCT_RAIN_DEFAULTS = {
  ...fogSharedDefaults,
  flowAngleDeg: 179,
  speed: 0.109,
  tiling: [10, 0.5],
  density: 0.25,
  edgeSoftness: 0.25,
  opacity: 0.44,
  windSpeed: 0.304,
  wobbleSpeed: 0.81,
  pulseSpeed: 0.94,
  bobSpeed: 2,
};
const PRODUCT_RAIN_PULSE_AMOUNT = 0.13;
const PRODUCT_RAIN_BOB_AMOUNT = 0.13;
// uWindVariation/uWobbleAmount/uGrazingBoost aren't part of
// fogSharedDefaults/makeFogMaterial's own `defaults` param (hardcoded there
// at 0.5/0.15/1.5) — applied directly to this material's uniforms instead,
// same as uPulseAmount/uBobAmount above.
const PRODUCT_RAIN_WIND_VARIATION = Math.PI;
const PRODUCT_RAIN_WOBBLE_AMOUNT = 0.21;
const PRODUCT_RAIN_GRAZING_BOOST = 2.22;
const PRODUCT_RAIN_RADIUS = 0.6;
const PRODUCT_RAIN_HEIGHT = 3;
// Position/Scale/Rotation hand-tuned via the "Shower Rain" GUI folder.
const PRODUCT_RAIN_DEFAULT_POSITION = [-7.048, 5.216633, -6.95735];
const PRODUCT_RAIN_DEFAULT_SCALE = [1.223965, 3.785202, 0.089196];
const PRODUCT_RAIN_DEFAULT_ROTATION_Y = -1.95759;

export default function ProductSceneV2({
  assetsRef,
  ready,
  alignRef,
  roomVisible,
  lightsActiveRef,
  phaseRef,
  activeRef,
  restPosition,
  restRotationY,
  cameraPosition,
  cameraTarget,
  nudge,
  finalNudgeZ,
  onRevealedChange,
  fogNoise,
  showerFogRef,
}) {
  const { engine, gui } = useSceneEngine();
  const { camera } = useThree();
  const lenis = useLenis();
  const activeCameraRef = useRef(camera);
  const scrubProgressRef = useRef(0);
  const motionRef = useRef(null);
  useFrame(() => {
    activeCameraRef.current = camera;
    // phaseRef is already normalized 0->1 by useProductAutoZoom's own tween
    // — it is no longer a slice of a larger scroll range, so there's nothing
    // left to divide by here.
    scrubProgressRef.current = Math.min(phaseRef.current, 1);
  });
  // Three pieces of state the reveal interaction and the "+" overlay BOTH
  // touch. Owned here, at their common parent, rather than by either hook —
  // each hook needs something the other produces, so whichever ran second
  // would otherwise have to reach backwards. Refs (not state) because all
  // three are read per-frame and must never trigger a re-render.
  //   hoveredNodeRef  — written by the reveal raycast, read by the overlay
  //                     so the matching button scales up in sync.
  //   activeRevealedNodeRef — which bottle is currently out; the overlay
  //                     hides every "+" while it's set.
  //   hotspotOffsetByNode — the per-node screen-pixel nudge table; filled
  //                     by the overlay, exposed as GUI sliders alongside the
  //                     rest of the bottle-reveal controls.
  const hoveredNodeRef = useRef(null);
  const activeRevealedNodeRef = useRef(null);
  const hotspotOffsetByNode = useRef({}).current;

  useProductAlignment({
    alignRef,
    assetsRef,
    ready,
    restPosition,
    restRotationY,
    cameraPosition,
    cameraTarget,
    nudge: { ...nudge, z: 0 },
  });
  useModelNudgeZ({
    motionRef,
    phaseRef,
    activeRef,
    startZ: nudge.z,
    finalZ: finalNudgeZ,
  });

  // Shared with useBottleReveal (whose reveal/return tween drives `amount`
  // in lockstep with the flight) and SelectiveBlurRenderer (which reads it
  // every frame and exposes `maxRadius`/`featherRadius`/tint via its own GUI
  // folder) — see Product.jsx's own blurParams for the full rationale.
  const blurParamsRef = useRef({
    amount: 0,
    maxRadius: MAX_BLUR_RADIUS,
    featherRadius: DEFAULT_MASK_FEATHER_RADIUS,
    tintColor: "#000000",
    tintStrength: 0,
  });

  // Built BEFORE useBottleReveal so its own effect populates
  // hotspotOffsetByNode first — the reveal hook's GUI effect reads that
  // table to build the "Per-mesh hotspot offset" sliders.
  useProductHotspots({
    assetsRef,
    ready,
    activeCameraRef,
    activeRevealedNodeRef,
    hoveredNodeRef,
    scrubProgressRef,
    activeRef,
    offsetByNode: hotspotOffsetByNode,
  });

  useBottleReveal({
    assetsRef,
    ready,
    activeCameraRef,
    lenis,
    gui,
    blurParamsRef,
    activeRef,
    activeRevealedNodeRef,
    hoveredNodeRef,
    hotspotOffsetByNode,
    onRevealedChange,
  });

  const assets = assetsRef.current;
  const visible = roomVisible && ready;

  const fogMeshRef = useRef(null);
  const fogRangeRef = useRef(3);
  const fogMaterial = useMemo(() => {
    if (!PRODUCT_FOG_ENABLED || !fogNoise) return null;
    const material = makeFogMaterial(fogNoise, PRODUCT_FOG_DEFAULTS);
    material.uniforms.uPulseAmount.value = PRODUCT_FOG_PULSE_AMOUNT;
    material.uniforms.uBobAmount.value = PRODUCT_FOG_BOB_AMOUNT;
    material.uniforms.uSoftFadeDistance.value = PRODUCT_FOG_SOFT_FADE_DISTANCE;
    material.uniforms.uNearFadeDistance.value = PRODUCT_FOG_NEAR_FADE_DISTANCE;
    // Starts hidden — the reveal-fade useFrame below eases this up to 1
    // only once the cinematic handoff's own cloud wipe (see
    // useSceneToProductHandoff/HandoffFogWipe) has cleared, instead of the
    // fog just being visible the instant the room mounts (roomVisible flips
    // as soon as the carousel reaches its last scene, well before the
    // handoff into product even starts).
    material.uniforms.uRevealFade.value = 0;
    return material;
  }, [fogNoise]);

  useEffect(() => {
    if (!fogMaterial) return undefined;
    return engine.registerAnimated(fogMaterial);
  }, [engine, fogMaterial]);

  const rainMeshRef = useRef(null);
  const rainRangeRef = useRef(3);
  const rainMaterial = useMemo(() => {
    if (!PRODUCT_RAIN_ENABLED || !fogNoise) return null;
    const material = makeFogMaterial(fogNoise, PRODUCT_RAIN_DEFAULTS);
    material.uniforms.uPulseAmount.value = PRODUCT_RAIN_PULSE_AMOUNT;
    material.uniforms.uBobAmount.value = PRODUCT_RAIN_BOB_AMOUNT;
    material.uniforms.uWindVariation.value = PRODUCT_RAIN_WIND_VARIATION;
    material.uniforms.uWobbleAmount.value = PRODUCT_RAIN_WOBBLE_AMOUNT;
    material.uniforms.uGrazingBoost.value = PRODUCT_RAIN_GRAZING_BOOST;
    // Starts hidden, same reason/timing as the fog plane's own
    // uRevealFade — mounting (`visible`, see the JSX below) happens as soon
    // as the carousel reaches its last scene, well before the handoff's
    // fog wipe actually covers the frame, so without this the rain would
    // pop in while still sitting in the carousel.
    material.uniforms.uRevealFade.value = 0;
    return material;
  }, [fogNoise]);

  useEffect(() => {
    if (!rainMaterial) return undefined;
    return engine.registerAnimated(rainMaterial);
  }, [engine, rainMaterial]);

  useEffect(() => {
    if (!gui || !rainMaterial || !rainMeshRef.current) return undefined;
    const folder = addFogGui(gui, {
      material: rainMaterial,
      mesh: rainMeshRef.current,
      range: rainRangeRef.current,
      label: "Shower Rain",
    });
    if (folder) {
      const rot = rainMeshRef.current.rotation;
      const rotation = folder.addFolder("Rotation");
      rotation.add(rot, "x", -Math.PI, Math.PI, 0.001).name("Rotation X");
      rotation.add(rot, "y", -Math.PI, Math.PI, 0.001).name("Rotation Y");
      rotation.add(rot, "z", -Math.PI, Math.PI, 0.001).name("Rotation Z");
    }
    return () => folder?.destroy();
  }, [gui, rainMaterial, visible]);

  // Filled in every frame by SelectiveBlurRenderer's own depth pre-pass (see
  // its renderSelectiveBlur) — the scene's depth texture (fog plane
  // excluded) plus the flythrough camera's near/far and the render target's
  // pixel size, everything fog.frag's soft-particle fade needs to sample
  // "what's actually behind me". Read back out below and pushed into the
  // fog material's own uniforms — SelectiveBlurRenderer doesn't know about
  // the fog material itself, only this plain data handoff.
  const productDepthRef = useRef({
    texture: null,
    near: 0.1,
    far: 1000,
    width: 1,
    height: 1,
  });

  // Gates useFogMouseInteraction's raycast/fluid-sim work below (a ref, not
  // the plain `visible` boolean, since it needs to stay current inside that
  // hook's OWN useFrame) — mirrors the same "fully revealed" read as
  // uRevealFade just below, so the cursor can't warp/clear fog that isn't
  // actually on screen yet.
  const fogInteractiveRef = useRef(false);

  useFogMouseInteraction({
    fogMeshRef,
    enabledRef: fogInteractiveRef,
  });

  useFrame(() => {
    // Reached via the mesh ref, not the `fogMaterial` useMemo value directly
    // — mutating a memoized value's own fields from outside render is the
    // kind of thing the react-compiler lint (correctly, in the general
    // case) flags, even though uniform mutation is the normal per-frame
    // three.js idiom (see HandoffFogWipe's identical mesh.material.uniforms
    // pattern).
    const material = fogMeshRef.current?.material;
    if (!material) {
      fogInteractiveRef.current = false;
      return;
    }

    // Written by useSceneToProductHandoff's own timeline, at the exact
    // instant-swap point of each direction — the one moment the wipe fully
    // covers the frame, alongside the room itself being swapped in/out. So
    // this is a plain read: no easing, and no deriving the state here.
    //
    // Every earlier attempt to derive it in this useFrame was wrong for the
    // same underlying reason. `handoffActiveRef` is `inProduct || running`,
    // so it's TRUE for the whole time you rest in product — testing it for
    // "the wipe is over" is backwards. `lightsActiveRef` and the wipe's own
    // opacity both flip/start at TRIGGER time, before the clouds have
    // arrived — keying off either made the fog appear a few frames after
    // the clouds had already parted, and vanish before they'd covered on
    // the way back. Letting the timeline say when removes the guesswork.
    const revealed = Boolean(showerFogRef?.current?.revealed);
    material.uniforms.uRevealFade.value = revealed ? 1 : 0;
    fogInteractiveRef.current = revealed;

    // Same reveal signal, same reason — see the rain material's own
    // uRevealFade comment above.
    const rainMaterialInstance = rainMeshRef.current?.material;
    if (rainMaterialInstance) {
      rainMaterialInstance.uniforms.uRevealFade.value = revealed ? 1 : 0;
    }

    const depth = productDepthRef.current;
    // Only once SelectiveBlurRenderer's pre-pass has actually produced a
    // depth texture — before that (or if it never mounts) uSceneDepth stays
    // at makeFogMaterial's own safe placeholder, never gets set to null.
    if (!depth.texture) return;
    const u = material.uniforms;
    u.uSceneDepth.value = depth.texture;
    u.uCameraNear.value = depth.near;
    u.uCameraFar.value = depth.far;
    u.uResolution.value.set(depth.width, depth.height);
  });

  // Built once the mesh + the room it's guessing a placement from both
  // exist, same "gui doesn't exist on the very first render" shape as
  // Scene.v2.jsx's own gui-building effect — `visible` is what actually
  // flips once, right when the mesh above mounts, so it's the dep that
  // reruns this after the ref callback has had a chance to run.
  useEffect(() => {
    if (!gui || !fogMaterial || !fogMeshRef.current) return undefined;
    const folder = addFogGui(gui, {
      material: fogMaterial,
      mesh: fogMeshRef.current,
      range: fogRangeRef.current,
      label: "Shower Fog",
    });
    if (folder) {
      const rot = fogMeshRef.current.rotation;
      const rotation = folder.addFolder("Rotation");
      rotation.add(rot, "x", -Math.PI, Math.PI, 0.001).name("Rotation X");
      rotation.add(rot, "y", -Math.PI, Math.PI, 0.001).name("Rotation Y");
      rotation.add(rot, "z", -Math.PI, Math.PI, 0.001).name("Rotation Z");
      // Soft-particle depth fade (see fog.frag) — how far short of the
      // room's own geometry the fog starts fading to 0 instead of cutting
      // off hard at their exact intersection. 0 disables it (old hard edge).
      folder
        .add(fogMaterial.uniforms.uSoftFadeDistance, "value", 0, 5, 0.01)
        .name("Soft edge distance");
      // Camera-proximity fade (see fog.frag) — how close the flythrough
      // camera can get before this plane starts fading to 0, so it can't
      // turn into a wall of solid colour on a close dolly-in. 0 disables.
      folder
        .add(fogMaterial.uniforms.uNearFadeDistance, "value", 0, 15, 0.01)
        .name("Camera fade distance");
    }
    return () => folder?.destroy();
  }, [gui, fogMaterial, visible]);

  return (
    <>
      <group ref={alignRef}>
        <group ref={motionRef}>
        <ProductLights
          assetsRef={assetsRef}
          ready={ready}
          activeRef={lightsActiveRef}
        />
        {visible && assets.roomModel && <primitive object={assets.roomModel} />}
        {visible && assets.bottleGroup && (
          <primitive object={assets.bottleGroup} />
        )}
        {visible && rainMaterial && assets.roomModel && (
          <mesh
            ref={(mesh) => {
              rainMeshRef.current = mesh;
              // Same userData-guard shape as the fog mesh's ref callback
              // below — survives a remount of just this <mesh> resetting
              // position/scale to R3F's defaults.
              if (!mesh || mesh.userData.rainInitialized) return;
              mesh.userData.rainInitialized = true;
              const box = new THREE.Box3().setFromObject(assets.roomModel);
              const size = box.getSize(new THREE.Vector3());
              rainRangeRef.current = Math.max(size.x, size.y, size.z) || 3;
              mesh.position.set(...PRODUCT_RAIN_DEFAULT_POSITION);
              mesh.scale.set(...PRODUCT_RAIN_DEFAULT_SCALE);
              mesh.rotation.y = PRODUCT_RAIN_DEFAULT_ROTATION_Y;
            }}
          >
            <cylinderGeometry
              args={[
                PRODUCT_RAIN_RADIUS,
                PRODUCT_RAIN_RADIUS,
                PRODUCT_RAIN_HEIGHT,
                32,
                1,
                true,
              ]}
            />
            <primitive object={rainMaterial} attach="material" />
          </mesh>
        )}
        {visible && fogMaterial && assets.roomModel && (
          <mesh
            ref={(mesh) => {
              fogMeshRef.current = mesh;
              // Tracked on the mesh itself (userData), NOT a component-level
              // ref — a component-level flag stays true across a remount of
              // just this <mesh> (its own position/scale reset to R3F's
              // defaults, 0,0,0 / 1,1,1), which then made the ref callback
              // below skip re-initializing the fresh instance entirely —
              // exactly the "GUI shows 0,0,0" regression this fixes.
              if (!mesh || mesh.userData.fogInitialized) return;
              mesh.userData.fogInitialized = true;
              // Position/Scale are the hand-tuned defaults above, confirmed
              // visible in the GUI after the floor-anchor fix (see this
              // file's own history — "Cube006" is the WHOLE room shell
              // merged into one mesh, so box.max.y is the ceiling, not the
              // floor; that's what made the plane invisible before). Laid
              // flat via a fixed rotation. The room's own bounding box is
              // still measured here only to size the GUI position sliders'
              // range, not to place the mesh.
              const floorNode = assets.roomModel.getObjectByName("Cube006");
              const box = new THREE.Box3().setFromObject(
                floorNode || assets.roomModel,
              );
              const size = box.getSize(new THREE.Vector3());
              mesh.position.set(...PRODUCT_FOG_DEFAULT_POSITION);
              mesh.rotation.set(-Math.PI / 2, 0, 0);
              mesh.scale.set(...PRODUCT_FOG_DEFAULT_SCALE);
              fogRangeRef.current = Math.max(size.x, size.y, size.z) || 3;
            }}
          >
            <planeGeometry args={[1, 1]} />
            <primitive object={fogMaterial} attach="material" />
          </mesh>
        )}
        {/* Mounted as soon as assets are ready, same gate as the geometry
            above — the alignment solve has to measure this rig's frame-0
            pose inside the alignment group before product is ever on screen,
            and cameras cost nothing to keep in the graph (they only matter
            when something renders through them). */}
        </group>
        {ready && assets.cameraRig && <primitive object={assets.cameraRig} />}
      </group>
      <SelectiveBlurRenderer
        assetsRef={assetsRef}
        activeCameraRef={activeCameraRef}
        activeRevealedNodeRef={activeRevealedNodeRef}
        blurParamsRef={blurParamsRef}
        activeRef={activeRef}
        fogMeshRef={fogMeshRef}
        depthOutRef={productDepthRef}
      />
    </>
  );
}
