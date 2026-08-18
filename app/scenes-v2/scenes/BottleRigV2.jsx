import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { createLoaders } from "../loaders";
import { useLoaderManager } from "../useLoaderManager";
import { disposeObject } from "../disposeObject";
import { useSceneEngine } from "../SceneEngineContext";

// Same tuned bottleGroup transform Scene.jsx's GUI Export produced (see
// BottleV2's old per-scene copy of these) — this rig is now the ONE bottle
// instance ever on screen, so there's only one place these live.
const BOTTLE_SCALE = 7.95;
const BOTTLE_OFFSET_Z = 2.95230586992216;

// Cursor tilt matches Scene.jsx's bottle exactly — max radians of pitch/yaw
// at full mouse deflection, eased via the same frame-rate-independent
// low-pass (see its own mouseEased/BOTTLE_TILT_X/Y comments).
const BOTTLE_TILT_X = 0.3;
const BOTTLE_TILT_Y = 0.3;
const PARALLAX_EASE = 0.1;

// Opposite sign of Scene.jsx's default `carousel.spin` (=1) — the bottle
// always turns opposite the scene's own swing direction.
const SPIN_SIGN = -1;

function useCursorRaw() {
  const mouseRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handleMove = (event) => {
      mouseRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);
  return mouseRef;
}

// The one bottle instance for the whole carousel — parked at a fixed world
// transform in front of the (fixed) camera at all times, independent of the
// swing carousel's own scene-group motion (see swingCarousel.js). Only its
// visible flavor and its rotation change, driven every frame by the SAME
// progressRef the carousel already updates as it moves the scene groups
// (see swingCarousel.js's applyTransition) — never a parallel calculation
// that could fall out of sync with what's on screen.
export default function BottleRigV2({
  scenes,
  enabled,
  position,
  rotationY,
  progressRef,
}) {
  const groupRef = useRef(null);
  const modelsRef = useRef([]);
  const { gl } = useThree();
  const { gui } = useSceneEngine();
  const manager = useLoaderManager();
  const loadedRef = useRef(false);
  const mouseRef = useCursorRaw();
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
  });

  useEffect(() => {
    if (loadedRef.current || !groupRef.current) return;
    loadedRef.current = true;
    const group = groupRef.current;
    let disposed = false;
    let folder = null;

    const { gltfLoader } = createLoaders(manager, gl);
    // Scenes without a bottle flavor yet (bottleUrl falsy — see Scene Five)
    // skip loading entirely; modelsRef keeps a null placeholder at that
    // index so it stays aligned with `scenes`/`progressRef.frontIndex`.
    Promise.all(
      scenes.map((s) =>
        s.bottleUrl ? gltfLoader.loadAsync(s.bottleUrl) : null,
      ),
    ).then((gltfs) => {
      if (disposed) return;
      modelsRef.current = gltfs.map((gltf, i) => {
        if (!gltf) return null;
        const bottle = gltf.scene;
        bottle.scale.setScalar(tuningRef.current.scale);
        // No position offset here: this mesh is a child of `groupRef`,
        // which is the SAME node spun every frame below. A child offset
        // from a spinning parent's own origin sweeps in a circle as it
        // rotates — the offset belongs on the group's own (non-rotating-
        // relative) translation instead, see the `position` prop on the
        // returned <group>, so the bottle spins in place on its own axis.
        bottle.visible = i === progressRef.current.frontIndex;
        group.add(bottle);
        return bottle;
      });

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
            modelsRef.current.forEach((m) => m?.scale.setScalar(v));
          });
        transform
          .add(tuningRef.current, "rotationY", -Math.PI, Math.PI, 0.001)
          .name("Base Rotation Y");
        folder.open();
      }
    });

    return () => {
      disposed = true;
      folder?.destroy();
      disposeObject(group);
      group.clear();
      modelsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group) return;

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

    const { step, frontIndex } = progressRef.current;
    group.rotation.y =
      rotationY +
      tuning.rotationY +
      SPIN_SIGN * Math.PI * 2 * step +
      mouseEasedRef.current.x * BOTTLE_TILT_Y;
    group.rotation.x = mouseEasedRef.current.y * BOTTLE_TILT_X;

    const models = modelsRef.current;
    for (let i = 0; i < models.length; i++) {
      if (!models[i]) continue;
      models[i].visible = i === frontIndex && !!enabled[scenes[i].id];
    }
  });

  const groupPosition = [position[0], position[1], position[2]];

  return (
    <group
      ref={groupRef}
      position={groupPosition}
      rotation={[0, rotationY, 0]}
    />
  );
}
