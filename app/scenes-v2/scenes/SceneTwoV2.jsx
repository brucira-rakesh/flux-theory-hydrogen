import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PropertyBinding } from "three";
import { createLoaders, prepColorTexture } from "../loaders";
import {
  makeSeaWaveMaterialTwo,
  makeNeonTwoMaterial,
  setupWaterReflection,
} from "../materials";
import { useSceneEngine, applyFolderSettings } from "../SceneEngineContext";
import { useLoaderManager } from "../useLoaderManager";
import { addSeaGui, addEmissiveGui, addTransformGui } from "../gui/guiHelpers";
import { disposeObject } from "../disposeObject";
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

const MODEL_TWO_URL = oxygenPublicUrl("/models/sage_new_9-v1.glb");
const TEXTURE_TWO_URL = oxygenPublicUrl("/textures/Sage-new_1_etc1s.ktx2");
const BG_TEXTURE_TWO_URL = oxygenPublicUrl("/textures/Sage_Bg_etc1s.ktx2");
const TREE_TEXTURE_TWO_URL = oxygenPublicUrl("/textures/Lover_Tree1_etc1s.ktx2");

export default function SceneTwoV2({ visible = true, sharedMaps }) {
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
      gltfLoader.loadAsync(MODEL_TWO_URL),
      ktx2Loader.loadAsync(TEXTURE_TWO_URL),
      ktx2Loader.loadAsync(BG_TEXTURE_TWO_URL),
      ktx2Loader.loadAsync(TREE_TEXTURE_TWO_URL),
    ]).then(([gltf, texture, bgTexture, treeTexture]) => {
      if (disposed) return;

      const model = gltf.scene;
      prepColorTexture(texture, gl);
      prepColorTexture(bgTexture, gl);
      prepColorTexture(treeTexture, gl);

      const { seaMaps } = sharedMaps;
      const backgroundName =
        PropertyBinding.sanitizeNodeName("MainWall-Curve.002");
      const treeName = PropertyBinding.sanitizeNodeName("Plane.001");
      const waterName = PropertyBinding.sanitizeNodeName("Cylinder.012");
      const neonName = PropertyBinding.sanitizeNodeName("Cylinder.004");

      let backgroundMaterial = null;
      let backgroundMesh = null;
      let treeMesh = null;
      let neonMaterial = null;
      let neonMesh = null;
      let waterMesh = null;
      let waterMaterial = null;

      model.traverse((child) => {
        if (!child.isMesh) return;
        child.material?.dispose();

        if (child.name === neonName) {
          child.material = makeNeonTwoMaterial();
          neonMaterial = child.material;
          neonMesh = child;
        } else if (child.name === waterName) {
          child.material = makeSeaWaveMaterialTwo(seaMaps);
          unregisterFns.push(engine.registerAnimated(child.material));
          waterMaterial = child.material;
          waterMesh = child;
        } else if (child.name === backgroundName) {
          child.material = new THREE.MeshBasicMaterial({
            map: bgTexture,
            color: new THREE.Color(1, 1, 1),
          });
          backgroundMaterial = child.material;
          backgroundMesh = child;
        } else if (child.name === treeName) {
          child.material = new THREE.MeshBasicMaterial({
            map: treeTexture,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          });
          treeMesh = child;
        } else {
          child.material = new THREE.MeshBasicMaterial({ map: texture });
        }
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
      model.position.y = 0.322883654980707;
      model.position.z = 8.60567425749908;

      group.add(model);

      const range = Math.max(size.x, size.y, size.z) || 1;
      if (gui) {
        folder = gui.addFolder("Scene Two");
        addTransformGui(folder, { object: model, range, label: "Model" });
        addEmissiveGui(folder, {
          material: backgroundMaterial,
          mesh: backgroundMesh,
          range,
          label: "Background",
        });
        addEmissiveGui(folder, {
          material: neonMaterial,
          mesh: neonMesh,
          range,
          label: "Neon light",
        });
        addSeaGui(folder, { material: waterMaterial, mesh: waterMesh, range });
        addTransformGui(folder, { object: treeMesh, range, label: "Tree" });
        applyFolderSettings(folder, settings, "Scene Two");
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
