import { useEffect, useRef } from "react";
import gsap from "gsap";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useThree, useFrame } from "@react-three/fiber";
import { createLoaders, prepColorTexture } from "../loaders";
import { disposeObject } from "../disposeObject";
import { usePreloader } from "../../components/Preloader/PreloaderContext";
import { useSceneEngine } from "../SceneEngineContext";
import { excludeFromBloom } from "../bloomExclusion";
import {
  BOTTLE_MODEL_URL,
  DREAMER_BOTTLE_MODEL_URL,
  BOTTLE_TEXTURE_URLS,
} from "../bottleUrls";
import { STUDIO_TUNED_EXPOSURE, studioExposureScale } from "../studioExposure";

// Same tuned bottleGroup transform Scene.jsx's GUI Export produced (see
// BottleV2's old per-scene copy of these) — this rig is now the ONE bottle
// instance ever on screen, so there's only one place these live.
const BOTTLE_SCALE = 10;
export const BOTTLE_OFFSET_Z = 2.6;

// flux-bottle-v2.glb's own origin is NOT the bottle's geometric centre: at
// BOTTLE_SCALE its bounding box measures (0.674 x 1.506 x 0.404) and is
// centred (0.0002, 0.1379, 0.0011) from that origin — i.e. X/Z are zero to
// within float dust and the whole discrepancy is this much of Y.
//
// The /bottle-studio page removes the offset at the source, translating the
// model so its centre lands exactly on the light rig's origin (see
// BottleStudioSceneV2's recenterRef). This rig can't do that without moving
// the bottle on screen and shifting the pose the product handoff aligns
// against, so callers that mount the same rig around it (see Scene.v2.jsx)
// raise the LIGHTS by this instead. Same relative geometry either way, which
// is what the ported Blender positions actually depend on.
export const BOTTLE_CENTER_OFFSET_Y = 0.1379;

// Cursor tilt matches Scene.jsx's bottle exactly — max radians of pitch/yaw
// at full mouse deflection, eased via the same frame-rate-independent
// low-pass (see its own mouseEased/BOTTLE_TILT_X/Y comments).
const BOTTLE_TILT_X = 0.3;
const BOTTLE_TILT_Y = 0.3;
const PARALLAX_EASE = 0.1;

// Cap swap timing — see the useFrame block's "Cap swap" comment for why
// this is a real gsap tween on the caps' own THREE.Vector3.y (tweening the
// live property directly, not a hand-rolled 0..1 progress ref) rather than
// tracking the carousel's step tween: gsap already handles an in-flight
// tween being retargeted mid-flight (a quick reversal just eases back from
// wherever the cap actually is), which a synthetic progress value tried to
// replicate by hand and got wrong under fast, repeated scrolling.
//
// The OUTGOING cap sinks first, THEN the incoming cap rises (CAP_RISE_DELAY
// after the sink starts, not after it finishes fading — see its own
// comment) — sequential per spec, not a simultaneous cross-fade.
const CAP_SINK_DURATION = 0.125;
const CAP_RISE_DURATION = 0.255;
// The rise doesn't wait for the FULL sink duration — power2.in's own ease
// already spends most of CAP_SINK_DURATION barely moving before it
// accelerates (see CAP_SINK_EASE), so the cap reads as "basically gone"
// well before the tween technically completes. Starting the rise here
// instead of at CAP_SINK_DURATION keeps the whole swap feeling like one
// continuous motion instead of a dead pause between two tweens.
const CAP_RISE_DELAY = CAP_SINK_DURATION * 0.4;
// power2.in: slow to start, accelerating hard into the body — reads as the
// cap actually being drawn/sinking in under its own weight, not a linear
// mechanical slide. power4.out (rise): fast away from the body then a long,
// soft settle into rest — no bounce/overshoot (the sphere+circle assembly
// is a fairly literal physical object; an elastic/back ease would read as
// springy plastic, not a cap seating itself).
const CAP_SINK_EASE = "power2.in";
const CAP_RISE_EASE = "power4.out";

// Opposite sign of Scene.jsx's default `carousel.spin` (=1) — the bottle
// always turns opposite the scene's own swing direction.
const SPIN_SIGN = -1;

// There is now ONE bottle mesh for every scene — what used to be five whole
// GLBs swapped by visibility is one GLB (see BOTTLE_MODEL_URL) whose two
// label meshes get re-textured per scene instead. Each scene-to-scene
// transition turns the bottle exactly HALF a turn (180°, not a full
// revolution — step still advances by 1, but rotation.y below is π*step, not
// 2π*step), so the label mesh that was facing the camera ends the transition
// facing away, and the mesh that started facing away ends up facing the
// camera. There's no real "back" art on screen for either mesh: whichever
// one is rotating INTO view always gets the arriving scene's own FRONT
// texture (see BOTTLE_TEXTURE_URLS), never that persona's actual back art —
// so the viewer only ever sees front-cover label art, regardless of which
// physical mesh (Label / Label.001) happens to be facing them.
//
// The two meshes sit exactly 180° apart, so they cross the camera-facing
// boundary at exactly the same instant — the turn's exact midpoint, frac
// 0.5, where both are edge-on and equally invisible — and that crossing is a
// function of `step`'s current value alone, not of which direction it's
// moving. So each mesh's target persona (whichever scene index it's facing
// the camera FOR) is fixed by step parity alone (see meshAtParity in the
// useFrame block below): direction only ever affects the swing carousel's
// own motion, never which mesh shows which persona.
const HIDDEN_LABEL_SWAP_T = 0.5;
// How close to a whole step counts as "settled". Inside this, both labels
// take the resting scene's persona outright instead of resolving the two ends
// of a turn that is not actually in flight.
const REST_FRAC_EPS = 0.02;

// Which persona's turn swaps in the dedicated dreamer cap (see
// DREAMER_BOTTLE_MODEL_URL) instead of the shared model's own cap — a string
// constant rather than an index so it stays correct however SCENES gets
// reordered (see Scene.v2.jsx's own comment on index-independence).
const DREAMER_PERSONA = "dreamer";

// How far each cap travels on Y (in the SAME unscaled local units
// NEW_BASE.008's own translation sits in — see findNodeByName) while sinking
// away/rising into place. NEW_BASE.008's own local bbox is ~0.029 tall (see
// the dev-time measurement this was authored from); this is deliberately
// bigger so the cap tucks fully behind the body/neck instead of just
// grazing its edge, and is GUI-tunable (see the "Cap" folder below) since
// the right distance is a visual call, not a computable one.
const CAP_SINK_DISTANCE = 0.05;

// The bottle rig sits in front of a black void (see Scene.v2.jsx — there is
// no background geometry at the FRONT slot, just the swinging scenes behind
// it), so its metal parts had nothing to reflect and read as flat black.
// Silver_Plastic_Logo (the cap and the logo foil) ships with no
// `metallicFactor` at all, and glTF defaults that to 1.0 with a white base
// colour — i.e. it is a near-mirror chrome at roughness 0.22. A metal has NO
// diffuse response whatsoever; 100% of what it shows is its environment
// reflection. Adding lights alone could never fix it, which is why it stayed
// black no matter how hot the rig got. RoomEnvironment is a small
// procedurally-generated room (no HDRI download) built once per mount purely
// to give it something believable to reflect; it is not meant to be
// recognizable, just to put soft light gradients across the metal.
//
// Kept WELL under 1. RoomEnvironment is a lit room — its emissive panels run
// at intensity 50-100 — and a mirror returns essentially all of what it sees,
// so at full strength the body reflected those panels straight past 1.0 and
// blew to flat white. That is the same failure as an over-bright light, just
// arriving through the reflection term instead of the diffuse one, and it is
// what produced the white halo hugging the label. This is the value that
// buys the gradient across the metal without clipping it.
//
// Authored against /bottle-studio's 0.2 exposure, like the light rig it sits
// under — `canvasExposure` rescales it wherever that differs (see
// studioExposure.js). Reading this number in isolation is misleading: what
// reaches the shader is this times that scale.
const ENV_MAP_INTENSITY = 0.5;

// The labels take a fraction of that again: enough for a visible foil sheen
// and highlight roll-off across the curved body — too little here is what
// read as a flat, unlit sticker with no sense of light hitting it at all.
// Still short of the body's full mirror response so it doesn't clip. See
// BottleLights in Scene.v2.jsx for the full exposure budget this has to fit
// inside.
const LABEL_ENV_MAP_INTENSITY = 0.45;

// The shipped GLB's two label meshes carry no authored material at all (see
// findLabelMeshes) — every no-material glTF primitive shares ONE default
// material instance per three.js's GLTFLoader, which would make texturing
// the front label also texture the back one. These replace that shared
// stand-in with two independent materials.
//
// `metalness` is non-zero: a real product label is printed on foiled/
// laminated stock, and the slight metallic response is what lets it pick up
// the same soft environment sheen the cap has instead of sitting on the
// bottle as a dead matte sticker.
//
// `roughness` is kept low (glossy, not the fully matte 0.4 this used to run
// at) so the key/rim lights actually roll off across the label as visible
// highlights instead of scattering into a flat, shadowless matte read —
// matte at this light budget is what made the label look unlit.
//
// `color` multiplies the label texture; the art is near-white (~0.85
// albedo). Kept close to white (down from a darker 0xdadada tint) so the
// label reads bright under the rig's rather lean light budget while still
// leaving enough headroom under the 1.8 ACES exposure that it won't clip.
// It tints only the whites — the dark printed text keeps its contrast.
const LABEL_MATERIAL_DEFAULTS = {
  roughness: 0.22,
  metalness: 0.2,
  color: 0xf0f0f0,
  transparent: true,
  side: THREE.DoubleSide,
};

// `enabled=false` (see BottleRigV2's own `enableCursorTilt` prop) skips
// attaching the listener at all — mobile browsers fire a synthetic
// "compatibility" mousemove after a touch, at wherever the touch landed, and
// with the listener always-on that nudged this rig's tilt (BOTTLE_TILT_X/Y
// below) on every tap/swipe even though there is no real cursor to follow on
// a touch device. That read as the bottle's rotation being wrong on first
// paint (whatever compat event fired first/most recently) and only "fixing
// itself" once another touch happened to land near dead-centre.
function useCursorRaw(enabled) {
  const mouseRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    const handleMove = (event) => {
      mouseRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, [enabled]);
  return mouseRef;
}

// Finds the bottle's two label meshes by NODE name — the source file names
// the two label nodes "Label" (front) and "Label.001" (back), regardless of
// what material (if any) their mesh carries. GLTFLoader sanitizes node names
// on the way in (three.js's PropertyBinding.sanitizeNodeName strips "."), so
// "Label.001" actually arrives as "Label001" — matched here via startsWith
// rather than an exact string so this keeps working whichever convention a
// given export uses. Matching on the node rather than the material survived
// the v1→v2 GLB swap (v1 named the materials Dreamer_Label/
// Dreamer_Label_Back; v2 drops per-label materials entirely) with no code
// change needed.
function findLabelMeshes(root) {
  let front = null;
  let back = null;
  root.traverse((node) => {
    if (!node.isMesh || !node.name.startsWith("Label")) return;
    if (node.name === "Label") front = node;
    else back = node;
  });
  return { front, back };
}

// Finds a single node by its exact (GLTFLoader-sanitized, dots stripped)
// name — used below for the shared bottle's own cap ("NEW_BASE008", from
// source file node "NEW_BASE.008") and the dreamer GLB's cap-holder
// ("NEW_BASE003", from "NEW_BASE.003"). A plain traverse+match rather than a
// dedicated per-name function like findLabelMeshes/findDreamerLabelMeshes
// used to be, since both callers just want one node by one name.
function findNodeByName(root, name) {
  let found = null;
  root.traverse((node) => {
    if (node.name === name) found = node;
  });
  return found;
}

// The one bottle instance for the whole carousel — parked at a fixed world
// transform in front of the (fixed) camera at all times, independent of the
// swing carousel's own scene-group motion (see swingCarousel.js). Only its
// label textures and its rotation change, driven every frame by the SAME
// progressRef the carousel already updates as it moves the scene groups
// (see swingCarousel.js's applyTransition) — never a parallel calculation
// that could fall out of sync with what's on screen.
export default function BottleRigV2({
  scenes,
  enabled,
  position,
  rotationY,
  // Static X-axis tilt (radians), additive to the live cursor-tilt term
  // below — 0 by default (every existing caller keeps its exact current,
  // dead-level rest pose). Mobile (see MobileBottleCanvas) uses this instead
  // of live tilt for a fixed "looking up" angle, since it has no cursor tilt
  // to layer one on top of (enableCursorTilt={false} there).
  rotationX = 0,
  // Optional ref of {current: radians}, added to rotation.y every frame same
  // as rotationX above — a ref (not a prop value) because it's meant to
  // change continuously (an idle sway, see MobileBottleCanvas's IdleSway)
  // without forcing a React re-render per frame the way a changing number
  // prop would. null/undefined reads as 0, so every existing caller is
  // unaffected.
  idleSwayRef = null,
  progressRef,
  // Scene-to-product handoff (see useSceneToProductHandoff): while
  // `flightOverrideRef.current.active` is true, the group's transform below
  // is driven from `flightOverrideRef.current.position/quaternion` instead of
  // the fixed FRONT-slot math this rig normally runs — same "external tween
  // writes a ref, useFrame just reads it" split CameraRig already uses for
  // its own parallax so the two writers can never fight. `hidden` swaps the
  // group off once the handoff hands this bottle's role over to product's own
  // bathroomBottleModel at the same resting pose.
  flightOverrideRef,
  // External ref to this rig's own THREE.Group, so the handoff orchestrator
  // can read its CURRENT world transform as the flight's start pose.
  groupRefOut,
  // The calling Canvas's own gl.toneMappingExposure. ENV_MAP_INTENSITY below
  // was authored at /bottle-studio's 0.2 alongside the light rig, and exposure
  // multiplies reflections exactly as it multiplies direct light — see
  // studioExposure.js for why compensating one without the other is what left
  // this bottle blown white on the 1.8-exposure home page.
  canvasExposure = STUDIO_TUNED_EXPOSURE,
  // Desktop's cursor-follow parallax tilt (see useCursorRaw's own comment)
  // — on by default so every existing caller keeps its exact current
  // behavior. The mobile carousel (see scenes-v2/mobile/MobileBottleCanvas)
  // has no real cursor to follow and turns this off.
  enableCursorTilt = true,
  // Multiplies CAP_SINK_DURATION/CAP_RISE_DURATION/CAP_RISE_DELAY below — 1
  // (every existing caller's exact current timing) unless overridden. Mobile
  // (see MobileBottleCanvas) runs the dreamer/shared cap swap slower than
  // desktop so it reads clearly on a swipe-driven slide change.
  capDurationScale = 1,
}) {
  const groupRef = useRef(null);
  const modelRef = useRef(null);
  // The shared model's own cap (node "NEW_BASE008") and the dreamer GLB's
  // cap assembly (node "NEW_BASE003", parenting "Sphere" then "Circle") —
  // see findNodeByName and CAP_SINK_DISTANCE. Each ref's *RestY sibling
  // records the Y this node loaded in at, so the useFrame block below can
  // always compute an absolute position (rest, minus however much of
  // CAP_SINK_DISTANCE the current dreamer blend calls for) instead of
  // accumulating a delta that could drift.
  const mainCapRef = useRef(null);
  const mainCapRestYRef = useRef(0);
  const dreamerCapRef = useRef(null);
  const dreamerCapRestYRef = useRef(0);
  // Cap swap state — see the useFrame block's own "Cap swap" comment.
  // capSwapTargetRef is the last persona (0 = shared cap, 1 = dreamer cap)
  // the swap actually committed to, purely to detect a NEW flip each frame
  // (the gsap tweens themselves, not this ref, own the caps' actual
  // position/visibility once fired) — deliberately not derived from
  // `step`/`frac`, see CAP_SINK_DURATION.
  const capSwapTargetRef = useRef(0);
  const labelsRef = useRef({ front: null, back: null });
  const texturesRef = useRef(null); // { [persona]: { front: Texture, back: Texture } }
  const envRenderTargetRef = useRef(null); // the PMREM render target backing the bottle's own reflections (see ENV_MAP_INTENSITY)
  const { gl } = useThree();
  const { gui } = useSceneEngine();
  const { handoff, manager } = usePreloader();
  const loadedRef = useRef(false);
  const mouseRef = useCursorRaw(enableCursorTilt);
  const mouseEasedRef = useRef({ x: 0, y: 0 });
  // GUI-tunable, on top of the fixed `position`/`rotationY` props — mirrors
  // Scene.jsx's "Bottle > Transform" folder (offsetX/Y/Z, scale,
  // rotationY there is bottleBaseRotation.y, the resting-pose offset the
  // scroll spin and cursor tilt layer on top of every frame).
  const tuningRef = useRef({
    offsetX: 0,
    offsetY: 0,
    offsetZ: BOTTLE_OFFSET_Z,
    scale: BOTTLE_SCALE,
    rotationY: 0,
    capSink: CAP_SINK_DISTANCE,
  });

  // Which persona is currently applied to each label mesh — compared against
  // the desired one every frame so the texture is only reassigned on an
  // actual change, not once per frame.
  const appliedRef = useRef({ front: null, back: null });
  useEffect(() => {
    // Under PreloaderV2, wait until the overlay is handing off so two GLBs
    // don't contend with the hero reel. /scene2 has no manager, so load now.
    if (manager && !handoff) return;
    if (loadedRef.current || !groupRef.current) return;
    loadedRef.current = true;
    const group = groupRef.current;
    let disposed = false;
    let folder = null;
    // Filled once the labels are found below; unregistered in this effect's
    // own cleanup so a remount can't leave dead meshes in the shared registry.
    const bloomExclusionCleanups = [];

    // Not the preloader manager — this bottle isn't on screen until the
    // carousel, and holding the boot overlay for two GLBs + labels made the
    // intro hero wait on assets the user can't see yet.
    const { gltfLoader, textureLoader } = createLoaders(undefined, gl);

    const personas = Object.keys(BOTTLE_TEXTURE_URLS);
    Promise.all([
      gltfLoader.loadAsync(BOTTLE_MODEL_URL),
      gltfLoader.loadAsync(DREAMER_BOTTLE_MODEL_URL),
      Promise.all(
        // Only ever the FRONT art now — see SPIN_SIGN's own comment on why
        // there's no on-screen use for a persona's back texture any more.
        personas.map((persona) =>
          textureLoader.loadAsync(BOTTLE_TEXTURE_URLS[persona].front),
        ),
      ),
    ]).then(([gltf, dreamerGltf, personaTextures]) => {
      if (disposed) return;

      const textures = {};
      personas.forEach((persona, i) => {
        textures[persona] = prepColorTexture(personaTextures[i], gl);
      });
      texturesRef.current = textures;

      const bottle = gltf.scene;
      bottle.scale.setScalar(tuningRef.current.scale);
      // No position offset here: this mesh is a child of `groupRef`, which
      // is the SAME node spun every frame below. A child offset from a
      // spinning parent's own origin sweeps in a circle as it rotates — the
      // offset belongs on the group's own (non-rotating-relative)
      // translation instead, see the `position` prop on the returned
      // <group>, so the bottle spins in place on its own axis.
      group.add(bottle);
      modelRef.current = bottle;

      const { front, back } = findLabelMeshes(bottle);
      // Give each label its OWN material — see LABEL_MATERIAL_DEFAULTS'
      // comment: the GLB's label primitives carry no material of their own,
      // so three.js's loader hands both the same shared default instance,
      // and setting .map on one would set it on both.
      const staleLabelMaterials = new Set([front?.material, back?.material]);
      if (front)
        front.material = new THREE.MeshStandardMaterial(
          LABEL_MATERIAL_DEFAULTS,
        );
      if (back)
        back.material = new THREE.MeshStandardMaterial(LABEL_MATERIAL_DEFAULTS);
      staleLabelMaterials.forEach((mat) => mat?.dispose());
      labelsRef.current = { front, back };

      // The WHOLE bottle sits out the scene-wide bloom pass — every mesh, not
      // just the labels. Exactly what product does with its own bottles (see
      // useProductAssets' excludeMeshesFromBloom), so the two bottles in the
      // app now read the same.
      //
      // Excluding only the labels was not enough, because the labels were
      // never the main offender: NEW_BASE.005, the bottle BODY, is
      // `Silver_Plastic_Logo`, and that material declares neither
      // `metallicFactor` nor `baseColorFactor` — glTF defaults both, which
      // makes it a pure-white mirror at roughness 0.22. Every bright thing in
      // the room comes back off it at nearly full strength, so it clears the
      // scenes' bloom threshold (~0.65, tuned for their baked light strips)
      // across its entire surface. The halo that appeared to hug the label
      // was actually the strip of body still visible around it.
      //
      // Lowering ENV_MAP_INTENSITY (above) stops it CLIPPING, but a correctly
      // exposed polished metal still carries specular highlights above that
      // threshold — bloom's threshold is not a brightness bug to be tuned
      // away, it is doing its job on a surface that legitimately is bright.
      // The bottle's form should come from its lighting and reflections, the
      // way it does in the reference render, not from a glow pass smearing
      // over it.
      bottle.traverse((node) => {
        if (!node.isMesh) return;
        bloomExclusionCleanups.push(excludeFromBloom(node));
      });

      const restPersona = scenes[progressRef.current.frontIndex]?.bottlePersona;
      if (front && textures[restPersona]) {
        front.material.map = textures[restPersona];
        front.material.needsUpdate = true;
      }
      if (back && textures[restPersona]) {
        back.material.map = textures[restPersona];
        back.material.needsUpdate = true;
      }
      appliedRef.current = { front: restPersona, back: restPersona };

      // The shared model's own cap — swapped out for the dreamer cap
      // assembly below (rather than a whole second body mesh) whenever the
      // dreamer persona is at/near the front slot. See CAP_SINK_DISTANCE.
      const mainCap = findNodeByName(bottle, "NEW_BASE008");
      mainCapRef.current = mainCap;
      if (mainCap) mainCapRestYRef.current = mainCap.position.y;

      // The dreamer scene's own cap — a second, permanently-mounted GLB
      // alongside the shared one, not a swap-on-demand load: sliding the two
      // caps past each other needs both already resident and ready the
      // instant the carousel turns toward/away from dreamer, which a fetch-
      // on-arrival load could never keep up with mid-turn.
      //
      // Only node "NEW_BASE003" is kept — it parents "Sphere" then "Circle"
      // (the actual cap shape) at exactly the shared model's own cap
      // position (both come from the same Blender export), so it's used
      // purely as that correctly-rotated parent transform. Its OWN mesh
      // duplicates the bottle body's shape (a leftover, not a cap surface)
      // and is hidden via material.visible rather than being torn out of
      // the hierarchy, since it's what carries Sphere/Circle's transform.
      // The rest of this GLB (its own body/label/logo nodes) is unused now
      // that the dreamer persona re-textures the SHARED body like every
      // other persona — left attached to `dreamerGltf.scene`, which is
      // never added to the rig, so it's disposed below instead.
      const dreamerCap = findNodeByName(dreamerGltf.scene, "NEW_BASE003");
      if (dreamerCap) {
        dreamerCap.parent?.remove(dreamerCap);
        dreamerCap.scale.setScalar(tuningRef.current.scale);
        group.add(dreamerCap);
        if (dreamerCap.isMesh && dreamerCap.material) {
          dreamerCap.material.visible = false;
        }
        dreamerCapRestYRef.current = dreamerCap.position.y;
      }
      dreamerCapRef.current = dreamerCap;
      disposeObject(dreamerGltf.scene);

      // Starting position: whichever cap matches the scene actually at rest
      // right now (e.g. a deep link straight into the dreamer scene), so the
      // first frame doesn't show both or neither for a beat before the
      // useFrame block below corrects it — set directly, not tweened, so
      // the swap gsap fires on first mount doesn't needlessly replay.
      const startTarget = restPersona === DREAMER_PERSONA ? 1 : 0;
      capSwapTargetRef.current = startTarget;
      if (mainCap) {
        mainCap.position.y =
          mainCapRestYRef.current - tuningRef.current.capSink * startTarget;
        mainCap.visible = startTarget < 1;
      }
      if (dreamerCap) {
        dreamerCap.position.y =
          dreamerCapRestYRef.current -
          tuningRef.current.capSink * (1 - startTarget);
        dreamerCap.visible = startTarget > 0;
      }

      // Same bloom exclusion as the shared bottle (see its own comment just
      // above) — this sits in front of the same black void and needs the
      // same treatment.
      if (dreamerCap) {
        dreamerCap.traverse((node) => {
          if (!node.isMesh) return;
          bloomExclusionCleanups.push(excludeFromBloom(node));
        });
      }

      // Cinematic reflections — see ENV_MAP_INTENSITY's own comment. Built
      // once per mount straight from the renderer already in hand; disposed
      // in this effect's cleanup below.
      const pmrem = new THREE.PMREMGenerator(gl);
      const envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
      pmrem.dispose();
      envRenderTargetRef.current = envRenderTarget;
      const labelMeshes = new Set([front, back].filter(Boolean));
      // Read straight off the prop this []-deps effect closed over on the
      // first render — a Canvas's toneMappingExposure is fixed for the life
      // of the page, so there is never a later value to re-apply.
      const envScale = studioExposureScale(canvasExposure);
      bottle.traverse((node) => {
        if (!node.isMesh || !node.material) return;
        node.material.envMap = envRenderTarget.texture;
        node.material.envMapIntensity =
          (labelMeshes.has(node)
            ? LABEL_ENV_MAP_INTENSITY
            : ENV_MAP_INTENSITY) * envScale;
        node.material.needsUpdate = true;
      });
      // Same reflection rig applied to the dreamer cap — one shared
      // envRenderTarget, so both caps pick up the same room even while
      // sliding past each other mid-turn. No "label" split here (this
      // assembly carries no label meshes), so it's just the body intensity
      // throughout.
      if (dreamerCap) {
        dreamerCap.traverse((node) => {
          if (!node.isMesh || !node.material) return;
          node.material.envMap = envRenderTarget.texture;
          node.material.envMapIntensity = ENV_MAP_INTENSITY * envScale;
          node.material.needsUpdate = true;
        });
      }

      if (gui) {
        folder = gui.addFolder("Bottle");
        const transform = folder.addFolder("Transform");
        transform
          .add(tuningRef.current, "offsetX", -10, 10, 0.01)
          .name("Position X");
        transform
          .add(tuningRef.current, "offsetY", -10, 10, 0.01)
          .name("Position Y");
        transform
          .add(tuningRef.current, "offsetZ", -10, 10, 0.01)
          .name("Position Z");
        transform
          .add(tuningRef.current, "scale", 1, 30, 0.01)
          .name("Scale")
          .onChange((v) => {
            modelRef.current?.scale.setScalar(v);
            dreamerCapRef.current?.scale.setScalar(v);
          });
        transform
          .add(tuningRef.current, "rotationY", -Math.PI, Math.PI, 0.001)
          .name("Base Rotation Y");
        const cap = folder.addFolder("Cap");
        cap
          .add(tuningRef.current, "capSink", 0, 0.3, 0.001)
          .name("Sink Distance");
        folder.open();
      }
    });

    return () => {
      disposed = true;
      folder?.destroy();
      bloomExclusionCleanups.forEach((unregister) => unregister());
      bloomExclusionCleanups.length = 0;
      // The cap swap (see the useFrame block's own comment) fires real gsap
      // tweens on these nodes' `.position` — kill them before the nodes
      // themselves are disposed below, or a tween completing after unmount
      // would write into a disposed object's Vector3.
      gsap.killTweensOf(mainCapRef.current?.position);
      gsap.killTweensOf(dreamerCapRef.current?.position);
      disposeObject(group);
      group.clear();
      modelRef.current = null;
      mainCapRef.current = null;
      dreamerCapRef.current = null;
      labelsRef.current = { front: null, back: null };
      Object.values(texturesRef.current ?? {}).forEach((texture) =>
        texture?.dispose(),
      );
      texturesRef.current = null;
      envRenderTargetRef.current?.dispose();
      envRenderTargetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff, manager]);

  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group) return;

    const override = flightOverrideRef?.current;
    const frontIndex = progressRef.current.frontIndex;
    group.visible = !override?.hidden && !!enabled[scenes[frontIndex]?.id];

    // This rig's own resting pose is computed EVERY frame, including while
    // the handoff override owns the group below. The reverse flight (see
    // useSceneToProductHandoff) targets it live via override.restPosition/
    // restQuaternion, and it is not a constant: it folds in the live cursor
    // parallax tilt and the carousel's own `step`. Targeting a copy captured
    // back when the FORWARD flight took off meant the reverse landed on a
    // pose the rig no longer agreed with, and the instant the override
    // released, the rig snapped to its real rest — the reported "bottle
    // doesn't come back to center".
    const easeK = 1 - Math.pow(1 - PARALLAX_EASE, dt * 60);
    mouseEasedRef.current.x +=
      (mouseRef.current.x - mouseEasedRef.current.x) * easeK;
    mouseEasedRef.current.y +=
      (mouseRef.current.y - mouseEasedRef.current.y) * easeK;

    const tuning = tuningRef.current;
    // BOTTLE_OFFSET_Z (+ the GUI's offsetX/Y/Z) lives on this node's own
    // translation (T), not on a child's local position — T is untouched by
    // this same node's own R, so the bottle stays at a fixed world spot and
    // only spins about it (mirrors Scene.jsx's bottleGroup.position.z,
    // which offset the whole rotating group itself, not a child within it).
    group.position.set(
      position[0] + tuning.offsetX,
      position[1] + tuning.offsetY,
      position[2] + tuning.offsetZ,
    );

    const { step } = progressRef.current;
    group.rotation.y =
      rotationY +
      tuning.rotationY +
      SPIN_SIGN * Math.PI * step +
      mouseEasedRef.current.x * BOTTLE_TILT_Y +
      (idleSwayRef?.current ?? 0);
    group.rotation.x = rotationX + mouseEasedRef.current.y * BOTTLE_TILT_X;

    // Label texture swap — see HIDDEN_LABEL_SWAP_T's own comment for WHEN a
    // label may swap; this is WHICH mesh and WHICH persona.
    //
    // Derived entirely from `step` each frame, with no running "which step did
    // we last settle at" accumulator. A previous version kept one and only
    // refreshed it while `|step - accumulator|` was within a hair of zero —
    // but a finished transition leaves `step` a full 1.0 away from it, never
    // within that window, so it pinned itself to 0 forever: the first swap
    // worked and every later one resolved to the same stale pair.
    //
    // `step` is continuous and advances by exactly ±1 per transition (one
    // half turn — see the rotation.y line above), so `floor(step)` and
    // `floor(step) + 1` ARE the two scenes the bottle is turning between, and
    // the fraction between them is the turn's own progress. That holds in both
    // directions and needs no history.
    const textures = texturesRef.current;
    const { front: frontMesh, back: backMesh } = labelsRef.current;
    if (textures && (frontMesh || backMesh)) {
      const clampIdx = (i) => Math.max(0, Math.min(scenes.length - 1, i));
      const stepFloor = Math.floor(step);
      const frac = step - stepFloor;
      const lowIdx = clampIdx(stepFloor);
      const highIdx = clampIdx(stepFloor + 1);
      const lowPersona = scenes[lowIdx]?.bottlePersona;
      const highPersona = scenes[highIdx]?.bottlePersona;

      // Which mesh is camera-facing when `step` sits at whole number `n` is
      // fixed by `n`'s own parity alone (each whole step is a 180° turn, so
      // the two meshes swap which one faces the camera on every step) — a
      // fact about that step value, not about which way the bottle got
      // there, so it needs no direction tracking the way the old 360°/two-
      // real-labels version did.
      const meshAtParity = (n) =>
        ((n % 2) + 2) % 2 === 0 ? frontMesh : backMesh;

      const applyPersonaToMesh = (mesh, persona) => {
        if (!mesh || !persona || !textures[persona]) return;
        const key = mesh === frontMesh ? "front" : "back";
        if (appliedRef.current[key] === persona) return;
        mesh.material.map = textures[persona];
        mesh.material.needsUpdate = true;
        appliedRef.current[key] = persona;
      };

      // At rest, apply the resting scene's persona to WHICHEVER mesh the
      // bottle's actual rotation currently faces the camera with. That mesh
      // is read off `step` itself (rounded to the nearest whole turn), not
      // off `frontIndex` — the two agree in the carousel, but a page with no
      // swing carousel (see ScenePreviewPage) switches scenes through
      // `frontIndex` alone and leaves `step` fixed at 0 forever, so deriving
      // the facing mesh from `frontIndex` there would hand the persona to
      // whichever mesh `frontIndex`'s parity happened to land on — including
      // the one the bottle, never having turned, still has facing away.
      // `frontIndex` stays the authority for WHICH persona, same reasoning
      // as ScenePreviewPage's own comment on why it's the ground truth there.
      //
      // The REST_FRAC_EPS window also catches float dust — a `step` of
      // N-1e-9 floors to N-1 with a frac of ~1, which the mid-turn branch
      // would read as a turn in flight.
      const atRest = frac < REST_FRAC_EPS || frac > 1 - REST_FRAC_EPS;
      if (atRest) {
        const restIdx = clampIdx(frontIndex);
        applyPersonaToMesh(
          meshAtParity(Math.round(step)),
          scenes[restIdx]?.bottlePersona,
        );
      } else if (frac < HIDDEN_LABEL_SWAP_T) {
        // Both meshes are edge-on (invisible) at the same instant — frac
        // 0.5 — so the mesh NOT facing the camera at frac 0
        // (meshAtParity(high), the one rotating INTO view) is safe to swap
        // to the scene it's headed toward any time before that instant. The
        // one facing the camera at frac 0 (meshAtParity(low)) is already
        // correct from the previous transition landing.
        applyPersonaToMesh(meshAtParity(highIdx), highPersona);
      } else {
        // Past the midpoint meshAtParity(low) is the one now hidden (it's
        // rotated away) — reasserted here purely as a safety net for a
        // mount that lands mid-turn; in the steady state this is already a
        // no-op (see applyPersonaToMesh's own appliedRef check).
        applyPersonaToMesh(meshAtParity(lowIdx), lowPersona);
      }

      // Cap swap — fires a real gsap tween on the caps' own `.position.y`
      // the moment the target flips, rather than hand-rolling a 0..1
      // progress value re-applied every frame. Two earlier versions of this
      // tried to track the carousel's own step tween directly (reading as
      // an instant pop under its power2.out easing) and then a synthetic
      // fixed-duration progress ref (which had to manually "mirror" itself
      // on a reversal to avoid jumping, and got that wrong under fast,
      // repeated scrolling — a swap interrupted early left the reversed
      // swap starting most of the way through its own sink, so the outgoing
      // cap barely seemed to move). gsap tweening the live property directly
      // sidesteps both: retargeting an in-flight tween just eases from
      // wherever the cap actually is right now, which is exactly what
      // "reverse smoothly, no jump" means, and gsap's own eases (see
      // CAP_SINK_EASE/CAP_RISE_EASE) read as actual physical motion instead
      // of the linear ramp a hand-rolled lerp defaults to.
      //
      // Sequential by design, per spec: the OUTGOING cap sinks first, THEN
      // the incoming cap rises (see CAP_RISE_DELAY) — never both animating
      // from rest at once, so it reads as one cap being swapped for another
      // rather than two caps crossing through each other.
      const mainCap = mainCapRef.current;
      const dreamerCap = dreamerCapRef.current;
      if (mainCap && dreamerCap) {
        // Same authority the labels' own atRest branch above uses for "which
        // persona is the carousel actually settled on/settling into" — see
        // swingCarousel's FLAVOR_SWAP_FRAC for exactly when `frontIndex`
        // itself flips mid-turn.
        const capTarget =
          scenes[clampIdx(frontIndex)]?.bottlePersona === DREAMER_PERSONA
            ? 1
            : 0;
        if (capTarget !== capSwapTargetRef.current) {
          capSwapTargetRef.current = capTarget;
          const sink = tuning.capSink;
          const enteringDreamer = capTarget === 1;
          const outgoing = enteringDreamer ? mainCap : dreamerCap;
          const incoming = enteringDreamer ? dreamerCap : mainCap;
          const outgoingRestY = enteringDreamer
            ? mainCapRestYRef.current
            : dreamerCapRestYRef.current;
          const incomingRestY = enteringDreamer
            ? dreamerCapRestYRef.current
            : mainCapRestYRef.current;

          // gsap's default overwrite behavior kills whatever tween is
          // already running on this SAME object+property before starting
          // the new one, so a reversal mid-swap (outgoing/incoming swapping
          // roles) just retargets both tweens from their live current
          // position — no manual bookkeeping needed for that case. Visible
          // toggles are set from the tweens' own onStart/onComplete rather
          // than eagerly here, for the same reason CAP_SINK_DISTANCE's own
          // comment gives for hiding the sunk cap outright: a merely-lowered
          // cap can still poke out through/around the body, so the incoming
          // cap must stay hidden through the whole CAP_RISE_DELAY wait, not
          // just until this line runs.
          gsap.to(outgoing.position, {
            y: outgoingRestY - sink,
            duration: CAP_SINK_DURATION * capDurationScale,
            ease: CAP_SINK_EASE,
            onComplete: () => {
              outgoing.visible = false;
            },
          });
          gsap.to(incoming.position, {
            y: incomingRestY,
            duration: CAP_RISE_DURATION * capDurationScale,
            delay: CAP_RISE_DELAY * capDurationScale,
            ease: CAP_RISE_EASE,
            onStart: () => {
              incoming.visible = true;
            },
          });
        }
      }
    }

    // Publish the freshly-computed rest pose for the reverse flight to aim
    // at (see the comment above). Read AFTER the writes above so it's this
    // frame's value, not last frame's. `group.quaternion` tracks
    // `group.rotation` automatically — three keeps the pair in sync via the
    // Euler's own change callback — so it is already current here.
    //
    // restChildScale is the bottle model's own local scale (BOTTLE_SCALE, or
    // whatever the GUI's "Scale" slider has it set to right now) —
    // published live rather than assumed as a constant so the handoff's own
    // world<->local scale conversion (see useSceneToProductHandoff) stays
    // correct even if that slider gets tuned, and so it never has to
    // import/duplicate BOTTLE_SCALE itself.
    const model = modelRef.current;
    if (override) {
      override.restPosition.copy(group.position);
      override.restQuaternion.copy(group.quaternion);
      if (model) override.restChildScale.copy(model.scale);
    }

    // Applied last, so the override wins for the frames it owns while the
    // rest pose above still gets computed and published underneath it.
    if (override?.active) {
      group.position.copy(override.position);
      group.quaternion.copy(override.quaternion);
      group.scale.copy(override.scale);
    }
  });

  const groupPosition = [position[0], position[1], position[2]];

  return (
    <group
      ref={(node) => {
        groupRef.current = node;
        if (groupRefOut) groupRefOut.current = node;
      }}
      position={groupPosition}
      rotation={[0, rotationY, 0]}
    />
  );
}
