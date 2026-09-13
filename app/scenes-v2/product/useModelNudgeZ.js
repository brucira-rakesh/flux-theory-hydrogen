import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Moves the bathroom assembly toward the fixed carousel camera after handoff.
//
// ONE motion, driven by exactly one thing: `phaseRef`, which
// useProductAutoZoom eases 0 -> 1 on a timer the moment the room is
// revealed behind the cloud wipe. `z` runs straight from `startZ` to
// `finalZ` across it and nothing else touches it.
//
// This used to LAYER a second, independent motion underneath: a
// `revealSettleRef` tween (owned by useSceneToProductHandoff) that pushed
// the lerp's own START point forward by ENTRY_ZOOM_PUSH_IN over the reveal
// beat, on the theory that the two would compose into one continuous
// arrival. They didn't. That tween eased out to a dead stop, and the
// zoom-in then started from zero velocity after it — position was
// continuous but velocity was not, so the room visibly arrived, PAUSED,
// then started moving again. A single tween has no seam to get wrong.
//
// `activeRef` still gates it, so the room sits at `startZ` (not partway
// through a zoom) any time product isn't the scene on screen — note this
// must be the "product owns the frame" signal, NOT a raw scroll-position
// comparison; see useProductAutoZoom's own comment on onScreenRef.
export function useModelNudgeZ({
  motionRef,
  phaseRef,
  activeRef,
  startZ,
  finalZ,
}) {
  const worldOffset = new THREE.Vector3();
  const localOffset = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  useFrame(({ camera }) => {
    const motion = motionRef.current;
    if (!motion) return;
    const t = activeRef.current
      ? THREE.MathUtils.clamp(phaseRef.current, 0, 1)
      : 0;
    const eased = t * t * (3 - 2 * t);
    const z = THREE.MathUtils.lerp(startZ, finalZ, eased);
    camera.getWorldQuaternion(quaternion);
    worldOffset.set(0, 0, z).applyQuaternion(quaternion);
    motion.parent.getWorldQuaternion(quaternion).invert();
    localOffset.copy(worldOffset).applyQuaternion(quaternion);
    motion.position.copy(localOffset);
  });
}
