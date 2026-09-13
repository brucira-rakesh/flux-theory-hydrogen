import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useThree } from "@react-three/fiber";
import { createLoaders, prepColorTexture } from "../loaders";
import { useLoaderManager } from "../useLoaderManager";
import { disposeObject } from "../disposeObject";
import { BOTTLE_MODEL_URL, BOTTLE_TEXTURE_URLS } from "../bottleUrls";

// Same reflection budget BottleRigV2 uses for this exact model/material —
// see that file's own ENV_MAP_INTENSITY/LABEL_ENV_MAP_INTENSITY comment for
// why these values (mirror-chrome body + foiled label, both need something
// to reflect or they read as flat black/dead matte).
const ENV_MAP_INTENSITY = 0.5;
const LABEL_ENV_MAP_INTENSITY = 0.45;

// Same scale BottleRigV2 applies to this exact GLB (see its own
// BOTTLE_SCALE) — the model's native/authored size is tiny (bounding box
// only ~0.15 units tall), and the Blender.blend light rig this page ports
// (see BottleStudioLights) was authored at real-world distances (its lights
// sit 2-6 units out). Left at native scale, the bottle and the light rig
// are in two different unit systems: the camera auto-frames almost
// touching the bottle while every light sits many bottle-heights further
// out than the frame even reaches.
const BOTTLE_SCALE = 10;

const LABEL_MATERIAL_DEFAULTS = {
  roughness: 0.22,
  metalness: 0.2,
  color: 0xf0f0f0,
  transparent: true,
  side: THREE.DoubleSide,
};

// See BottleRigV2's own findLabelMeshes — matched by node name, not
// material, since the shipped GLB's label primitives carry no material of
// their own.
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

// Loads the ONE shared bottle model every carousel scene uses (see
// bottleUrls.js) — same GLB, same per-persona label textures, same PMREM
// reflection setup as BottleRigV2 — but as a single static mesh with no
// spin/cursor-tilt/label-swap-by-scroll animation, since this page has no
// carousel progress to drive any of that. `persona` picks which label art
// this one instance wears.
export function useBottleStudioModel(persona) {
  const { gl } = useThree();
  const manager = useLoaderManager();
  const [ready, setReady] = useState(false);
  const modelRef = useRef(null);
  const texturesRef = useRef(null);
  const labelsRef = useRef({ front: null, back: null });

  useEffect(() => {
    let disposed = false;
    const { gltfLoader, textureLoader } = createLoaders(manager, gl);
    const bloomCleanup = [];

    Promise.all([
      gltfLoader.loadAsync(BOTTLE_MODEL_URL),
      textureLoader.loadAsync(BOTTLE_TEXTURE_URLS[persona].front),
      textureLoader.loadAsync(BOTTLE_TEXTURE_URLS[persona].back),
    ])
      .then(([gltf, frontTex, backTex]) => {
        if (disposed) return;

        const textures = {
          front: prepColorTexture(frontTex, gl),
          back: prepColorTexture(backTex, gl),
        };
        texturesRef.current = textures;

        const bottle = gltf.scene;
        bottle.scale.setScalar(BOTTLE_SCALE);
        modelRef.current = bottle;

        const { front, back } = findLabelMeshes(bottle);
        const staleMaterials = new Set([front?.material, back?.material]);
        if (front) front.material = new THREE.MeshStandardMaterial(LABEL_MATERIAL_DEFAULTS);
        if (back) back.material = new THREE.MeshStandardMaterial(LABEL_MATERIAL_DEFAULTS);
        staleMaterials.forEach((mat) => mat?.dispose());
        if (front) {
          front.material.map = textures.front;
          front.material.needsUpdate = true;
        }
        if (back) {
          back.material.map = textures.back;
          back.material.needsUpdate = true;
        }
        labelsRef.current = { front, back };

        const pmrem = new THREE.PMREMGenerator(gl);
        const envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
        pmrem.dispose();
        const labelMeshes = new Set([front, back].filter(Boolean));
        bottle.traverse((node) => {
          if (!node.isMesh || !node.material) return;
          node.material.envMap = envRenderTarget.texture;
          node.material.envMapIntensity = labelMeshes.has(node)
            ? LABEL_ENV_MAP_INTENSITY
            : ENV_MAP_INTENSITY;
          node.material.needsUpdate = true;
        });
        modelRef.current.userData.envRenderTarget = envRenderTarget;

        setReady(true);
      })
      .catch((error) => {
        console.error("[BottleStudio] Failed to load bottle model/textures", error);
      });

    return () => {
      disposed = true;
      const bottle = modelRef.current;
      bloomCleanup.forEach((cleanup) => cleanup());
      if (bottle) {
        bottle.userData.envRenderTarget?.dispose();
        disposeObject(bottle);
      }
      modelRef.current = null;
      labelsRef.current = { front: null, back: null };
      const textures = texturesRef.current;
      textures?.front?.dispose();
      textures?.back?.dispose();
      texturesRef.current = null;
      setReady(false);
    };
  }, [gl, manager, persona]);

  return { modelRef, ready };
}
