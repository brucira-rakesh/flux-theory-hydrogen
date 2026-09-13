import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useBottleStudioModel } from "./useBottleStudioModel";
import BottleStudioLights from "./BottleStudioLights";
import VideoPlaneV2 from "../scenes/VideoPlaneV2";

const CAMERA_TARGET = [0, 0, 0];
const DEFAULT_FOV = 45;
// How much headroom to leave around the bottle's own bounding sphere when
// auto-framing the camera — 1 would frame it edge-to-edge.
const FRAME_MARGIN = 1.6;

// Parked well behind the bottle so it reads as a backdrop, not something the
// bottle is standing on top of — VideoPlaneV2's own useFillFrustum resizes it
// every frame to cover the camera frustum at whatever distance it's placed.
const BACKDROP_DISTANCE_MULTIPLIER = 3;

function StudioCamera({ frameDistance }) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3(...CAMERA_TARGET));

  useEffect(() => {
    camera.fov = DEFAULT_FOV;
    camera.updateProjectionMatrix();
  }, [camera]);

  useEffect(() => {
    if (!frameDistance) return;
    camera.position.set(0, 0, frameDistance);
    camera.lookAt(lookTarget.current);
  }, [camera, frameDistance]);

  return null;
}

// New standalone studio scene: one background video plane (see
// VideoPlaneV2), the shared flux-bottle-v2 model every carousel scene uses
// (see useBottleStudioModel/bottleUrls.js) at its own native size/materials,
// the Bottle.blend area-light rig (see BottleStudioLights), and a camera
// auto-framed in front. No post-processing here by design.
export default function BottleStudioSceneV2({
  videoUrl,
  persona = "sport",
  // Which carousel scene this studio shot is currently standing in for —
  // picks the light rig's accent tint (see studioSceneTints.js). The page
  // above owns it so the backdrop loop and the tint always agree;
  // `onSceneChange` is the debug panel's own dropdown reporting back.
  sceneId,
  onSceneChange,
}) {
  const { modelRef, ready } = useBottleStudioModel(persona);
  const recenterRef = useRef(null);
  // State, not a ref: StudioCamera reads this as a prop, and a ref mutation
  // alone would never trigger the re-render that hands it the real value.
  const [frameDistance, setFrameDistance] = useState(0);

  useEffect(() => {
    const model = modelRef.current;
    if (!ready || !model || !recenterRef.current) return;
    // useBottleStudioModel already applies BottleRigV2's own BOTTLE_SCALE
    // to this model (see that hook's own comment — the raw GLB is tiny, and
    // the Blender.blend light rig was authored at real-world distances
    // around a bottle roughly that scaled-up size). This only recenters the
    // now-correctly-sized model to the origin the light rig and camera are
    // both built around.
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    recenterRef.current.position.set(-center.x, -center.y, -center.z);

    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2 || 1;
    const verticalFov = THREE.MathUtils.degToRad(DEFAULT_FOV);
    setFrameDistance((radius / Math.sin(verticalFov / 2)) * FRAME_MARGIN);
  }, [ready, modelRef]);

  return (
    <>
      <StudioCamera frameDistance={frameDistance} />
      {/* Debug-only free camera — StudioCamera still does the initial
          auto-frame above, this just lets you fly around to see how the
          ported light rig (helpers below) actually sits relative to the
          bottle. */}
      <OrbitControls makeDefault target={CAMERA_TARGET} />
      <BottleStudioLights
        enabled
        showHelpers
        sceneId={sceneId}
        onSceneChange={onSceneChange}
      />
      <group ref={recenterRef}>
        {ready && modelRef.current && (
          <primitive object={modelRef.current} />
        )}
      </group>
      <group
        position={[
          0,
          0,
          -(frameDistance || 6) * BACKDROP_DISTANCE_MULTIPLIER,
        ]}
      >
        <VideoPlaneV2 visible videoUrl={videoUrl} />
      </group>
    </>
  );
}
