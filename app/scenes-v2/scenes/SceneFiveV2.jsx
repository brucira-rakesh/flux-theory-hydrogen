import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PropertyBinding } from "three";
import { createLoaders, prepColorTexture } from "../loaders";
import {
  makeSeaWaveMaterialTwo,
  makeGlassMaterial,
  glassParams,
  setupWaterReflection,
} from "../materials";
import { useSceneEngine, applyFolderSettings } from "../SceneEngineContext";
import { useLoaderManager } from "../useLoaderManager";
import {
  addSeaGui,
  addGlassGui,
  addEmissiveGui,
  addTransformGui,
} from "../gui/guiHelpers";
import { disposeObject } from "../disposeObject";
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

const MODEL_MAIN_URL = oxygenPublicUrl("/models/Rebel_new_2-v1.glb");
const MODEL_SLABS_URL = oxygenPublicUrl("/models/Rebel_new_Stones_Slabs-v1.glb");
const TEXTURE_URL = oxygenPublicUrl("/textures/Rebel_New_Bake_2_etc1s.ktx2");
const SLATES_TEXTURE_URL = oxygenPublicUrl("/textures/Rebel_slates_etc1s.ktx2");
const BG_TEXTURE_URL = oxygenPublicUrl("/textures/Rebel_new_bg.ktx2");

// Rebel_new_2-v1.glb ships five nodes: Water (sea shader, same as the other
// scenes' pools), "Fluted Glass Divider" (same glass shader as Scene Four's
// panels), Backdrop (background — its own dedicated bg texture), Cylinder.006
// (flat scene texture), and Stone_stabs (slates texture). The standalone
// slab geometry in Rebel_new_Stones_Slabs-v1.glb wears that same slates
// texture, so its single mesh shares the Stone_stabs material instance.
export default function SceneFiveV2({ visible = true, sharedMaps }) {
  const groupRef = useRef(null);
  const { gl } = useThree();
  const { engine, gui, settings } = useSceneEngine();
  const manager = useLoaderManager();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!sharedMaps || loadedRef.current || !groupRef.current) return;
    loadedRef.current = true;
    const group = groupRef.current;

    let disposed = false;
    const unregisterFns = [];
    let folder = null;

    const { gltfLoader, ktx2Loader } = createLoaders(manager, gl);

    Promise.all([
      gltfLoader.loadAsync(MODEL_MAIN_URL),
      gltfLoader.loadAsync(MODEL_SLABS_URL),
      ktx2Loader.loadAsync(TEXTURE_URL),
      ktx2Loader.loadAsync(SLATES_TEXTURE_URL),
      ktx2Loader.loadAsync(BG_TEXTURE_URL),
    ]).then(([mainGltf, slabsGltf, texture, slatesTexture, bgTexture]) => {
      if (disposed) return;

      const model = new THREE.Group();
      model.add(mainGltf.scene, slabsGltf.scene);
      prepColorTexture(texture, gl);
      prepColorTexture(slatesTexture, gl);
      prepColorTexture(bgTexture, gl);

      const { seaMaps } = sharedMaps;
      const waterName = PropertyBinding.sanitizeNodeName("Water");
      const glassName = PropertyBinding.sanitizeNodeName(
        "Fluted Glass Divider",
      );
      const backgroundName = PropertyBinding.sanitizeNodeName("Backdrop");
      const slatesName = PropertyBinding.sanitizeNodeName("Stone_stabs");

      const glassMaterialInstance = makeGlassMaterial(glassParams);
      glassMaterialInstance.opacity = 0.01;
      const slatesMaterial = new THREE.MeshBasicMaterial({
        map: slatesTexture,
      });

      let waterMesh = null;
      let waterMaterial = null;
      let backgroundMesh = null;
      let backgroundMaterial = null;
      let bakeMesh = null;
      let bakeMaterial = null;
      let slatesMesh = null;

      mainGltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        child.material?.dispose();

        if (child.name === waterName) {
          child.material = makeSeaWaveMaterialTwo(seaMaps);
          unregisterFns.push(engine.registerAnimated(child.material));
          waterMaterial = child.material;
          waterMesh = child;
        } else if (child.name === glassName) {
          child.material = glassMaterialInstance;
        } else if (child.name === backgroundName) {
          child.material = new THREE.MeshBasicMaterial({ map: bgTexture });
          backgroundMaterial = child.material;
          backgroundMesh = child;
        } else if (child.name === slatesName) {
          child.material = slatesMaterial;
          slatesMesh = child;
        } else {
          child.material = new THREE.MeshBasicMaterial({ map: texture });
          bakeMaterial = child.material;
          bakeMesh = child;
        }
      });

      slabsGltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        child.material?.dispose();
        child.material = slatesMaterial;
        if (!slatesMesh) slatesMesh = child;
      });

      let reflector = null;
      if (waterMesh) {
        reflector = setupWaterReflection(waterMesh, waterMaterial, gl);
        model.add(reflector);
        unregisterFns.push(
          engine.registerWater({
            mesh: waterMesh,
            material: waterMaterial,
            reflector,
          }),
        );
      }

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.z = 6.19894796319227;
      group.add(model);

      const range = Math.max(size.x, size.y, size.z) || 1;
      if (gui) {
        folder = gui.addFolder("Scene Five");
        addTransformGui(folder, { object: model, range, label: "Model" });
        addEmissiveGui(folder, {
          material: backgroundMaterial,
          mesh: backgroundMesh,
          range,
          label: "Background",
        });
        addEmissiveGui(folder, {
          material: bakeMaterial,
          mesh: bakeMesh,
          range,
          label: "Bake",
        });
        addEmissiveGui(folder, {
          material: slatesMaterial,
          mesh: slatesMesh,
          range,
          label: "Stone Slabs",
        });
        addSeaGui(folder, { material: waterMaterial, mesh: waterMesh, range });
        addGlassGui(folder, { material: glassMaterialInstance, glassParams });
        applyFolderSettings(folder, settings, "Scene Five");
        folder.close();
      }
    });

    return () => {
      disposed = true;
      for (const off of unregisterFns) off();
      folder?.destroy();
      disposeObject(group);
      group.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedMaps]);

  return <group ref={groupRef} visible={visible} />;
}
