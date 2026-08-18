import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

// One DRACOLoader (and its wasm decoder) shared by every scene component —
// same as Scene.jsx's single module-level dracoLoader.
let sharedDracoLoader = null;
const getDracoLoader = () => {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(oxygenPublicUrl('/draco/'));
  }
  return sharedDracoLoader;
};

// One KTX2Loader (and its transcoder worker pool) shared by every scene
// component. Each of the five SceneXV2 components used to call
// createLoaders() independently, so five separate KTX2Loader instances were
// spinning up five separate worker pools — the source of three.js's own
// "Multiple active KTX2 loaders" warning, and real main-thread/worker
// contention (visible as jank on the very next wheel tick while they spin
// up). Never disposed, same lifetime as sharedDracoLoader above.
let sharedKtx2Loader = null;
const getKtx2Loader = (manager, renderer) => {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader(manager);
    sharedKtx2Loader.setTranscoderPath(oxygenPublicUrl('/basis/'));
    sharedKtx2Loader.detectSupport(renderer);
  }
  return sharedKtx2Loader;
};

// Builds the same GLTFLoader(Draco + KTX2) / TextureLoader trio Scene.jsx
// wired up, all registered against `manager` so drei's <Loader /> (or a
// future PreloaderV2, see useLoaderManager.js) can track their progress.
export const createLoaders = (manager, renderer) => {
  const ktx2Loader = getKtx2Loader(manager, renderer);

  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.setDRACOLoader(getDracoLoader());
  gltfLoader.setKTX2Loader(ktx2Loader);

  const textureLoader = new THREE.TextureLoader(manager);

  return { gltfLoader, ktx2Loader, textureLoader };
};

export const prepColorTexture = (tex, renderer) => {
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
};

export const prepDataTexture = (tex, renderer) => {
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
};
