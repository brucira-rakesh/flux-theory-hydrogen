import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RectAreaLightHelper } from "three/examples/jsm/helpers/RectAreaLightHelper.js";
import { useSceneEngine } from "../SceneEngineContext";
import { STUDIO_TUNED_EXPOSURE, studioExposureScale } from "../studioExposure";
import {
  DEFAULT_STUDIO_SCENE_ID,
  STUDIO_SCENE_OPTIONS,
  TINTED_LIGHT_NAMES,
  TINT_DURATION_SEC,
  getSceneTint,
  serializeSceneTints,
  setSceneTint,
} from "./studioSceneTints";

// Lighting rig ported from the Blender studio setup authored for the bottle
// hero shot (see C:\Users\priya\Downloads\brucira\Bottle.blend — extracted by
// parsing the .blend file's DNA blocks directly, no Blender install
// available). Every object below is one light OBJECT in that file, listed in
// the order Blender's outliner would show them.
//
// Blender is Z-up, right-handed; three.js/glTF is Y-up, right-handed. Rather
// than hand-converting each Euler rotation (error-prone: XYZ Euler angles
// don't survive an axis swap by simply permuting components), each light's
// LOCAL forward vector (both engines point a light down local -Z) is computed
// in Blender space from its Euler rotation, then that forward vector and the
// position are each remapped Blender(x,y,z) -> three(x,z,-y) — the standard
// Blender->glTF axis convention, the same one the bottle's own GLB export
// used. The light is then aimed with `lookAt`, matching Blender's authored
// direction without needing a full quaternion axis-conversion.
//
// Energy values are Blender's raw "Power" (Watts) — not a physical unit
// three.js lights share — so they're only a starting point, scaled by
// AREA_INTENSITY_SCALE/POINT_INTENSITY_SCALE below and GUI-tunable from
// there, the same "port the numbers, tune from a GUI" approach ProductLights
// takes with its own EXPOSURE_COMPENSATION.
const BLENDER_LIGHTS = [
  {
    name: "Area",
    type: "AREA",
    shape: "SQUARE",
    energy: 12.7324,
    color: [0.7063, 0.7609, 1.0],
    size: 1.0,
    sizeY: 1.0,
    scale: 0.6521,
    position: [0.5109, 2.2987, 0.4534],
    rotationDeg: [-62.747, 7.494, -144.179],
  },
  {
    name: "Area.001",
    type: "AREA",
    shape: "DISK",
    energy: 82.888,
    color: [1.0, 0.5, 0.299],
    size: 1.0,
    sizeY: 1.0,
    scale: 1,
    position: [1.1145, 3.2281, 1.0009],
    rotationDeg: [12.125, 32.194, -33.468],
  },
  {
    name: "Area.002",
    type: "SPOT",
    energy: 100.0,
    color: [1.0, 0.7287, 0.4055],
    spotAngleDeg: 18.1,
    spotBlend: 0.4712,
    position: [1.3653, 6.2255, 0.9487],
    rotationDeg: [6.655, -7.384, 52.671],
  },
  {
    name: "Area.003",
    type: "SPOT",
    energy: 100.0,
    color: [1.0, 0.7287, 0.4055],
    spotAngleDeg: 38.9,
    spotBlend: 0.4712,
    position: [-1.0749, 6.2342, 0.9967],
    rotationDeg: [7.658, -8.683, 52.53],
  },
  {
    name: "Area.004",
    type: "SPOT",
    energy: 100.0,
    color: [1.0, 0.3088, 0.0631],
    spotAngleDeg: 76.1,
    spotBlend: 0.4712,
    position: [1.309, 2.7479, -0.1716],
    rotationDeg: [129.233, 38.491, 52.0],
  },
  {
    name: "Area.005",
    type: "AREA",
    shape: "SQUARE",
    energy: 12.7324,
    color: [0.8792, 0.8674, 1.0],
    size: 1.0,
    sizeY: 1.0,
    scale: 0.6521,
    position: [-0.5321, 2.1988, -0.1878],
    rotationDeg: [-84.863, 3.552, -189.816],
  },
  {
    name: "Area.006",
    type: "AREA",
    shape: "SQUARE",
    energy: 4.4818,
    color: [0.8792, 0.8674, 1.0],
    size: 1.0,
    sizeY: 1.0,
    scale: 0.2987,
    position: [-0.3086, 2.2998, 0.4848],
    rotationDeg: [-84.005, -5.724, 127.192],
  },
  {
    name: "Area.007",
    type: "AREA",
    shape: "DISK",
    energy: 41.508,
    color: [1.0, 0.3413, 0.9861],
    size: 1.0,
    sizeY: 1.0,
    scale: 1,
    position: [0.2374, 3.7584, 0.4185],
    rotationDeg: [-88.916, -41.583, 79.802],
  },
  {
    name: "Area.008",
    type: "AREA",
    shape: "SQUARE",
    energy: 12.7324,
    color: [0.7063, 0.7609, 1.0],
    size: 1.0,
    sizeY: 1.0,
    scale: 0.6521,
    position: [0.0852, 2.2987, -0.5736],
    rotationDeg: [-117.958, 48.215, -196.711],
  },
  {
    name: "Point",
    type: "POINT",
    energy: 10.0,
    color: [1.0, 0.2889, 0.0189],
    position: [-0.7963, 3.827, -0.2131],
    rotationDeg: [0, 0, 0],
  },
  {
    name: "Point.001",
    type: "POINT",
    energy: 10.0,
    color: [1.0, 0.37, 0.3061],
    position: [0.87, 2.1954, -0.0225],
    rotationDeg: [0, 0, 0],
  },
];

// Blender Watts -> three.js light intensity have no shared physical unit
// (RectAreaLight intensity is radiance-like, Point/Spot intensity is
// candela). These are starting multipliers to land the rig in a sane visual
// range; GUI sliders below take over from there per light.
const AREA_INTENSITY_SCALE = 1;
const SPOT_INTENSITY_SCALE = 1;
const POINT_INTENSITY_SCALE = 1;

// These raw-wattage scales above were dialed in on the standalone
// /bottle-studio page's own Canvas, which runs toneMappingExposure 0.2 (see
// BottleStudioPage.jsx's own comment on why — this rig has no per-light
// EXPOSURE_COMPENSATION baked in the way ProductLights.jsx's does). Reused
// as-is on a Canvas exposure of 1.8 (Scene.v2.jsx's, shared by every other
// scene) the same raw intensities render 9x hotter and blow straight to a
// flat white slab. `studioExposureScale` (see studioExposure.js) rescales
// every light so the SAME authored look holds at whatever exposure the
// calling Canvas actually runs — and the bottle's own envMapIntensity has to
// take the identical scale, or only half the shot is compensated.

const scratchEuler = new THREE.Euler();
const scratchForward = new THREE.Vector3();
const scratchTint = new THREE.Color();

// Same guard SceneV2's own reveal ramps use: the Canvas frameloop is parked
// while the section is far from the viewport, and the first frame after it
// resumes can report a delta of seconds — which would otherwise teleport a
// tint cross-fade straight to its end on that one frame.
const MAX_TINT_DELTA = 0.1;

// Blender(x, y, z) -> three.js/glTF(x, z, -y) — same convention the bottle's
// own GLB export used, so this rig lines up with that model's frame.
const blenderToThreePosition = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const blenderToThreeDirection = ([x, y, z]) => new THREE.Vector3(x, z, -y);

// Computes a light's world-space forward direction from its Blender Euler
// (XYZ order, degrees) — both Blender and three.js lights point down their
// own local -Z by default, so this only needs the rotation, not a full
// axis-swapped quaternion.
function forwardFromBlenderEuler(rotationDeg) {
  const [x, y, z] = rotationDeg.map(THREE.MathUtils.degToRad);
  scratchEuler.set(x, y, z, "XYZ");
  scratchForward.set(0, 0, -1).applyEuler(scratchEuler);
  return blenderToThreeDirection([
    scratchForward.x,
    scratchForward.y,
    scratchForward.z,
  ]);
}

// RectAreaLight emits along its own local -Z, so orienting it via its
// quaternion (lookAt) is enough. SpotLight is different: three.js computes
// its actual beam direction from `target.position - position`, in WORLD
// space, every frame — the light's own rotation/quaternion is never
// consulted for lighting (only cosmetic for e.g. a helper's gizmo, and even
// SpotLightHelper reads .target too). Calling lookAt() alone on a SpotLight
// is a no-op for what it actually illuminates, which is what silently left
// every spot light in this rig aimed at the group's default target
// position (its local origin) instead of the direction ported from
// Blender.
function aim(light, position, forward) {
  light.position.copy(position);
  const aimPoint = position.clone().add(forward);
  light.lookAt(aimPoint);
  if (light.isSpotLight) light.target.position.copy(aimPoint);
}

// One-time global init RectAreaLight needs before any instance renders
// (builds its LTC lookup textures) — safe to call more than once across
// remounts, three.js no-ops if already initialized.
RectAreaLightUniformsLib.init();

// Bottle studio lighting rig ported from Bottle.blend — every AREA/SPOT/POINT
// light authored there, at the positions/orientations/colors/power Blender
// had them at. Mounted as its own group so it can be parked anywhere the
// scene needs (in front of the camera, around the bottle) without the light
// authoring above having to know about that placement.
// The Blender scene this rig was extracted from had its camera on the
// OPPOSITE side of the bottle from where this page's camera sits — ported
// as-is, the whole rig landed behind the bottle (same side as the
// background plane), lighting the backdrop instead of the product and
// leaving the bottle's camera-facing side unlit. A rigid 180° turn about Y
// swings the whole cluster around to the camera's side while preserving
// every light's position/orientation relative to every other one (unlike a
// mirror/axis-flip, which would also flip each RectAreaLight's emitting
// face and reverse the spot cones' handedness) — restoring the intended
// camera -> lights -> bottle -> background depth order.
const RIG_ROTATION_Y = Math.PI;

export default function BottleStudioLights({
  enabled = true,
  showHelpers: showHelpersProp = false,
  position = [0, 0, 0],
  // Additive on top of RIG_ROTATION_Y below — 0 by default so every existing
  // caller keeps its exact current rig orientation. The mobile bottle canvas
  // (see scenes-v2/mobile/MobileBottleCanvas) turns the bottle itself off
  // dead-on for a static hero angle and passes the SAME offsets here so the
  // light rig turns with it, instead of lighting the bottle as if it were
  // still facing straight at the camera.
  rotationY = 0,
  rotationX = 0,
  // See studioExposure.js — pass the calling Canvas's own
  // `gl.toneMappingExposure` so every light rescales to hold the same
  // authored look there as on the page this rig was tuned against.
  canvasExposure = STUDIO_TUNED_EXPOSURE,
  // --- per-scene kicker tint (see studioSceneTints.js) -------------------
  // Two ways to say "which scene is on screen", for the two callers:
  //
  // `sceneId` — controlled/declarative, used by /bottle-studio, where the
  //   scene is whatever the debug panel's dropdown last picked (and that
  //   page swaps its backdrop loop off the same value, see onSceneChange).
  //
  // `sceneIds` + `progressRef` — the home carousel, where the front scene
  //   changes on scroll, every frame, outside React. Read off the same
  //   progressRef.frontIndex ActiveSceneTracker watches (swingCarousel.js)
  //   in this component's own useFrame, so a swing re-tints the rig without
  //   re-rendering anything inside the Canvas.
  sceneId = null,
  sceneIds = null,
  progressRef = null,
  // Called when the debug panel's own scene dropdown changes, so a page that
  // owns `sceneId` can follow it (swap backdrop + keep the two in sync).
  onSceneChange = null,
  // Initial value only — the "Scene Tint > Transition" slider owns it after
  // that (hence the ref below, not a prop read per frame).
  tintDurationSec = TINT_DURATION_SEC,
}) {
  const exposureCompensation = studioExposureScale(canvasExposure);
  const groupRef = useRef(null);
  const { gui } = useSceneEngine();
  const rigRef = useRef([]);
  // Just the TINTED_LIGHT_NAMES subset of rigRef, each with its authored
  // Blender colour (`base`, the fallback for a scene with no tint) plus the
  // live cross-fade state the useFrame below advances.
  const tintedRef = useRef([]);
  const sceneIdRef = useRef(sceneId ?? DEFAULT_STUDIO_SCENE_ID);
  const tintDurationRef = useRef(tintDurationSec);
  // Held in a ref (synced in its own effect, never during render) so the
  // lil-gui callbacks below — built once, in an effect keyed on `gui` — can
  // call the LATEST handler without the panel having to be rebuilt whenever
  // a parent hands down a new function identity.
  const onSceneChangeRef = useRef(onSceneChange);
  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);
  // Set by the GUI effect below — lets a scene change coming from anywhere
  // (scroll, the `sceneId` prop) push the panel's own dropdown/swatches back
  // in sync instead of leaving them showing the previous scene's values.
  const guiSyncRef = useRef(null);
  // GUI-toggleable on top of the prop default — the "Show helpers"
  // checkbox below flips this independently of whatever the page passed in.
  const [showHelpers, setShowHelpers] = useState(showHelpersProp);

  // Starts (or, with `immediate`, snaps) the cross-fade of every tinted
  // light to `nextSceneId`'s colours. Cheap and idempotent: re-applying the
  // scene already showing is a no-op, so the per-frame carousel watcher can
  // call it freely.
  const applyTint = useCallback((nextSceneId, { immediate = false } = {}) => {
    sceneIdRef.current = nextSceneId;
    tintedRef.current.forEach((entry) => {
      const hex = getSceneTint(nextSceneId, entry.name);
      const target = hex ? scratchTint.set(hex) : entry.base;
      if (entry.progress >= 1 && entry.light.color.equals(target)) return;
      entry.from.copy(entry.light.color);
      entry.to.copy(target);
      entry.progress = immediate ? 1 : 0;
      if (immediate) entry.light.color.copy(entry.to);
    });
    guiSyncRef.current?.(nextSceneId);
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;

    const created = BLENDER_LIGHTS.map((def) => {
      const position = blenderToThreePosition(def.position);
      const forward = forwardFromBlenderEuler(def.rotationDeg);
      const color = new THREE.Color(...def.color);

      if (def.type === "AREA") {
        const light = new THREE.RectAreaLight(
          color,
          def.energy * AREA_INTENSITY_SCALE * exposureCompensation,
          def.size * def.scale,
          def.sizeY * def.scale,
        );
        aim(light, position, forward);
        group.add(light);
        // RectAreaLightHelper reads the light's width/height/color straight
        // off the instance and follows its transform automatically — no
        // per-frame .update() needed, unlike Spot/PointLightHelper below.
        const helper = new RectAreaLightHelper(light);
        helper.visible = false;
        light.add(helper);
        return { def, light, helper };
      }

      if (def.type === "SPOT") {
        const light = new THREE.SpotLight(
          color,
          def.energy * SPOT_INTENSITY_SCALE * exposureCompensation,
        );
        light.angle = THREE.MathUtils.degToRad(def.spotAngleDeg);
        light.penumbra = THREE.MathUtils.clamp(def.spotBlend, 0, 1);
        light.decay = 2;
        aim(light, position, forward);
        group.add(light);
        group.add(light.target);
        const helper = new THREE.SpotLightHelper(light);
        helper.visible = false;
        group.add(helper);
        return { def, light, helper };
      }

      // POINT
      const light = new THREE.PointLight(
        color,
        def.energy * POINT_INTENSITY_SCALE * exposureCompensation,
      );
      light.position.copy(position);
      light.decay = 2;
      group.add(light);
      const helper = new THREE.PointLightHelper(light, 0.15);
      helper.visible = false;
      group.add(helper);
      return { def, light, helper };
    });

    rigRef.current = created;
    tintedRef.current = created
      .filter(({ def }) => TINTED_LIGHT_NAMES.includes(def.name))
      .map(({ def, light }) => ({
        name: def.name,
        light,
        base: light.color.clone(),
        from: light.color.clone(),
        to: light.color.clone(),
        progress: 1,
      }));
    // Snap (not fade) to whatever scene is already on screen at mount —
    // there is nothing to cross-fade FROM on the first frame.
    applyTint(sceneIdRef.current, { immediate: true });

    return () => {
      tintedRef.current = [];
      created.forEach(({ light, helper }) => {
        group.remove(light);
        if (light.target) group.remove(light.target);
        helper?.parent?.remove(helper);
        helper?.dispose?.();
      });
      rigRef.current = [];
    };
  }, []);

  useEffect(() => {
    rigRef.current.forEach(({ light }) => {
      light.visible = enabled;
    });
  }, [enabled]);

  useEffect(() => {
    rigRef.current.forEach(({ helper }) => {
      if (helper) helper.visible = showHelpers;
    });
  }, [showHelpers]);

  // Controlled path only (/bottle-studio). The carousel leaves `sceneId`
  // null and drives the same thing off progressRef in the useFrame below.
  useEffect(() => {
    if (!sceneId || sceneId === sceneIdRef.current) return;
    applyTint(sceneId);
  }, [sceneId, applyTint]);

  // Spot/PointLightHelper cache their wireframe geometry from the light's
  // transform at construction time and need an explicit .update() to follow
  // any change — RectAreaLightHelper is the only one of the three that
  // tracks its light automatically (see its own comment above).
  useFrame((_, delta) => {
    // Carousel path: follow whichever scene is resting at FRONT. Comparing
    // against sceneIdRef (rather than a step/index of our own) means a
    // scroll that flips frontIndex mid-fade just retargets the fade from
    // wherever the colour currently is.
    if (sceneIds && progressRef) {
      const nextId = sceneIds[progressRef.current?.frontIndex ?? 0];
      if (nextId && nextId !== sceneIdRef.current) applyTint(nextId);
    }

    const duration = Math.max(tintDurationRef.current, 0.001);
    tintedRef.current.forEach((entry) => {
      if (entry.progress >= 1) return;
      entry.progress = Math.min(
        1,
        entry.progress + Math.min(delta, MAX_TINT_DELTA) / duration,
      );
      // Smoothstep, so the colour eases out of the old scene and into the
      // new one instead of starting and stopping on a hard linear ramp.
      const t = entry.progress;
      entry.light.color.lerpColors(entry.from, entry.to, t * t * (3 - 2 * t));
    });

    if (!showHelpers) return;
    rigRef.current.forEach(({ helper }) => {
      if (helper?.isSpotLightHelper || helper?.isPointLightHelper) {
        helper.update();
      }
    });
  });

  // --- lil-gui debug panel: one folder per light, GUI-tunable intensity/color ---
  useEffect(() => {
    if (!gui || rigRef.current.length === 0) return undefined;
    const folder = gui.addFolder("Bottle Studio Lights");
    const colorParams = {};

    folder
      .add({ showHelpers }, "showHelpers")
      .name("Show helpers")
      .onChange(setShowHelpers);

    rigRef.current.forEach(({ def, light }) => {
      const lightFolder = folder.addFolder(`${def.name} (${def.type})`);
      colorParams[def.name] = `#${light.color.getHexString()}`;
      lightFolder
        .add(light, "intensity", 0, 200, 0.1)
        .name("Intensity");
      lightFolder
        .addColor(colorParams, def.name)
        .name("Color")
        .onChange((v) => light.color.set(v));
      lightFolder.add(light.position, "x", -10, 10, 0.01).name("Position X");
      lightFolder.add(light.position, "y", -10, 10, 0.01).name("Position Y");
      lightFolder.add(light.position, "z", -10, 10, 0.01).name("Position Z");
      if (light.isSpotLight) {
        lightFolder.add(light, "angle", 0, Math.PI / 2, 0.001).name("Angle");
        lightFolder.add(light, "penumbra", 0, 1, 0.01).name("Penumbra");
      }
      if (light.isRectAreaLight) {
        lightFolder.add(light, "width", 0, 5, 0.01).name("Width");
        lightFolder.add(light, "height", 0, 5, 0.01).name("Height");
      }
      lightFolder.close();
    });

    // --- Scene Tint: pick a scene, dial its accent colour, export ---------
    //
    // The one control that changes BOTH what the studio page shows behind
    // the bottle (via onSceneChange) and which tint the rig fades to, so
    // there's no way to end up judging scene two's colour against scene
    // three's backdrop. On the home page the scroll owns the scene instead
    // and this dropdown is a preview: the next swing overwrites it.
    //
    // Note these swatches, not the per-light "Color" controls above, are
    // what a tinted light actually ends up wearing — a scene change
    // re-applies the table below over anything typed up there.
    const tintFolder = folder.addFolder("Scene Tint");
    const tintParams = {
      scene: sceneIdRef.current,
      duration: tintDurationRef.current,
      copy: () => {
        const json = serializeSceneTints();
        // Logged as well as copied: clipboard writes are blocked outside a
        // user gesture in some browsers, and a lil-gui button click doesn't
        // always count as one by the time the promise runs.
        console.log("[BottleStudioLights] SCENE_LIGHT_TINTS =", json);
        navigator.clipboard?.writeText(json).catch(() => {});
      },
      reset: () => {
        TINTED_LIGHT_NAMES.forEach((name) => {
          const entry = tintedRef.current.find((e) => e.name === name);
          if (!entry) return;
          setSceneTint(
            tintParams.scene,
            name,
            `#${entry.base.getHexString()}`,
          );
        });
        applyTint(tintParams.scene, { immediate: true });
      },
    };

    const sceneController = tintFolder
      .add(tintParams, "scene", STUDIO_SCENE_OPTIONS)
      .name("Scene")
      .onChange((id) => {
        onSceneChangeRef.current?.(id);
        applyTint(id);
      });

    const colorControllers = TINTED_LIGHT_NAMES.map((name) => {
      tintParams[name] =
        getSceneTint(tintParams.scene, name) ??
        `#${
          tintedRef.current
            .find((e) => e.name === name)
            ?.base.getHexString() ?? "ffffff"
        }`;
      const controller = tintFolder
        .addColor(tintParams, name)
        .name(`${name} tint`)
        .onChange((hex) => {
          setSceneTint(tintParams.scene, name, hex);
          // Immediate while dragging the picker — a 1.1s fade per pixel of
          // slider travel makes the colour impossible to judge.
          applyTint(tintParams.scene, { immediate: true });
        });
      return { name, controller };
    });

    tintFolder
      .add(tintParams, "duration", 0, 4, 0.05)
      .name("Transition (s)")
      .onChange((v) => {
        tintDurationRef.current = v;
      });
    tintFolder.add(tintParams, "copy").name("Copy tints JSON");
    tintFolder.add(tintParams, "reset").name("Reset scene to Blender");

    // Called by applyTint from every source (dropdown, prop, scroll) so the
    // panel always shows the scene actually on screen and ITS colours.
    guiSyncRef.current = (id) => {
      tintParams.scene = id;
      sceneController.updateDisplay();
      colorControllers.forEach(({ name, controller }) => {
        tintParams[name] =
          getSceneTint(id, name) ??
          `#${
            tintedRef.current.find((e) => e.name === name)?.base.getHexString() ??
            "ffffff"
          }`;
        controller.updateDisplay();
      });
    };
    tintFolder.open();

    folder.close();
    return () => {
      guiSyncRef.current = null;
      folder.destroy();
    };
  }, [gui, applyTint]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[rotationX, RIG_ROTATION_Y + rotationY, 0]}
    />
  );
}
