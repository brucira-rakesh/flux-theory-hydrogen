import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Loader, Stats } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";

import { SceneEngineContext } from "../scenes-v2/SceneEngineContext";
import { createSceneEngine } from "../scenes-v2/engine";
import { useDebugGui } from "../scenes-v2/useDebugGui";
import { useSceneEngine } from "../scenes-v2/SceneEngineContext";
import { useSharedMaps } from "../scenes-v2/useSharedMaps";
import PostFX from "../scenes-v2/PostFX";
import SceneOneV2 from "../scenes-v2/scenes/SceneOneV2";
import SceneTwoV2 from "../scenes-v2/scenes/SceneTwoV2";
import SceneThreeV2 from "../scenes-v2/scenes/SceneThreeV2";
import SceneFourV2 from "../scenes-v2/scenes/SceneFourV2";
import SceneFiveV2 from "../scenes-v2/scenes/SceneFiveV2";
import BottleRigV2 from "../scenes-v2/scenes/BottleRigV2";
import { BOTTLE_URLS } from "../scenes-v2/bottleUrls";
import "./ScenePreviewPage.css";

// Same 5 scenes as Scene.v2.jsx's carousel (see SCENES there), in plain
// numeric order — this page has no swing carousel, just one scene shown at
// a time in front of a fixed camera, so the carousel's front/back pairing
// doesn't apply here.
const SCENES = [
  {
    id: "one",
    label: "Scene One",
    Component: SceneOneV2,
    bottleUrl: BOTTLE_URLS.four,
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
  {
    id: "five",
    label: "Scene Five",
    Component: SceneFiveV2,
    bottleUrl: BOTTLE_URLS.three,
  },
];

// Per-scene "face the camera" correction (radians) — mirrors Scene.v2.jsx's
// DEFAULT_EXTRA_Y_ROTATIONS/"Model Rotation" GUI folder. PI is the same
// starting point used there; GUI-tunable per scene at runtime below.
const DEFAULT_EXTRA_Y_ROTATIONS = Object.fromEntries(
  SCENES.map((s) => [s.id, Math.PI]),
);

// Per-scene bloom TARGET (see PostFX.jsx) — each scene owns its own
// strength/radius/threshold, GUI-tunable via the "Scene Bloom" folder below.
// PostFX no longer has its own static global sliders; switching the active
// scene here tweens progressRef.current.bloom toward this target instead of
// snapping (see the effect in PreviewSceneContents), the same cross-fade
// Scene.v2.jsx's carousel does mid-transition.
const DEFAULT_BLOOM_TARGET = { strength: 1.6, radius: 0.55, threshold: 0.65 };
const DEFAULT_BLOOM_TARGETS = Object.fromEntries(
  SCENES.map((s) => [s.id, { ...DEFAULT_BLOOM_TARGET }]),
);

const DEFAULT_FOV = 45;
// Every scene is parked at the world origin here (no carousel ring, see
// module comment above) — the camera just sits a fixed standoff in front of
// it, same 6-unit distance Scene.v2.jsx's DEFAULT_CAMERA uses between its
// resting position and the FRONT slot.
const CAMERA_POSITION = [0, 0.2, 6];
const CAMERA_TARGET = [0, 0, 0];

// drei's <Environment preset> — an HDRI env map, useful here for testing how
// the (lit, PBR) bottle glTFs and Scene Four's glass panels read under
// different lighting; the scenes' own baked/unlit meshes are unaffected by
// it either way (see PreviewLights' own comment). "none" mounts no
// <Environment> at all, matching how this page looked before this control
// existed.
const ENV_PRESETS = [
  "none",
  "apartment",
  "city",
  "dawn",
  "forest",
  "lobby",
  "night",
  "park",
  "studio",
  "sunset",
  "warehouse",
];

// Camera stays fixed — this page only ever toggles which scene group is
// visible, it never moves the camera on its own (see CameraRig in
// Scene.v2.jsx for the carousel's equivalent, which this intentionally
// simplifies by dropping the gsap tween: nothing here animates on its own).
function PreviewCamera({ fov, debugPosition }) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3(...CAMERA_TARGET));

  useEffect(() => {
    camera.position.set(...CAMERA_POSITION);
    camera.lookAt(lookTarget.current);
  }, [camera]);

  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [fov, camera]);

  useEffect(() => {
    if (!debugPosition) return;
    camera.position.set(debugPosition.x, debugPosition.y, debugPosition.z);
    camera.lookAt(lookTarget.current);
  }, [debugPosition, camera]);

  return null;
}

// Scene.v2.jsx's own SceneLights/BottleLights rigs (see there) hard-code
// their hemi/directional args with no GUI — this page adds one, since these
// are the only lights any scene here actually receives (models are unlit,
// baked MeshBasicMaterial; only the lit PBR bottle glTFs and Scene Four's
// glass panels see these at all — same two lights Scene.jsx originally set
// up once, globally, for exactly that). One "<label> Lights" folder per
// call, live-editable, added once `gui` exists.
function PreviewLights({ label }) {
  const { gui } = useSceneEngine();
  const hemiRef = useRef(null);
  const dirRef = useRef(null);
  const ambientRef = useRef(null);

  useEffect(() => {
    if (!gui || !hemiRef.current || !dirRef.current || !ambientRef.current)
      return undefined;
    const hemi = hemiRef.current;
    const dir = dirRef.current;
    const ambient = ambientRef.current;
    const folder = gui.addFolder(`${label} Lights`);
    const params = {
      sky: `#${hemi.color.getHexString()}`,
      ground: `#${hemi.groundColor.getHexString()}`,
      dirColor: `#${dir.color.getHexString()}`,
      ambientColor: `#${ambient.color.getHexString()}`,
    };

    const hemiFolder = folder.addFolder("Hemisphere");
    hemiFolder.add(hemi, "intensity", 0, 5, 0.01).name("Intensity");
    hemiFolder
      .addColor(params, "sky")
      .name("Sky color")
      .onChange((v) => hemi.color.set(v));
    hemiFolder
      .addColor(params, "ground")
      .name("Ground color")
      .onChange((v) => hemi.groundColor.set(v));

    const dirFolder = folder.addFolder("Directional");
    dirFolder.add(dir, "intensity", 0, 10, 0.01).name("Intensity");
    dirFolder
      .addColor(params, "dirColor")
      .name("Color")
      .onChange((v) => dir.color.set(v));
    dirFolder.add(dir.position, "x", -20, 20, 0.1).name("Position X");
    dirFolder.add(dir.position, "y", -20, 20, 0.1).name("Position Y");
    dirFolder.add(dir.position, "z", -20, 20, 0.1).name("Position Z");

    // Flat, direction-less fill light — cheap stand-in for ambient occlusion
    // "softness" when tuning how lit the PBR bottle/glass looks without a
    // strong directional key (real screen-space AO is a postprocessing pass,
    // out of scope here — see the conversation this was requested in).
    const ambientFolder = folder.addFolder("Ambient");
    ambientFolder.add(ambient, "intensity", 0, 5, 0.01).name("Intensity");
    ambientFolder
      .addColor(params, "ambientColor")
      .name("Color")
      .onChange((v) => ambient.color.set(v));

    folder.close();
    return () => folder.destroy();
  }, [gui, label]);

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
      <ambientLight ref={ambientRef} args={[0xffffff, 0.5]} />
    </>
  );
}

// One scene's group, parked at the origin and only shown when it's the
// active preview. Kept mounted (not conditionally rendered) even when
// inactive, so every scene's model + GUI folder loads once, up front, and
// switching the active scene is an instant visibility flip rather than a
// reload. Hiding the group also hides its own PreviewLights (a THREE
// Object3D with visible=false skips its light children too — see
// engine.js's isWaterOnScreen, which does the same walk-up-and-check for
// water reflections), so inactive scenes contribute nothing to the frame.
function PreviewSceneGroup({
  scene,
  active,
  sharedMaps,
  extraYRotation,
  postFxEnabled,
}) {
  const Comp = scene.Component;
  const rotationY = Math.PI + extraYRotation;
  return (
    <group visible={active} rotation={[0, rotationY, 0]}>
      <PreviewLights label={scene.label} />
      <Comp
        visible={active}
        sharedMaps={sharedMaps}
        postFxEnabled={postFxEnabled}
      />
    </group>
  );
}

function PreviewSceneContents({
  activeIndex,
  extraYRotations,
  fov,
  debugCameraPosition,
  postFxEnabled,
  showBottle,
  envPreset,
  envBackground,
  bloomTargets,
}) {
  const sharedMaps = useSharedMaps();
  // BottleRigV2 expects the same progressRef shape useSwingCarousel drives
  // (see swingCarousel.js) — step stays 0 (no carousel spin here), only
  // frontIndex moves, kept in sync with the GUI-picked active scene. `bloom`
  // mirrors swingCarousel.js's own progressRef.current.bloom — PostFX reads
  // it once per frame (see its own useFrame) regardless of which page mounts
  // it, so this page drives it the same way: not the target directly, but a
  // value gsap-tweened toward it below, so switching scenes cross-fades the
  // bloom pass instead of snapping.
  const progressRef = useRef({
    step: 0,
    frontIndex: activeIndex,
    bloom: {
      ...(bloomTargets[SCENES[activeIndex].id] ?? DEFAULT_BLOOM_TARGET),
    },
  });
  useEffect(() => {
    progressRef.current.frontIndex = activeIndex;
  }, [activeIndex]);

  const bloomTweenRef = useRef(null);
  useEffect(() => {
    const target = bloomTargets[SCENES[activeIndex].id];
    if (!target) return undefined;
    bloomTweenRef.current?.kill();
    // Retargets from wherever progressRef.current.bloom actually is right
    // now (gsap.to reads the object's live values as its start point), so
    // switching scenes mid-tween chains smoothly rather than jumping.
    bloomTweenRef.current = gsap.to(progressRef.current.bloom, {
      ...target,
      duration: 0.6,
      ease: "power2.out",
    });
    return () => bloomTweenRef.current?.kill();
  }, [activeIndex, bloomTargets]);

  const enabledAll = useMemo(
    () => Object.fromEntries(SCENES.map((s) => [s.id, true])),
    [],
  );

  return (
    <>
      <PreviewCamera fov={fov} debugPosition={debugCameraPosition} />
      {SCENES.map((scene, i) => (
        <PreviewSceneGroup
          key={scene.id}
          scene={scene}
          active={i === activeIndex}
          sharedMaps={sharedMaps}
          extraYRotation={extraYRotations[scene.id]}
          postFxEnabled={postFxEnabled}
        />
      ))}
      {showBottle && (
        <>
          <PreviewLights label="Bottle" />
          <BottleRigV2
            scenes={SCENES}
            enabled={enabledAll}
            position={[0, 0, 0]}
            rotationY={Math.PI}
            progressRef={progressRef}
          />
        </>
      )}
      {postFxEnabled && (
        <PostFX
          minimapEnabled={false}
          minimapCamera={null}
          progressRef={progressRef}
        />
      )}
      {envPreset !== "none" && (
        <Environment preset={envPreset} background={envBackground} />
      )}
    </>
  );
}

// Standalone QA/tuning page — every one of Scene.v2.jsx's 5 carousel scenes,
// previewable one at a time in front of a fixed camera, with no scroll
// carousel driving them. Owns its own lil-gui panel (unlike SceneV2, which
// can share one via a `gui` prop) since this page is never embedded
// alongside another section.
export default function ScenePreviewPage() {
  const gui = useDebugGui("Scene Preview");
  const [engine] = useState(() => createSceneEngine());
  const [activeIndex, setActiveIndex] = useState(0);
  const [fov, setFov] = useState(DEFAULT_FOV);
  const [extraYRotations, setExtraYRotations] = useState(
    DEFAULT_EXTRA_Y_ROTATIONS,
  );
  const [postFxEnabled, setPostFxEnabled] = useState(true);
  const [showBottle, setShowBottle] = useState(true);
  const [statsEnabled, setStatsEnabled] = useState(false);
  const [envPreset, setEnvPreset] = useState("none");
  const [envBackground, setEnvBackground] = useState(false);
  const [bloomTargets, setBloomTargets] = useState(DEFAULT_BLOOM_TARGETS);
  const [debugCameraPosition, setDebugCameraPosition] = useState(() => ({
    x: CAMERA_POSITION[0],
    y: CAMERA_POSITION[1],
    z: CAMERA_POSITION[2],
  }));

  useEffect(() => {
    if (!gui) return undefined;

    const previewFolder = gui.addFolder("Preview");
    const previewParams = { scene: SCENES[0].id };
    const sceneController = previewFolder
      .add(
        previewParams,
        "scene",
        Object.fromEntries(SCENES.map((s) => [s.label, s.id])),
      )
      .name("Active Scene")
      .onChange((id) => setActiveIndex(SCENES.findIndex((s) => s.id === id)));

    // step() moves previewParams/sceneController in lockstep with the
    // actual index, WITHOUT going through setValue() — setValue() would
    // re-fire onChange above and call setActiveIndex a second time.
    const step = (dir) =>
      setActiveIndex((i) => {
        const next = (i + dir + SCENES.length) % SCENES.length;
        previewParams.scene = SCENES[next].id;
        sceneController.updateDisplay();
        return next;
      });
    const nav = { prev: () => step(-1), next: () => step(1) };
    previewFolder.add(nav, "prev").name("< Previous Scene");
    previewFolder.add(nav, "next").name("Next Scene >");

    previewFolder
      .add({ fov: DEFAULT_FOV }, "fov", 10, 120, 1)
      .name("Camera FOV")
      .onChange(setFov);
    previewFolder
      .add({ postfx: true }, "postfx")
      .name("Enable PostFX (Bloom)")
      .onChange(setPostFxEnabled);
    previewFolder
      .add({ bottle: true }, "bottle")
      .name("Show Bottle")
      .onChange(setShowBottle);
    previewFolder
      .add({ stats: false }, "stats")
      .name("Show FPS Stats")
      .onChange(setStatsEnabled);
    previewFolder.open();

    const envFolder = gui.addFolder("Environment");
    const envSettings = { preset: "none", background: false };
    envFolder
      .add(envSettings, "preset", ENV_PRESETS)
      .name("HDR Environment")
      .onChange(setEnvPreset);
    envFolder
      .add(envSettings, "background")
      .name("Show as Background")
      .onChange(setEnvBackground);
    envFolder.open();

    const rotationFolder = gui.addFolder("Model Rotation");
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

    // Per-scene bloom target — replaces PostFX's old flat, global "Bloom"
    // folder (see PostFX.jsx's own comment). Switching the active scene
    // above tweens the live bloom pass toward whichever scene's target this
    // sets (see PreviewSceneContents' bloomTweenRef effect).
    const bloomFolder = gui.addFolder("Scene Bloom");
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

    const posFolder = gui.addFolder("Camera Position");
    const posSettings = {
      x: CAMERA_POSITION[0],
      y: CAMERA_POSITION[1],
      z: CAMERA_POSITION[2],
    };
    const onPosChange = () => setDebugCameraPosition({ ...posSettings });
    posFolder.add(posSettings, "x", -20, 20, 0.1).onChange(onPosChange);
    posFolder.add(posSettings, "y", -20, 20, 0.1).onChange(onPosChange);
    posFolder.add(posSettings, "z", -20, 20, 0.1).onChange(onPosChange);

    return () => {
      previewFolder.destroy();
      envFolder.destroy();
      rotationFolder.destroy();
      bloomFolder.destroy();
      posFolder.destroy();
    };
  }, [gui]);

  const contextValue = useMemo(() => ({ engine, gui }), [engine, gui]);

  return (
    <div className="scene-preview-page">
      <Canvas
        className="scene-preview-page__canvas"
        dpr={[1, 2]}
        camera={{
          fov: DEFAULT_FOV,
          near: 0.1,
          far: 1000,
          position: CAMERA_POSITION,
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
          <PreviewSceneContents
            activeIndex={activeIndex}
            extraYRotations={extraYRotations}
            fov={fov}
            debugCameraPosition={debugCameraPosition}
            postFxEnabled={postFxEnabled}
            showBottle={showBottle}
            envPreset={envPreset}
            envBackground={envBackground}
            bloomTargets={bloomTargets}
          />
        </SceneEngineContext.Provider>
      </Canvas>

      <p className="scene-preview-page__label">{SCENES[activeIndex].label}</p>
      <p className="scene-preview-page__hint">
        Use the "Preview" panel to switch scenes
      </p>

      <Loader />
    </div>
  );
}
