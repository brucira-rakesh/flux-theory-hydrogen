import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Loader, Stats } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { useLenis } from "lenis/react";

import { SceneEngineContext } from "./scenes-v2/SceneEngineContext";
// The last JSON exported via the GUI's "Export Settings" button (see the
// "Export" folder built below) — bundled at build time, so overwriting this
// file (e.g. with a fresh export) changes the app's actual initial values,
// no code edits needed. Starts as `{controllers:{},folders:{}}`, a true
// no-op (see applyFolderSettings/root.load below, which just skip any key
// that isn't present) until it's replaced.
import sceneV2Settings from "./scenes-v2/scene-v2-settings.json";
import { createSceneEngine } from "./scenes-v2/engine";
import { useDebugGui } from "./scenes-v2/useDebugGui";
import { useSharedMaps } from "./scenes-v2/useSharedMaps";
import { useSwingCarousel } from "./scenes-v2/swingCarousel";
import PostFX from "./scenes-v2/PostFX";
import { DEFAULT_AO, DEFAULT_GRADE } from "./scenes-v2/postFxDefaults";
import SceneOneV2 from "./scenes-v2/scenes/SceneOneV2";
import SceneFiveV2 from "./scenes-v2/scenes/SceneFiveV2";
import SceneTwoV2 from "./scenes-v2/scenes/SceneTwoV2";
import SceneThreeV2 from "./scenes-v2/scenes/SceneThreeV2";
import SceneFourV2 from "./scenes-v2/scenes/SceneFourV2";
import BottleRigV2 from "./scenes-v2/scenes/BottleRigV2";
import { BOTTLE_URLS } from "./scenes-v2/bottleUrls";
import SceneCaption from "./scenes-v2/SceneCaption";
import "./Scene.v2.css";

// Each carousel scene from Scene.jsx, model + material setup only. Layout
// and scroll-driven motion live in useSwingCarousel (see swingCarousel.js):
// scenes One/Three and Two/Four each take turns through the SAME pair of
// front/back slots (index parity picks the pair — see its own comment),
// which is what "places" one-with-three and two-with-four together.
const SCENES = [
  // Scene One and Three ship facing the opposite way from Two/Four on their
  // own authored Y axis — extraYRotation corrects that per-scene, layered on
  // top of the shared "face the front slot" rotation below. Default of PI
  // (180deg) is a starting point only — see DEFAULT_EXTRA_Y_ROTATIONS below,
  // it's GUI-tunable per scene at runtime, not fixed.
  {
    id: "one",
    label: "Scene One",
    Component: SceneOneV2,
    bottleUrl: BOTTLE_URLS.four,
  },
  // No bottle flavor assigned yet — BottleRigV2 skips loading/rendering a
  // bottle for any scene whose bottleUrl is falsy (see its own comment).
  {
    id: "five",
    label: "Scene Five",
    Component: SceneFiveV2,
    bottleUrl: BOTTLE_URLS.three,
  },
  {
    id: "two",
    label: "Scene Two",
    Component: SceneTwoV2,
    bottleUrl: BOTTLE_URLS.two,
  },
  {
    id: "three",
    label: "Scene Three",
    Component: SceneThreeV2,
    bottleUrl: BOTTLE_URLS.one,
  },
  {
    id: "four",
    label: "Scene Four",
    Component: SceneFourV2,
    bottleUrl: BOTTLE_URLS.five,
  },
];

// Default per-scene extraYRotation (radians) — GUI-tunable at runtime, see
// SceneV2's `extraYRotations` state and its "Model Rotation" GUI folder.
const DEFAULT_EXTRA_Y_ROTATIONS = Object.fromEntries(
  SCENES.map((s) => [s.id, Math.PI]),
);

// Per-scene bloom TARGET (see PostFX.jsx) — was one flat global
// strength/radius/threshold shared by every scene; now each scene owns its
// own, GUI-tunable via the "Scene Bloom" folder below, and the carousel
// cross-fades PostFX's actual bloom pass toward whichever scene is
// resting/incoming (see swingCarousel.js's applyTransitionBloom). Pushed up
// from the old flat/dim defaults (0.8/0.4/0.85) — a premium-bottle site
// wants its light strips and highlights visibly glowing, not just barely
// catching bloom's threshold.
const DEFAULT_BLOOM_TARGET = { strength: 1.6, radius: 0.55, threshold: 0.65 };
const DEFAULT_BLOOM_TARGETS = Object.fromEntries(
  SCENES.map((s) => [s.id, { ...DEFAULT_BLOOM_TARGET }]),
);

const CIRCLE_RADIUS = 7;
// Angle (degrees) the outgoing/incoming scene sweep through per transition
// step — was a fixed 180° (FRONT/BACK exactly opposite); now GUI-tunable,
// see SceneV2's `sweepAngleDeg` state and the "Sweep Angle" GUI control,
// and useSwingCarousel's own module comment for how this drives the ring.
const DEFAULT_SWEEP_ANGLE_DEG = 120;

// Rotation each scene's own group needs, at rest in the FRONT slot, to face
// the (fixed) camera — see swingCarousel.js's module comment for the
// derivation. Index-aligned with SCENES. `extraYRotations` is keyed by
// scene id (radians), see DEFAULT_EXTRA_Y_ROTATIONS.
const getFaceRotations = (extraYRotations) =>
  SCENES.map((s) => Math.PI + (extraYRotations[s.id] ?? 0));

// "Resting" transform for each scene's group — index 0 at FRONT, everything
// else parked at BACK. Set directly as JSX props (not left to
// useSwingCarousel's own layout effect to apply) so every scene is in the
// right place from the very first paint, with no dependency on ref-attach
// timing inside react-three-fiber's own commit — a group left at the JSX
// default (the origin) would sit right where the fixed camera does, which
// reads as a black screen (camera embedded in unlit geometry), not an error.
const getRestFrame = (faceRotations, i) => {
  const angle = i === 0 ? 0 : Math.PI;
  const z = i === 0 ? -CIRCLE_RADIUS : CIRCLE_RADIUS;
  return { position: [0, 0, z], rotationY: faceRotations[i] - angle };
};

// The camera's resting pose — aimed at the FRONT slot (0,0,-CIRCLE_RADIUS),
// same standoff the Focus buttons use. NOT (0,0,0): with the camera only
// 1.5 up and 0.01 forward of the origin, "look at the origin" is nearly
// straight down (the Y offset dwarfs the 0.01 Z offset) — camera pointed at
// empty ground next to its own feet, nowhere near scene one out at z=-16.
// That's the black screen: solid background color, nothing wrong, camera
// just never aimed at any scene to begin with.
const DEFAULT_CAMERA = {
  position: [0, 0.2, -CIRCLE_RADIUS + 6],
  // -11.6
  target: [0, 0, -CIRCLE_RADIUS],
};

// Debug-only geometry (minimap ring, main-camera frustum, per-scene markers)
// lives on its own render layer so it's visible to the minimap's debug
// camera but invisible to the main camera (which only has layer 0 enabled
// by default) — no per-object visibility toggling needed.
const DEBUG_LAYER = 31;
const DEBUG_COLORS = ["#ff4d4d", "#c04dff", "#4ddc4d", "#4d8dff", "#ffd24d"]; // index-aligned with SCENES
const MINIMAP_SIZE = 400;
const MINIMAP_PAD = 20;

const setDebugLayer = (obj) => obj?.layers.set(DEBUG_LAYER);

// Wireframe circle on the XZ plane at the carousel's radius — the swing
// carousel's whole path — so the minimap reads as a literal top-down map of
// where FRONT/BACK are and how far along it each scene currently is.
function DebugRing({ radius }) {
  const geometry = useMemo(() => {
    const points = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [radius]);

  return (
    <line ref={setDebugLayer} geometry={geometry}>
      <lineBasicMaterial color="#555555" />
    </line>
  );
}

// Visualizes the main (fixed) camera's own frustum — position, aim, and FOV
// — from the minimap's outside vantage point. Updated every frame since
// CameraRig tweens the real camera continuously.
function MainCameraHelper({ camera }) {
  const helper = useMemo(() => {
    const h = new THREE.CameraHelper(camera);
    setDebugLayer(h);
    return h;
  }, [camera]);

  useEffect(() => () => helper.dispose(), [helper]);
  useFrame(() => helper.update());

  return <primitive object={helper} />;
}

// Bottle flavors are lit PBR glTF materials (unlike the scenes' own unlit
// meshes) — same two lights Scene.jsx added once, globally, for them (and
// for Scene Four's glass panels, which share the same THREE.Scene). One rig
// per scene (not one shared global rig) so each scene's lights can fade in
// as it swings toward FRONT and fade out as it leaves toward BACK — see
// useSwingCarousel's applyLightFactor, which drives `intensity` on these
// refs every frame from the carousel's own transition math. Nested inside
// the scene's own group purely so the light rig's position/rotation track
// the model (lights still illuminate the whole scene regardless of parent,
// only intensity is scene-specific).
function SceneLights({ hemiRef, dirRef }) {
  return (
    <>
      <hemisphereLight
        ref={hemiRef}
        args={[0xffffff, 0x444444, 1.5]}
        position={[0, 5, 0]}
      />
      <directionalLight
        ref={dirRef}
        args={[0xffffff, 2.5]}
        position={[3, 5, 2]}
      />
    </>
  );
}

// The bottle rig (see BottleRigV2) is decoupled from the swinging scene
// groups above, so unlike SceneLights it never fades — same fixed
// intensities Scene.jsx used for its own single global bottle light rig.
function BottleLights() {
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x444444, 1.5]} position={[0, 5, 0]} />
      <directionalLight args={[0xffffff, 2.5]} position={[3, 5, 2]} />
    </>
  );
}

// Camera stays fixed for the real experience (the swing carousel moves the
// scenes, not the camera — see swingCarousel.js) — no OrbitControls. Its
// own per-frame update() was fighting any camera.position we set directly
// (it recomputes position from its own internal spherical every frame,
// unaware of external writes), and the wheel it binds for zoom by default
// would also contend with the carousel's own wheel handling.
function CameraRig({ fov, debugPosition }) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3(...DEFAULT_CAMERA.target));

  useEffect(() => {
    camera.lookAt(lookTarget.current); // orient correctly before the tween's own first tick
    gsap.to(camera.position, {
      x: DEFAULT_CAMERA.position[0],
      y: DEFAULT_CAMERA.position[1],
      z: DEFAULT_CAMERA.position[2],
      duration: 1.1,
      ease: "power3.inOut",
      onUpdate: () => camera.lookAt(lookTarget.current),
    });
    gsap.to(lookTarget.current, {
      x: DEFAULT_CAMERA.target[0],
      y: DEFAULT_CAMERA.target[1],
      z: DEFAULT_CAMERA.target[2],
      duration: 1.1,
      ease: "power3.inOut",
    });
  }, [camera]);

  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [fov, camera]);

  // Debug GUI position override — kills any in-flight focus/center tween so
  // it can't immediately overwrite the manually-dialed-in position, sets it
  // directly (no easing; this is for precise placement, not motion), and
  // keeps looking at whatever the last lookAt target was.
  useEffect(() => {
    if (!debugPosition) return;
    gsap.killTweensOf(camera.position);
    camera.position.set(debugPosition.x, debugPosition.y, debugPosition.z);
    camera.lookAt(lookTarget.current);
  }, [debugPosition, camera]);

  return null;
}

// Static top-down "map" camera for the minimap inset — square aspect (it
// always renders into a fixed 400x400 viewport, see PostFX), parked high
// above the origin looking straight down the Y axis. up is forced to -Z
// (instead of the default +Y, which is degenerate for a straight-down look)
// so world -Z (the FRONT slot) reads as "up" on screen, matching the ring's
// own θ=0-at-FRONT convention.
function useMinimapCamera(radius) {
  return useMemo(() => {
    const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
    cam.up.set(0, 0, -1);
    cam.position.set(0, radius * 3, 0.01);
    cam.lookAt(0, 0, 0);
    cam.layers.enable(DEBUG_LAYER);
    return cam;
  }, [radius]);
}

// progressRef.frontIndex is written every frame (see swingCarousel.js) but
// lives outside React state — this is the bridge that lets the DOM caption
// overlay (rendered outside the Canvas, in plain HTML) react to it, without
// re-rendering anything inside the Canvas on every frame: only calls
// `onChange` the instant frontIndex actually flips to a new scene.
function ActiveSceneTracker({ progressRef, onChange }) {
  const lastRef = useRef(-1);
  useFrame(() => {
    const idx = progressRef.current.frontIndex;
    if (idx !== lastRef.current) {
      lastRef.current = idx;
      onChange(idx);
    }
  });
  return null;
}

function SceneContents({
  enabled,
  sectionRef,
  fov,
  transitionFov,
  minimapEnabled,
  debugCameraPosition,
  extraYRotations,
  sweepAngle,
  onActiveSceneChange,
  lenis,
  postFxEnabled,
  bloomTargets,
  aoParams,
  gradeParams,
}) {
  const sharedMaps = useSharedMaps();
  const { camera } = useThree();
  const groupRefs = useRef(SCENES.map(() => ({ current: null })));
  // Index-aligned with SCENES: each entry is [hemiRef, dirRef] for that
  // scene's own light rig — see useSwingCarousel's applyLightFactor.
  const lightRefs = useRef(
    SCENES.map(() => [{ current: null }, { current: null }]),
  );
  const faceRotations = useMemo(
    () => getFaceRotations(extraYRotations),
    [extraYRotations],
  );
  const { visibleIndices, progressRef } = useSwingCarousel({
    sectionRef,
    groupRefs: groupRefs.current,
    faceRotations,
    radius: CIRCLE_RADIUS,
    sceneCount: SCENES.length,
    camera,
    lightRefs: lightRefs.current,
    sweepAngle,
    // The carousel drives camera.fov directly during a transition (see its
    // applyTransitionFov) — `fov` here is the resting value it returns to,
    // the same one CameraRig sets, so the two can't fight: CameraRig only
    // ever writes it on an actual GUI change, and every transition both
    // starts and ends at it.
    baseFov: fov,
    transitionFov,
    fovReturnAt: TRANSITION_FOV_RETURN_AT,
    lenis,
    // Index-aligned with SCENES (see DEFAULT_BLOOM_TARGETS) — keyed lookup
    // done once here rather than on every frame inside the hook.
    bloomTargets: SCENES.map((s) => bloomTargets[s.id]),
  });
  const minimapCamera = useMinimapCamera(CIRCLE_RADIUS);

  return (
    <>
      <CameraRig fov={fov} debugPosition={debugCameraPosition} />
      <ActiveSceneTracker
        progressRef={progressRef}
        onChange={onActiveSceneChange}
      />
      {SCENES.map((scene, i) => {
        const Comp = scene.Component;
        const visible = enabled[scene.id] && visibleIndices.has(i);
        const rest = getRestFrame(faceRotations, i);
        return (
          <group
            key={scene.id}
            ref={groupRefs.current[i]}
            position={rest.position}
            rotation={[0, rest.rotationY, 0]}
          >
            <SceneLights
              hemiRef={lightRefs.current[i][0]}
              dirRef={lightRefs.current[i][1]}
            />
            <Comp
              visible={visible}
              sharedMaps={sharedMaps}
              postFxEnabled={postFxEnabled}
            />
            {/* Debug-only marker (see DEBUG_LAYER) — always present so the
                minimap shows all four slots moving, independent of which
                scene is actually toggled on/visible right now. */}
            <mesh position={[0, 4, 0]} ref={setDebugLayer}>
              <sphereGeometry args={[0.6, 12, 12]} />
              <meshBasicMaterial color={DEBUG_COLORS[i]} />
            </mesh>
          </group>
        );
      })}
      {/* Fixed in front of the (fixed) camera at all times — the FRONT
          slot's own resting transform, see restFrame — independent of the
          swing carousel's per-scene motion above. Only its flavor and
          rotation change, driven by progressRef (see swingCarousel.js). */}
      <BottleLights />
      <BottleRigV2
        scenes={SCENES}
        enabled={enabled}
        position={getRestFrame(faceRotations, 0).position}
        rotationY={getRestFrame(faceRotations, 0).rotationY}
        progressRef={progressRef}
      />
      {minimapEnabled && (
        <>
          <DebugRing radius={CIRCLE_RADIUS} />
          <MainCameraHelper camera={camera} />
        </>
      )}
      {/* Held off until IntroHeroV2's autoplay reel finishes — this section
          sits pinned full-viewport underneath it until then, so the
          composer/bloom pass (and minimap debug pass) has nothing visible to
          buy, only GPU cost to pay. */}
      {postFxEnabled && (
        <PostFX
          minimapEnabled={minimapEnabled}
          minimapCamera={minimapCamera}
          progressRef={progressRef}
          ao={aoParams}
          grade={gradeParams}
        />
      )}
    </>
  );
}

const DEFAULT_FOV = 45;
// The camera widens to this while a carousel step sweeps, then eases back to
// DEFAULT_FOV before the step lands — see useSwingCarousel's
// applyTransitionFov for the curve. GUI-tunable at runtime ("Transition FOV"),
// this is just its starting value; set it equal to DEFAULT_FOV to switch the
// whole effect off.
const DEFAULT_TRANSITION_FOV = 48;
// Where in the step the widened FOV starts easing back, as a fraction of the
// step: it peaks here and is back at DEFAULT_FOV exactly at t=1, so 0.65
// means "pull back in over the last third of the sweep". Not GUI-exposed —
// this is the shape of the move, not a per-look dial.
const TRANSITION_FOV_RETURN_AT = 0.65;

// `gui` (optional) is a page-shared lil-gui panel (see useDebugGui /
// HomeV2Page, which creates one instance and hands it to both SceneV2 and
// ProductV2) — when supplied, this scene's controls live in their own
// "Scene V2" sub-folder on it instead of a second floating panel. Left
// undefined (e.g. the standalone /scene2 route in App.jsx), SceneV2 falls
// back to creating and owning its own panel, exactly as before.
export default function SceneV2({ postFxEnabled = true, gui: sharedGui } = {}) {
  const [enabled, setEnabled] = useState(() =>
    Object.fromEntries(SCENES.map((s) => [s.id, true])),
  );
  const [scenePanel, setScenePanel] = useState(null);
  const ownGui = useDebugGui(sharedGui ? null : "Scene V2 Tweaks");
  const basePanel = sharedGui ?? ownGui;
  const [engine] = useState(() => createSceneEngine());
  const [fov, setFov] = useState(DEFAULT_FOV);
  const [transitionFov, setTransitionFov] = useState(DEFAULT_TRANSITION_FOV);
  const [minimapEnabled, setMinimapEnabled] = useState(false);
  const [statsEnabled, setStatsEnabled] = useState(false);
  const [debugCameraPosition, setDebugCameraPosition] = useState(() => ({
    x: DEFAULT_CAMERA.position[0],
    y: DEFAULT_CAMERA.position[1],
    z: DEFAULT_CAMERA.position[2],
  }));
  // Per-scene "face the front slot" correction (radians) — was a fixed
  // Math.PI (180deg) per scene, now GUI-tunable, see DEFAULT_EXTRA_Y_ROTATIONS
  // and the "Model Rotation" GUI folder below.
  const [extraYRotations, setExtraYRotations] = useState(
    DEFAULT_EXTRA_Y_ROTATIONS,
  );
  const [sweepAngleDeg, setSweepAngleDeg] = useState(DEFAULT_SWEEP_ANGLE_DEG);
  // Per-scene bloom target (strength/radius/threshold) — see
  // DEFAULT_BLOOM_TARGETS and the "Scene Bloom" GUI folder below.
  const [bloomTargets, setBloomTargets] = useState(DEFAULT_BLOOM_TARGETS);
  // N8AO + film grade (contrast/vignette) — see postFxDefaults.js's own
  // comment for why N8AO replaces three.js's SSAOPass here. GUI-tunable via
  // the "Post FX" folder below.
  const [aoParams, setAoParams] = useState(DEFAULT_AO);
  const [gradeParams, setGradeParams] = useState(DEFAULT_GRADE);

  // `basePanel` is either this scene's own dedicated panel (ownGui, created
  // by useDebugGui above) or the page-shared one passed in via `sharedGui` —
  // either way it doesn't exist yet on the very first render (useDebugGui's
  // own effect hasn't run, or the parent hasn't created/passed its shared
  // panel down yet), so this effect is keyed on it rather than running once
  // on mount. When sharing, everything below is built under a dedicated
  // "Scene V2" sub-folder so it can't collide with another section's (e.g.
  // ProductV2's) folder names on the same shared panel; standalone, basePanel
  // IS already this scene's own panel, so it's used directly as the root.
  useEffect(() => {
    if (!basePanel) return undefined;
    const root = sharedGui ? basePanel.addFolder("Scene V2") : basePanel;

    const scenesFolder = root.addFolder("Scenes");
    SCENES.forEach((scene) => {
      scenesFolder
        .add({ [scene.id]: true }, scene.id)
        .name(scene.label)
        .onChange((v) => setEnabled((prev) => ({ ...prev, [scene.id]: v })));
    });
    root
      .add({ fov: DEFAULT_FOV }, "fov", 10, 120, 1)
      .name("Camera FOV")
      .onChange((v) => setFov(v));
    root
      .add(
        { transitionFov: DEFAULT_TRANSITION_FOV },
        "transitionFov",
        10,
        120,
        1,
      )
      .name("Transition FOV")
      .onChange((v) => setTransitionFov(v));
    root
      .add({ minimap: true }, "minimap")
      .name("Debug Minimap")
      .onChange((v) => setMinimapEnabled(v));
    root
      .add({ stats: false }, "stats")
      .name("Show FPS Stats")
      .onChange((v) => setStatsEnabled(v));
    root
      .add({ sweepAngle: DEFAULT_SWEEP_ANGLE_DEG }, "sweepAngle", 10, 180, 1)
      .name("Sweep Angle")
      .onChange((v) => setSweepAngleDeg(v));

    const rotationFolder = root.addFolder("Model Rotation");
    const rotationSettings = Object.fromEntries(
      SCENES.map((s) => [
        s.id,
        THREE.MathUtils.radToDeg(DEFAULT_EXTRA_Y_ROTATIONS[s.id]),
      ]),
    );
    SCENES.forEach((scene) => {
      rotationFolder
        .add(rotationSettings, scene.id, 0, 360, 1)
        .name(scene.label)
        .onChange((v) =>
          setExtraYRotations((prev) => ({
            ...prev,
            [scene.id]: THREE.MathUtils.degToRad(v),
          })),
        );
    });

    // Per-scene bloom target — replaces the old flat, global "Bloom" folder
    // that used to live on PostFX itself (see PostFX.jsx's own comment).
    // Each scene gets its own strength/radius/threshold; the carousel
    // cross-fades PostFX's actual bloom pass toward whichever scene is
    // resting/incoming (see swingCarousel.js's applyTransitionBloom).
    const bloomFolder = root.addFolder("Scene Bloom");
    SCENES.forEach((scene) => {
      const sceneBloom = bloomFolder.addFolder(scene.label);
      const settings = { ...DEFAULT_BLOOM_TARGETS[scene.id] };
      const onBloomChange = () =>
        setBloomTargets((prev) => ({
          ...prev,
          [scene.id]: { ...settings },
        }));
      sceneBloom
        .add(settings, "strength", 0, 3, 0.01)
        .name("Strength")
        .onChange(onBloomChange);
      sceneBloom
        .add(settings, "radius", 0, 1, 0.01)
        .name("Radius")
        .onChange(onBloomChange);
      sceneBloom
        .add(settings, "threshold", 0, 1, 0.01)
        .name("Threshold")
        .onChange(onBloomChange);
    });
    bloomFolder.close();

    // N8AO (see postFxDefaults.js's own comment for why it replaced three.js's
    // SSAOPass) + film grade (contrast/vignette, hue-neutral on purpose).
    const postFxFolder = root.addFolder("Post FX");

    const aoFolder = postFxFolder.addFolder("AO (N8AO)");
    const aoSettings = { ...DEFAULT_AO };
    const onAoChange = () => setAoParams({ ...aoSettings });
    aoFolder.add(aoSettings, "enabled").name("Enabled").onChange(onAoChange);
    aoFolder
      .add(aoSettings, "aoRadius", 0, 10, 0.05)
      .name("AO Radius")
      .onChange(onAoChange);
    aoFolder
      .add(aoSettings, "distanceFalloff", 0, 5, 0.05)
      .name("Distance Falloff")
      .onChange(onAoChange);
    aoFolder
      .add(aoSettings, "intensity", 0, 10, 0.1)
      .name("Intensity")
      .onChange(onAoChange);
    aoFolder
      .add(aoSettings, "screenSpaceRadius")
      .name("Screen-space Radius")
      .onChange(onAoChange);
    aoFolder
      .add(aoSettings, "halfRes")
      .name("Half Resolution")
      .onChange(onAoChange);
    aoFolder.close();

    const gradeFolder = postFxFolder.addFolder("Grade");
    const gradeSettings = { ...DEFAULT_GRADE };
    const onGradeChange = () => setGradeParams({ ...gradeSettings });
    gradeFolder
      .add(gradeSettings, "contrast", -0.5, 0.5, 0.01)
      .name("Contrast")
      .onChange(onGradeChange);
    gradeFolder
      .add(gradeSettings, "vignetteOffset", 0, 1, 0.01)
      .name("Vignette Offset")
      .onChange(onGradeChange);
    gradeFolder
      .add(gradeSettings, "vignetteDarkness", 0, 1.5, 0.01)
      .name("Vignette Darkness")
      .onChange(onGradeChange);
    postFxFolder.close();

    const posFolder = root.addFolder("Camera Position");
    const posSettings = {
      x: DEFAULT_CAMERA.position[0],
      y: DEFAULT_CAMERA.position[1],
      z: DEFAULT_CAMERA.position[2],
    };
    const onPosChange = () =>
      setDebugCameraPosition({
        x: posSettings.x,
        y: posSettings.y,
        z: posSettings.z,
      });
    posFolder.add(posSettings, "x", -40, 40, 0.1).onChange(onPosChange);
    posFolder.add(posSettings, "y", -20, 40, 0.1).onChange(onPosChange);
    posFolder.add(posSettings, "z", -40, 40, 0.1).onChange(onPosChange);

    // Dumps every control currently under `root` — the five scenes' own
    // folders (Fog/Sea/Droplet/Glass/etc., added directly to this same
    // panel by each scene component via SceneEngineContext, see
    // SceneContents/contextValue above), Scene Bloom, and Post FX (AO +
    // Grade) — as one JSON file via lil-gui's own save() (walks
    // controllers/folders recursively, keyed by the `.name()`/folder title
    // each was given above). Whatever's dialed in at click time becomes the
    // new starting point: overwrite scenes-v2/scene-v2-settings.json with
    // the downloaded file and every value in it becomes the app's initial
    // value on next load (see the sceneV2Settings import above and its
    // root.load()/applyFolderSettings() call sites) — no DEFAULT_* editing
    // needed.
    root
      .addFolder("Export")
      .add(
        {
          exportSettings: () => {
            const snapshot = root.save();
            const json = JSON.stringify(snapshot, null, 2);
            console.log("[Scene V2] Exported settings:", snapshot);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `scene-v2-settings-${new Date()
              .toISOString()
              .replace(/[:.]/g, "-")}.json`;
            link.click();
            URL.revokeObjectURL(url);
          },
        },
        "exportSettings",
      )
      .name("Export Settings (JSON)");

    // Applies scene-v2-settings.json over the DEFAULT_* values above, for
    // every folder that already exists at this point (everything built
    // synchronously in this effect: Scenes, Camera FOV/Transition FOV/
    // Debug Minimap/Show FPS Stats/Sweep Angle, Model Rotation, Scene
    // Bloom, Post FX, Camera Position). Each scene's own material folders
    // (Fog/Sea/Droplet/...) don't exist yet at this point — they're added
    // once that scene's assets finish loading — so each scene applies its
    // own slice itself via applyFolderSettings (see SceneOneV2.jsx etc.).
    root.load(sceneV2Settings);

    root.open();
    // lil-gui is an external, imperative DOM system — this effect's whole
    // job is to synchronize a fresh folder/panel into React state so context
    // can hand it to scene components. There's no way to do that without a
    // setState call inside the effect that created it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScenePanel(root);
    return () => {
      // Only this scene's own sub-folder is ours to tear down when sharing —
      // the shared panel itself outlives this component (owned by whoever
      // created it, e.g. HomeV2Page). Standalone, basePanel/root IS the owned
      // panel, and useDebugGui's own effect already destroys it.
      if (sharedGui) root.destroy();
      setScenePanel((current) => (current === root ? null : current));
    };
  }, [basePanel, sharedGui]);

  const contextValue = useMemo(
    () => ({ engine, gui: scenePanel, settings: sceneV2Settings }),
    [engine, scenePanel],
  );
  const sectionRef = useRef(null);

  // R3F's default frameloop ("always") renders forever once mounted, with no
  // regard for whether .scene-v2 is anywhere near the viewport — so every
  // scroll past this section (into ProductShelf/KeyHighlights/VideoHero/
  // Footer) was still paying for 5 scenes' worth of materials, water-
  // reflection passes (see engine.js), and PostFX's bloom composer, every
  // single frame, competing with whatever's actually on screen for GPU/main-
  // thread time — see FooterScene's own IntersectionObserver gate for the
  // same class of bug it already had to fix once. rootMargin gives it a full
  // viewport of lead time each way so the very first frame after crossing
  // back in is already correct — nothing here depends on wall-clock time
  // (see swingCarousel.js's own comment), it's all driven off live scroll
  // position, so pausing/resuming the loop is safe with no catch-up frame.
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Handed down into useSwingCarousel so it can stop()/start() Lenis itself
  // — see that hook's own comment for why that's necessary now that
  // .scene-v2 is a real in-flow sticky section rather than a fixed overlay.
  const lenis = useLenis();

  // Which scene is currently resting at FRONT — drives the bottom-of-screen
  // caption (see SceneCaption) below. Kept as plain state up here (outside
  // the Canvas) rather than read directly from progressRef, since this
  // overlay is regular DOM, not R3F — see ActiveSceneTracker.
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

  return (
    // Gives the page real, normal-flow scroll distance for the swing
    // carousel, and doubles as the sticky containing block for `.scene-v2`
    // below — see its own CSS comment for how the two work together. 50vh
    // per scene (see swingCarousel.js's STEP_VH_FRACTION): sceneCount - 1
    // transitions of 50vh each to cycle through every scene, plus a trailing
    // 50vh rest zone for the last one, plus one more 50vh of plain buffer
    // after that so the last bottle gets to sit still for a beat before
    // KeyHighlightsV2 scrolls up over it — without this the handoff lands
    // mid-rest, right as the carousel unsticks.
    <div
      ref={sectionRef}
      className="scene-v2__scroll-section"
      style={{ height: `${SCENES.length * 50 + 50}vh` }}
    >
      <div className="scene-v2">
        <Canvas
          className="scene-v2__canvas"
          frameloop={nearViewport ? "always" : "never"}
          dpr={[1, 2]}
          camera={{
            fov: DEFAULT_FOV,
            near: 0.1,
            far: 1000,
            position: DEFAULT_CAMERA.position,
          }}
          gl={{ antialias: false, alpha: true }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.8;
          }}
        >
          <color attach="background" args={[0x000000]} />
          {statsEnabled && <Stats />}
          <SceneEngineContext.Provider value={contextValue}>
            <SceneContents
              enabled={enabled}
              sectionRef={sectionRef}
              fov={fov}
              transitionFov={transitionFov}
              minimapEnabled={minimapEnabled}
              debugCameraPosition={debugCameraPosition}
              extraYRotations={extraYRotations}
              sweepAngle={THREE.MathUtils.degToRad(sweepAngleDeg)}
              onActiveSceneChange={setActiveSceneIndex}
              lenis={lenis}
              postFxEnabled={postFxEnabled}
              bloomTargets={bloomTargets}
              aoParams={aoParams}
              gradeParams={gradeParams}
            />
          </SceneEngineContext.Provider>
        </Canvas>

        <SceneCaption sceneId={SCENES[activeSceneIndex]?.id} />

        {/* Purely cosmetic frame around the minimap's WebGL inset (drawn
            straight into the canvas by PostFX via scissor/viewport) — same
            size/offset as MINIMAP_SIZE/MINIMAP_PAD so it lines up exactly.
            pointer-events: none so it never intercepts the carousel's own
            window-level wheel handling. */}
        {minimapEnabled && (
          <div className="scene-v2__minimap-frame">
            <span className="scene-v2__minimap-label">Debug: top-down</span>
          </div>
        )}

        <Loader />
      </div>
    </div>
  );
}
