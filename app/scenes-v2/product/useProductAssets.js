import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createLoaders, prepColorTexture } from "../loaders";
import { useLoaderManager } from "../useLoaderManager";
import { disposeObject } from "../disposeObject";
import { excludeFromBloom } from "../bloomExclusion";
import {
  MODEL_URL,
  TEXTURE_URL,
  BATHROOM_BOTTLE_MODEL_URL,
  FLIGHT_TARGET_NODE_NAME,
  CAMERA_MODEL_URL,
  INTERACTIVE_MESH_NAME_PREFIX,
} from "./constants";

// A mesh is click/hover-interactive if it belongs to a glTF node whose name
// starts with this prefix. Every bottle mesh in these files has 5
// primitives, so GLTFLoader wraps each node in a Group named "NEW_BASE0XX"
// and the actual raycast-able child meshes are named after the *mesh*
// ("Plane0XX"), NOT the node — so this must be tested by walking a mesh's
// ANCESTORS, not the mesh's own name. Ported verbatim from Product.jsx.
const hasInteractivePrefix = (obj) =>
  obj.name?.startsWith(INTERACTIVE_MESH_NAME_PREFIX) ||
  obj.userData?.name?.startsWith(INTERACTIVE_MESH_NAME_PREFIX);

const findInteractiveNode = (mesh, root) => {
  let node = mesh;
  while (node && node !== root.parent) {
    if (hasInteractivePrefix(node)) return node;
    node = node.parent;
  }
  return null;
};

// Both bottle models ship their own materials + embedded KTX2 (basisu)
// label/normal textures — GLTFLoader builds those into MeshStandardMaterial
// automatically, except meshes using KHR_materials_clearcoat, which it
// upgrades to MeshPhysicalMaterial. Per spec every mesh here is rebuilt as a
// plain THREE.MeshStandardMaterial (dropping clearcoat), reusing the
// loader's own already-correctly-configured texture objects (not disposed
// here — only the physical/standard material the loader built is).
// Every material in bathroom_bottle.glb is authored doubleSided, which
// GLTFLoader faithfully carries over as THREE.DoubleSide — and which this
// used to copy through verbatim. On 1.62M triangles that turns off backface
// culling for the whole model: roughly double the rasterizer work, and it
// defeats early-z, so hidden back faces still run the full MeshStandard
// fragment shader.
//
// The solid parts (bottle body, cap, logo, brushed collar) are closed
// shells from CAD, so front faces are all that were ever visible on them.
// The label decals are single-sided planes with BLEND alpha — those DO need
// DoubleSide, or a label reads as a hole from behind during the reveal
// spin. Transparency is the reliable tell between the two here (see the
// glTF's own materials: the five *_Label materials are the only ones with
// alphaMode BLEND), so that's what selects it.
//
// If any solid part turns out to be an open shell after all it will show as
// a see-through patch — flip this to `true` to restore the old behaviour.
const FORCE_DOUBLE_SIDED = false;

const rebuildStandardMaterial = (root, { castShadowNode } = {}) => {
  root.traverse((child) => {
    if (!child.isMesh) return;
    const original = child.material;
    const isDecal = Boolean(original.transparent);
    child.material = new THREE.MeshStandardMaterial({
      map: original.map ?? null,
      normalMap: original.normalMap ?? null,
      color: original.color
        ? original.color.clone()
        : new THREE.Color(0xffffff),
      roughness: original.roughness ?? 1,
      metalness: original.metalness ?? 0,
      transparent: original.transparent,
      opacity: original.opacity,
      alphaTest: original.alphaTest,
      side:
        FORCE_DOUBLE_SIDED || isDecal ? THREE.DoubleSide : THREE.FrontSide,
    });
    // Only the hero bottle casts. There is exactly ONE shadow-casting light
    // in this scene (see ProductLights' bathroomBottleLight) and its
    // shadow-camera frustum is fitted to JUST that bottle's bounding box
    // (see fitBottleShadow below, called with assets.bathroomBox). Every
    // other bottle was being submitted to the shadow pass only to be
    // frustum-culled out of it — or worse, partially clipped in — so
    // marking all 25 primitives castShadow put up to 1.62M triangles a
    // frame in front of a depth render that can only ever show ~325k of
    // them. receiveShadow stays on for all of them: it is a fragment-shader
    // define, not an extra draw, and it's what lets the hero bottle's
    // shadow land on its neighbours.
    child.castShadow = castShadowNode
      ? isDescendantOf(child, castShadowNode)
      : true;
    child.receiveShadow = true;
    original.dispose();
  });
};

const isDescendantOf = (object, ancestor) => {
  let node = object;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
};

// Re-fits a light's shadow-camera frustum (and, if given one, a
// shadow-catcher plane) to a precomputed bounding box — used by
// ProductLights once useProductAssets exposes the bottle's box (see
// bathroomBox below). `autoAimTarget` (default true) re-aims the light's
// target at the box center; pass false to preserve a hand-tuned target (the
// bathroom bottle light in ProductLights has one).
export const fitBottleShadow = (
  box,
  light,
  shadowPlane,
  { autoAimTarget = true } = {},
) => {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  if (autoAimTarget) {
    light.target.position.copy(center);
  }
  light.target.updateMatrixWorld();

  const halfExtent = Math.max(size.x, size.y, size.z) * 1.5 || 1;
  light.shadow.camera.left = -halfExtent;
  light.shadow.camera.right = halfExtent;
  light.shadow.camera.top = halfExtent;
  light.shadow.camera.bottom = -halfExtent;
  light.shadow.camera.far = halfExtent * 6;
  light.shadow.camera.updateProjectionMatrix();

  if (!shadowPlane) return;
  // Plane footprint with margin so the shadow doesn't clip at the bottle's edges.
  const footprint = Math.max(size.x, size.z) * 2.5 || 1;
  shadowPlane.scale.set(footprint, footprint, 1);
  shadowPlane.position.set(center.x, box.min.y + 0.002, center.z);
};

// Loads + prepares everything static for the ProductV2 flythrough: room
// GLTF + KTX2 texture, the bathroom bottle GLTF, the camera rig GLTF (two
// authored cameras + their two animation clips). No scroll/interaction
// concerns live here — see useBottleReveal.
//
// Mutated into a plain ref (not React state) rather than re-rendered on
// every field — same "written once on load, read every frame" rationale as
// engine.js's own registry. `ready` is the one piece of React state,
// flipped once after every field below has been populated, so consumers
// re-render exactly once to pick up the now-complete ref.
/**
 * `enabled` (default true) gates the whole load. A page that mounts SceneV2
 * purely for its carousel — with the scene-to-product handoff switched off,
 * see SceneV2's own `productEnabled` — would otherwise still download and
 * decode the bathroom room, both bottle models and the camera rig for
 * geometry it can never reach. `ready` simply stays false, which is already
 * the "assets not in yet" state every consumer here handles.
 */
export function useProductAssets(enabled = true) {
  const { gl } = useThree();
  const manager = useLoaderManager();
  const [ready, setReady] = useState(false);
  const assetsRef = useRef({
    roomModel: null,
    bottleGroup: null,
    bathroomBottleModel: null,
    bathroomBox: null,
    interactiveMeshes: [],
    revealNodes: [],
    cameraRig: null,
    cameraOneObj: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    const { gltfLoader, ktx2Loader } = createLoaders(manager, gl);
    const assets = assetsRef.current;
    // The room and both bottles are lit PBR/baked-texture geometry sitting
    // right next to real light fixtures — PostFXV2's bloom pass (see its own
    // DEFAULT_BLOOM) is tuned for the carousel's video-plane light strips,
    // way too hot for this geometry's own highlights, which is what reads as
    // the room blowing out white. Registered the same way VideoPlaneV2
    // excludes its own planes (see bloomExclusion.js) rather than turning
    // bloom off globally, so the carousel scenes keep theirs.
    const bloomExclusionCleanups = [];
    const excludeMeshesFromBloom = (object) => {
      object.traverse((child) => {
        if (!child.isMesh) return;
        bloomExclusionCleanups.push(excludeFromBloom(child));
      });
    };

    Promise.all([
      gltfLoader.loadAsync(MODEL_URL),
      ktx2Loader.loadAsync(TEXTURE_URL),
      gltfLoader.loadAsync(CAMERA_MODEL_URL),
      gltfLoader.loadAsync(BATHROOM_BOTTLE_MODEL_URL),
    ])
      .then(([roomGltf, texture, cameraGltf, bathroomBottleGltf]) => {
          if (disposed) return;

          prepColorTexture(texture, gl);

          const roomModel = roomGltf.scene;
          roomModel.traverse((child) => {
            if (!child.isMesh) return;
            child.material?.dispose(); // drop the original imported material
            // Starts fully transparent — the scene-to-product handoff (see
            // useSceneToProductHandoff/fadeObjectOpacity) is what fades this
            // in; opacity 0 by default means the room can safely mount
            // ahead of that fade with nothing popping into view early.
            child.material = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: 0,
            });
          });
          assets.roomModel = roomModel;
          excludeMeshesFromBloom(roomModel);

          const bathroomBottleModel = bathroomBottleGltf.scene;
          // Resolved BEFORE the material rebuild, which needs it to decide
          // which meshes are worth submitting to the shadow pass — see
          // rebuildStandardMaterial's own castShadow comment. Same node the
          // shadow-camera frustum is fitted to below.
          const shadowFitNode =
            bathroomBottleModel.getObjectByName(FLIGHT_TARGET_NODE_NAME) ??
            bathroomBottleModel;
          rebuildStandardMaterial(bathroomBottleModel, {
            castShadowNode: shadowFitNode,
          });
          excludeMeshesFromBloom(bathroomBottleModel);

          const bottleGroup = new THREE.Group();
          bottleGroup.name = "Bottles";
          bottleGroup.add(bathroomBottleModel);
          assets.bottleGroup = bottleGroup;
          assets.bathroomBottleModel = bathroomBottleModel;
          // Starts hidden — the scene-to-product handoff (see
          // useSceneToProductHandoff) reveals it only once the carousel's own
          // flavor bottle has flown to and landed on its resting pose, so the
          // two are never both on screen at once.
          bathroomBottleModel.visible = false;

          // Resolves each raycast-able mesh to the single NEW_BASE0XX node it
          // belongs to (see hasInteractivePrefix/findInteractiveNode above),
          // populating the shared interactiveMeshes (raycast targets) and
          // revealNodes (unique flyable node groups) arrays. `restPosition`/
          // `restQuaternion` are captured now, before any reveal interaction
          // has ever touched a node, so returnNode() (see useBottleReveal)
          // always has the true original pose to animate back to.
          const interactiveMeshes = [];
          const revealNodes = [];
          const tagInteractiveMeshes = (root) => {
            root.traverse((child) => {
              if (!child.isMesh) return;
              const node = findInteractiveNode(child, root);
              if (!node) return;
              child.userData.revealNode = node;
              interactiveMeshes.push(child);
              if (!revealNodes.includes(node)) {
                revealNodes.push(node);
                node.userData.restPosition = node.position.clone();
                node.userData.restQuaternion = node.quaternion.clone();
                node.userData.restScale = node.scale.clone();
              }
            });
          };
          tagInteractiveMeshes(bathroomBottleModel);
          assets.interactiveMeshes = interactiveMeshes;
          assets.revealNodes = revealNodes;

          // Fitted to JUST NEW_BASE011, not the whole bathroomBottleModel —
          // that model bundles all five shelf bottles under one root, so a
          // box around the whole thing spans nearly the entire shelf width.
          // ProductLights' shadow-catcher plane scales itself off this box
          // (2.5x its footprint), so that mistake was blowing the plane out
          // to ~2.5x the SHELF's width instead of one bottle's — the "weird
          // black plane" jaggedly z-fighting across the counter.
          assets.bathroomBox = new THREE.Box3().setFromObject(shadowFitNode);

          // --- Camera rig: the two authored cameras, by glTF cameras[] index ---
          // GLTFLoader's own camera array, in glTF cameras[] definition
          // order — unaffected by node-name dot-sanitization, unlike
          // matching by node.name (see Product.jsx's own note on this).
          const cameraRig = cameraGltf.scene;
          const cameraOneObj = cameraGltf.cameras[0] ?? null;
          assets.cameraRig = cameraRig;
          assets.cameraOneObj = cameraOneObj;

          // Camera two is only required when it's actually going to play —
          // see INCLUDE_SECOND_CAMERA. With it off, a Camera.glb carrying
          // only the first camera is perfectly valid.
          if (!cameraOneObj) {
            console.error("[ProductV2] Camera.glb is missing an expected camera");
            setReady(true);
            return;
          }

          // Captures, per flyable node, the fixed WORLD-space orientation of
          // that node relative to cameraOneObj's authored bind pose (measured
          // now, before any scroll-driven animation touches the camera) — see
          // useBottleReveal's revealNode for how this is consumed.
          const cameraBindWorldQuatInv = cameraOneObj
            .getWorldQuaternion(new THREE.Quaternion())
            .invert();
          revealNodes.forEach((node) => {
            const nodeWorldQuat = node.getWorldQuaternion(new THREE.Quaternion());
            node.userData.revealRelativeQuaternion = cameraBindWorldQuatInv
              .clone()
              .multiply(nodeWorldQuat);
          });

          // Leave the rig parked at the flythrough's own frame 0 — that's
          // the pose useProductAlignment measures against, and (with the
          // second camera off) the handoff-offset probe above would
          // otherwise leave it sitting at the END of clip one.
          setReady(true);
      })
      .catch((error) => {
        console.error(
          "[ProductV2] Failed to load bathroom model/texture/camera rig/bottle",
          error,
        );
      });

    return () => {
      disposed = true;
      assets.revealNodes.forEach((node) => node.userData.revealTween?.kill());
      bloomExclusionCleanups.forEach((cleanup) => cleanup());
      if (assets.roomModel) disposeObject(assets.roomModel);
      if (assets.bottleGroup) disposeObject(assets.bottleGroup);
    };
  }, [gl, manager, enabled]);

  return { assetsRef, ready };
}
