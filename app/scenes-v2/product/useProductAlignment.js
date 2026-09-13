import { useEffect } from "react";
import * as THREE from "three";

// Solves for the transform that makes Product's room land correctly on the
// carousel ring — DERIVED, not hand-dialed.
//
// The requirement is exactly this: at the moment product's ring slot comes
// to rest at FRONT, the carousel's own fixed camera must be sitting in
// precisely the spot the flythrough's authored camera occupies at its
// frame 0. Satisfy that and two things fall out at once —
//   * the room is framed on arrival exactly as the flythrough's first frame
//     frames it (so it isn't floating off at some arbitrary scale/angle),
//   * switching from the carousel camera to the flythrough camera is
//     seamless BY CONSTRUCTION, because at phase 0 the two cameras are the
//     same camera pose. Nothing to blend, nothing to pop.
//
// Writing that as matrices, with `A` the transform we're solving for:
//     R · A · C₀  =  V
// where
//     R  = the ring slot's own resting world transform at FRONT (the same
//          position/rotation swingCarousel's setGroupFrame produces at θ=0),
//     C₀ = the flythrough camera's matrix at clip time 0, measured in this
//          alignment group's own space,
//     V  = the carousel camera's resting world pose (DEFAULT_CAMERA).
// so
//     A = R⁻¹ · V · C₀⁻¹
//
// Every term is a rigid transform, so `A` comes out with unit scale — the
// room keeps its authored scale, which is what the flythrough animation was
// built against. There is deliberately no scale term to guess at.
//
// `nudge` is the one deliberate crack in that seamlessness: every carousel
// scene (product's slot included) shares ONE fixed camera fov (see
// swingCarousel's applyTransitionFov) rather than each adopting the
// flythrough's own authored fov, so matching camera POSE exactly does not
// guarantee the REST shot is well framed — Camera.glb's frame-0 pose can
// still read as a distant establishing shot through a wider/narrower lens
// than it was authored against.
//
// `nudge` ({x, y, z}, world units, in the FIXED camera's own local space —
// +x right, +y up, +z CLOSER to camera) moves the room after the solve to
// compensate. It's deliberately 3-axis, not distance-only: a pure
// forward/back push only keeps the subject centered if it already sat
// exactly on the camera's boresight — if the authored framing had it even
// slightly off-axis (ordinary, intentional composition), pushing along a
// FIXED direction amplifies that offset through perspective as distance
// shrinks, which reads as the subject swinging out of frame rather than
// simply growing closer. x/y let that be recomposed back to center.
//
// Applied on top of the exact solve, so any non-zero nudge necessarily
// reintroduces a small pop at the instant the flythrough camera later takes
// over — a correctly framed arrival traded for a not-quite-seamless
// handoff. GUI-tunable ("Product V2 > Placement") rather than derived,
// since there's no way to know the right amount without seeing it rendered.
export function useProductAlignment({
  alignRef,
  assetsRef,
  ready,
  restPosition,
  restRotationY,
  cameraPosition,
  cameraTarget,
  nudge,
}) {
  const nudgeX = nudge?.x ?? 0;
  const nudgeY = nudge?.y ?? 0;
  const nudgeZ = nudge?.z ?? 0;
  useEffect(() => {
    if (!ready) return;
    const group = alignRef.current;
    const assets = assetsRef.current;
    const cameraOneObj = assets.cameraOneObj;
    if (!group || !cameraOneObj) return;

    // Pose the rig at the flythrough's own frame 0 — that (not wherever the
    // user has currently scrolled to) is the pose the arrival has to match.

    // Measure C₀ against an IDENTITY alignment group, so what's captured is
    // the camera's offset within the product assembly itself rather than a
    // reading polluted by whatever this group was set to on a previous run.
    group.position.set(0, 0, 0);
    group.quaternion.identity();
    group.scale.set(1, 1, 1);
    group.updateWorldMatrix(true, true);

    const c0 = new THREE.Matrix4()
      .copy(group.matrixWorld)
      .invert()
      .multiply(cameraOneObj.matrixWorld);

    const rQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, restRotationY, 0),
    );
    const r = new THREE.Matrix4().compose(
      new THREE.Vector3(restPosition[0], restPosition[1], restPosition[2]),
      rQuat,
      new THREE.Vector3(1, 1, 1),
    );

    const eye = new THREE.Vector3(...cameraPosition);
    const target = new THREE.Vector3(...cameraTarget);
    const vQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)),
    );
    const v = new THREE.Matrix4().compose(eye, vQuat, new THREE.Vector3(1, 1, 1));

    const a = r.clone().invert().multiply(v).multiply(c0.clone().invert());
    a.decompose(group.position, group.quaternion, group.scale);

    if (nudgeX || nudgeY || nudgeZ) {
      // The fixed camera's own right/up/forward, in WORLD space — this is
      // also cameraOneObj's own right/up/forward post-alignment (a rigid
      // transform preserves every axis of the frame it maps, not just the
      // one used to derive it), which is exactly why nudging in these axes
      // keeps the subject centered as it's built to be recomposed, instead
      // of drifting off-axis the way a push along an unrelated world
      // direction would.
      const rightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(vQuat);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(vQuat);
      const forwardWorld = new THREE.Vector3(0, 0, -1).applyQuaternion(vQuat);

      const offsetWorld = new THREE.Vector3()
        .addScaledVector(rightWorld, nudgeX)
        .addScaledVector(upWorld, nudgeY)
        .addScaledVector(forwardWorld, -nudgeZ); // +z = CLOSER = against forward

      // Rotate (not transform) into this group's PARENT frame (R) — its own
      // position is set in that frame, not world space, so only R's
      // rotation matters here, never its translation.
      const offsetInR = offsetWorld.applyQuaternion(rQuat.clone().invert());
      group.position.add(offsetInR);
    }

    group.updateWorldMatrix(false, true);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    restPosition[0],
    restPosition[1],
    restPosition[2],
    restRotationY,
    nudgeX,
    nudgeY,
    nudgeZ,
  ]);
}
