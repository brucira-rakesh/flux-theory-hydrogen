import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneEngine } from "../SceneEngineContext";
import { fitBottleShadow } from "./useProductAssets";
import { addCopyValuesButton } from "./guiUtils";
import { FLIGHT_TARGET_NODE_NAME } from "./constants";

// Ambient + key light and the bottle's own directional light (with its own
// hand-tuned shadow-camera frustum + DirectionalLightHelper) — ported
// verbatim from Product.jsx's light/shadow setup, minus its shadow-catcher
// plane (see the mount effect's own comment on why that was dropped). Kept
// fully imperative rather than JSX, mainly because a directional
// light's `target` needs to be a real scene-graph member for three.js to
// update its matrixWorld — same as Product.jsx's own `scene.add(light.target)`
// calls.
//
// Everything is parented to this component's OWN group rather than the scene
// root (which is what Product.jsx, a standalone route owning the whole scene,
// could get away with). Every position below — the bottle light and its
// target — is authored in the ROOM's own coordinate space, and the room is
// no longer at the scene origin: it's transformed onto the carousel ring by
// the alignment solve (see useProductAlignment) and swung around by the
// carousel itself.
// Parented here, all of that rides along with the room automatically; on the
// scene root it would be left behind, lighting empty space.
// These four intensities (below) were hand-tuned on the old standalone
// Product.jsx route, whose Canvas never set toneMappingExposure — so it rendered
// at three's default of 1.0. Scene.v2.jsx's shared canvas sets
// `gl.toneMappingExposure = 1.8` for the carousel's own punchier look, and
// these lights inherited that unchanged: same intensities, 80% more exposure
// before the ACES curve, which is what was blowing out the bathroom bottle's
// key light (intensity 10 is already hot) as the flythrough camera swung
// toward its specular hotspot. Scaling every one of this rig's lights by the
// inverse ratio reproduces how they looked when they were actually tuned,
// under whatever exposure this canvas happens to run at now or later.
const TUNED_AT_EXPOSURE = 1.0;
const CURRENT_EXPOSURE = 1.8; // must match Scene.v2.jsx's gl.toneMappingExposure
const EXPOSURE_COMPENSATION = TUNED_AT_EXPOSURE / CURRENT_EXPOSURE;

// A sentinel no real world matrix can ever equal (NaN never compares equal,
// including to itself), so the shadow-map change detector below reports a
// change on its very first comparison instead of needing a separate
// "have I run yet" flag.
const NEVER_EQUAL_MATRIX = Array(16).fill(NaN);

export default function ProductLights({ assetsRef, ready, activeRef }) {
  const groupRef = useRef(null);
  const { gui } = useSceneEngine();
  const rigRef = useRef(null);
  // The one bottle that casts into bathroomBottleLight's shadow map (see
  // rebuildStandardMaterial's castShadow note) — watched per-frame so the
  // map re-renders while it flies out on reveal and goes idle again once it
  // settles.
  const shadowCasterRef = useRef(null);

  useEffect(() => {
    const scene = groupRef.current;
    if (!scene) return undefined;
    const ambientLight = new THREE.AmbientLight(
      0xfece7c,
      1 * EXPOSURE_COMPENSATION,
    );
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      2 * EXPOSURE_COMPENSATION,
    );
    directionalLight.position.set(4, 6, 4);
    scene.add(directionalLight);

    // --- Per-bottle directional lights ---
    // Hand-tuned via the "Copy values" button in the GUI — position/target/
    // color/shadow bias are the tuned result, not placeholders, so neither
    // target is re-aimed at the bottle's bounding-box center once it loads
    // (see the fit-shadow effect below, which always passes
    // `autoAimTarget: false`). Intensity is the one field NOT taken as-is —
    // see EXPOSURE_COMPENSATION above.
    const bathroomBottleLight = new THREE.DirectionalLight(
      0xfee6be,
      10 * EXPOSURE_COMPENSATION,
    );
    bathroomBottleLight.position.set(-5.6, 6.8, 1.4);
    bathroomBottleLight.target.position.set(
      -6.3852246662429,
      4.901744542284266,
      1.4861607474405694,
    );
    bathroomBottleLight.castShadow = true;
    bathroomBottleLight.shadow.mapSize.set(1024, 1024);
    bathroomBottleLight.shadow.camera.near = 0.1;
    bathroomBottleLight.shadow.camera.far = 10;
    bathroomBottleLight.shadow.camera.left = -1;
    bathroomBottleLight.shadow.camera.right = 1;
    bathroomBottleLight.shadow.camera.top = 1;
    bathroomBottleLight.shadow.camera.bottom = -1;
    bathroomBottleLight.shadow.bias = -0.0005;
    // Three.js re-renders every shadow map on every frame by default. This
    // one's depth pass is the hero bottle's own geometry (~325k tris, see
    // rebuildStandardMaterial's castShadow note) and for most of the time
    // product is on screen NOTHING in it has moved: the zoom is a camera
    // tween, and shadow maps are camera-independent. Driven on demand from
    // the useFrame below instead, which watches the only two transforms
    // that can actually change what this map contains.
    bathroomBottleLight.shadow.autoUpdate = false;
    bathroomBottleLight.shadow.needsUpdate = true;
    scene.add(bathroomBottleLight);
    scene.add(bathroomBottleLight.target);
    const bathroomBottleLightHelper = new THREE.DirectionalLightHelper(
      bathroomBottleLight,
      0.5,
    );
    // Debug-only wireframe — Product.jsx (a standalone dev route) left this
    // on by default; off by default here since this now renders inside the
    // real homepage, toggleable via the "Show helper" GUI control.
    bathroomBottleLightHelper.visible = false;
    scene.add(bathroomBottleLightHelper);

    // No shadow-catcher plane: it kept showing up as a "weird black plane"
    // artifact — its footprint (2.5x its fitted box, see fitBottleShadow)
    // was wide enough to z-fight/peek out from behind neighbouring bottles
    // on the now-crowded 5-bottle shelf, however tightly it was fitted. The
    // light itself stays (still fits its shadow-camera frustum to the
    // bottle's box below), it just has nothing dedicated to catch its
    // shadow onto — the room's own baked-lighting floor already reads fine
    // without one.
    rigRef.current = {
      ambientLight,
      directionalLight,
      bathroomBottleLight,
      bathroomBottleLightHelper,
      // Per-light debug on/off, independent of `activeRef` (which gates the
      // WHOLE rig on/off as one unit, see the useFrame below) — lets the
      // "Light On" GUI checkboxes below isolate one light at a time to track
      // down which one is actually responsible for an overexposed shot,
      // without having to zero out its intensity slider and lose the value.
      debugOn: {
        ambient: true,
        directional: true,
        bathroom: true,
      },
      // Change-detection state for the demand-driven shadow map — see the
      // useFrame below. Seeded to matrices no real transform can equal, so
      // the very first frame always counts as a change and renders once.
      shadowLightMatrix: new THREE.Matrix4().set(...NEVER_EQUAL_MATRIX),
      shadowTargetMatrix: new THREE.Matrix4().set(...NEVER_EQUAL_MATRIX),
      shadowCasterMatrix: new THREE.Matrix4().set(...NEVER_EQUAL_MATRIX),
      shadowHoldFrames: 2,
      shadowWasOn: false,
    };

    return () => {
      scene.remove(
        ambientLight,
        directionalLight,
        bathroomBottleLight,
        bathroomBottleLight.target,
        bathroomBottleLightHelper,
      );
      bathroomBottleLightHelper.dispose();
      rigRef.current = null;
    };
  }, []);

  // Re-fits the light's shadow-camera frustum to the bottle's real bounding
  // box (exposed by useProductAssets once loaded), instead of the -1..1
  // placeholder set at light-creation time above. `autoAimTarget: false`
  // keeps the hand-tuned target set above intact — this only fits the
  // frustum, never re-aims.
  useEffect(() => {
    if (!ready || !rigRef.current) return;
    const assets = assetsRef.current;
    const rig = rigRef.current;
    shadowCasterRef.current =
      assets.bathroomBottleModel?.getObjectByName(FLIGHT_TARGET_NODE_NAME) ??
      assets.bathroomBottleModel ??
      null;
    if (assets.bathroomBox) {
      fitBottleShadow(assets.bathroomBox, rig.bathroomBottleLight, null, {
        autoAimTarget: false,
      });
      rig.bathroomBottleLightHelper.update();
      // The shadow CAMERA just changed, which the per-frame matrix watch
      // below can't see (it tracks transforms, not frustum extents) — and
      // the map is demand-driven now, so it has to be told explicitly.
      rig.bathroomBottleLight.shadow.needsUpdate = true;
      rig.shadowHoldFrames = 2;
    }
    // Reflect anything the fit above changed in the GUI sliders (they may
    // have been bound before these centers were known).
    gui?.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }, [ready, assetsRef, gui]);

  // Mounted permanently now (see Scene.v2.jsx) rather than only while
  // Product's own section was on screen, so these lights need an explicit
  // on/off switch — otherwise they'd contribute to every carousel scene's
  // own lit bottle rig (BottleRigV2) the whole time, not just during the
  // product flythrough (real THREE.Light objects light the WHOLE shared
  // scene regardless of which group they're parented under — being parented
  // here only carries their position along with the room, see the module
  // comment above; it does NOT scope what they illuminate). Toggling
  // `.visible` (not intensity) is the same technique swingCarousel.js's own
  // light fade uses for "off" scenes, and three.js's lighting pass already
  // skips any light with visible=false.
  //
  // Driven off `activeRef` (a plain ref, flipped true the instant
  // useSceneToProductHandoff's timeline actually starts revealing the room —
  // see Scene.v2.jsx's own comment) rather than a React prop: a prop can
  // only change on a re-render, but the handoff flips this mid-gsap-timeline,
  // outside React's render cycle entirely, so this has to be read per-frame
  // like every other handoff-driven ref in this codebase.
  useFrame(() => {
    const rig = rigRef.current;
    if (!rig) return;
    const on = activeRef?.current ?? false;
    const { debugOn } = rig;
    rig.ambientLight.visible = on && debugOn.ambient;
    rig.directionalLight.visible = on && debugOn.directional;
    rig.bathroomBottleLight.visible = on && debugOn.bathroom;
    rig.bathroomBottleLightHelper.update();

    // Demand-driven shadow map (see the light's own shadow.autoUpdate
    // note). What this map contains can only change if the LIGHT moves
    // (its own transform, or its target's — together they are the
    // direction the depth camera looks from) or if the CASTER moves (the
    // hero bottle, which flies out and back on reveal). Both ride the
    // alignment group and the motion nudge, so world matrices are what to
    // watch, not local position.
    //
    // Matrices are compared as they stood at the END of the previous frame
    // — R3F runs useFrame before the render that refreshes them — so a
    // change detected here is already one frame old. `shadowHoldFrames`
    // keeps the map updating for a couple of frames past the last detected
    // change rather than exactly one, so the tail of a tween can't land a
    // stale shadow.
    const light = rig.bathroomBottleLight;
    const caster = shadowCasterRef.current;
    const nowOn = light.visible;
    let changed = nowOn !== rig.shadowWasOn;
    rig.shadowWasOn = nowOn;
    if (!light.matrixWorld.equals(rig.shadowLightMatrix)) {
      rig.shadowLightMatrix.copy(light.matrixWorld);
      changed = true;
    }
    if (!light.target.matrixWorld.equals(rig.shadowTargetMatrix)) {
      rig.shadowTargetMatrix.copy(light.target.matrixWorld);
      changed = true;
    }
    if (caster && !caster.matrixWorld.equals(rig.shadowCasterMatrix)) {
      rig.shadowCasterMatrix.copy(caster.matrixWorld);
      changed = true;
    }
    if (changed) rig.shadowHoldFrames = 2;
    if (rig.shadowHoldFrames > 0) {
      rig.shadowHoldFrames -= 1;
      light.shadow.needsUpdate = true;
    }
  });

  // --- lil-gui debug panel for the bottle light + ambient ---
  useEffect(() => {
    if (!gui || !rigRef.current) return undefined;
    const rig = rigRef.current;
    const colorParams = {
      bathroomBottleColor: "#fee6be",
      ambientColor: "#fece7c",
    };

    const bathroomLightFolder = gui.addFolder("Bathroom bottle light");
    bathroomLightFolder.add(rig.debugOn, "bathroom").name("Light On");
    bathroomLightFolder
      .addColor(colorParams, "bathroomBottleColor")
      .name("Color")
      .onChange((v) => rig.bathroomBottleLight.color.set(v));
    bathroomLightFolder.add(rig.bathroomBottleLight, "intensity", 0, 10, 0.01).name("Intensity");
    bathroomLightFolder.add(rig.bathroomBottleLight.position, "x", -15, 15, 0.1).name("Position X");
    bathroomLightFolder.add(rig.bathroomBottleLight.position, "y", -15, 15, 0.1).name("Position Y");
    bathroomLightFolder.add(rig.bathroomBottleLight.position, "z", -15, 15, 0.1).name("Position Z");
    bathroomLightFolder.add(rig.bathroomBottleLight.target.position, "x", -15, 15, 0.1).name("Target X");
    bathroomLightFolder.add(rig.bathroomBottleLight.target.position, "y", -15, 15, 0.1).name("Target Y");
    bathroomLightFolder.add(rig.bathroomBottleLight.target.position, "z", -15, 15, 0.1).name("Target Z");
    bathroomLightFolder.add(rig.bathroomBottleLightHelper, "visible").name("Show helper");
    // Both of these change the shadow map without moving anything, so the
    // per-frame transform watch can't catch them — the map is demand-driven
    // now (see the light's shadow.autoUpdate note) and has to be poked.
    const pokeShadow = () => {
      rig.bathroomBottleLight.shadow.needsUpdate = true;
      rig.shadowHoldFrames = 2;
    };
    bathroomLightFolder
      .add(rig.bathroomBottleLight, "castShadow")
      .name("Cast shadow")
      .onChange(pokeShadow);
    bathroomLightFolder
      .add(rig.bathroomBottleLight.shadow, "bias", -0.01, 0.01, 0.0001)
      .name("Shadow bias")
      .onChange(pokeShadow);
    addCopyValuesButton(
      bathroomLightFolder,
      () => ({
        color: `#${rig.bathroomBottleLight.color.getHexString()}`,
        intensity: rig.bathroomBottleLight.intensity,
        position: {
          x: rig.bathroomBottleLight.position.x,
          y: rig.bathroomBottleLight.position.y,
          z: rig.bathroomBottleLight.position.z,
        },
        target: {
          x: rig.bathroomBottleLight.target.position.x,
          y: rig.bathroomBottleLight.target.position.y,
          z: rig.bathroomBottleLight.target.position.z,
        },
        castShadow: rig.bathroomBottleLight.castShadow,
        shadowBias: rig.bathroomBottleLight.shadow.bias,
      }),
      "[ProductV2]",
    );


    const ambientLightFolder = gui.addFolder("Ambient light");
    ambientLightFolder.add(rig.debugOn, "ambient").name("Light On");
    ambientLightFolder
      .addColor(colorParams, "ambientColor")
      .name("Color")
      .onChange((v) => rig.ambientLight.color.set(v));
    ambientLightFolder.add(rig.ambientLight, "intensity", 0, 5, 0.01).name("Intensity");
    addCopyValuesButton(
      ambientLightFolder,
      () => ({
        color: `#${rig.ambientLight.color.getHexString()}`,
        intensity: rig.ambientLight.intensity,
      }),
      "[ProductV2]",
    );

    const fillLightFolder = gui.addFolder("Room fill light");
    fillLightFolder.add(rig.debugOn, "directional").name("Light On");
    fillLightFolder.add(rig.directionalLight, "intensity", 0, 10, 0.01).name("Intensity");
    fillLightFolder.add(rig.directionalLight.position, "x", -15, 15, 0.1).name("Position X");
    fillLightFolder.add(rig.directionalLight.position, "y", -15, 15, 0.1).name("Position Y");
    fillLightFolder.add(rig.directionalLight.position, "z", -15, 15, 0.1).name("Position Z");

    return () => {
      bathroomLightFolder.destroy();
      fillLightFolder.destroy();
      ambientLightFolder.destroy();
    };
  }, [gui]);

  // The rig above attaches into this group (see the mount effect) rather
  // than the scene root, so it inherits the room's own placement on the
  // carousel ring. Mounted unconditionally — `active` toggles the lights'
  // own `.visible` instead (see the effect above), which is what keeps them
  // off the carousel scenes without tearing the rig down and rebuilding it
  // on every entry.
  return <group ref={groupRef} />;
}
