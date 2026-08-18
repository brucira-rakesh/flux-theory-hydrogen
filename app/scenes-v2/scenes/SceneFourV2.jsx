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
  makeNeonTwoMaterial,
} from "../materials";
import { useSceneEngine, applyFolderSettings } from "../SceneEngineContext";
import { useLoaderManager } from "../useLoaderManager";
import {
  addSeaGui,
  addEmissiveGui,
  addGlassGui,
  addTransformGui,
} from "../gui/guiHelpers";
import { disposeObject } from "../disposeObject";

const MODEL_FOUR_URL = "/models/scenefourv6.glb";
const TEXTURE_FOUR_URL = "/textures/scenefourv4.ktx2";
const TEXTURE_FOUR_STARS_URL = "/textures/stars_etc1s.ktx2";
const TEXTURE_FOUR_PLANT_URL = "/textures/plant_etc1s.ktx2";
const TEXTURE_FOUR_BIRDS_URL = "/textures/birds_etc1s.ktx2";
const TEXTURE_FOUR_BACKDROP_URL = "/textures/background_etc1s.ktx2";

const WARM_WHITE = [3.929002201330844, 3.4854684767838267, 4];

export default function SceneFourV2({ visible = true, sharedMaps }) {
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
      gltfLoader.loadAsync(MODEL_FOUR_URL),
      ktx2Loader.loadAsync(TEXTURE_FOUR_URL),
      ktx2Loader.loadAsync(TEXTURE_FOUR_STARS_URL),
      ktx2Loader.loadAsync(TEXTURE_FOUR_PLANT_URL),
      ktx2Loader.loadAsync(TEXTURE_FOUR_BIRDS_URL),
      ktx2Loader.loadAsync(TEXTURE_FOUR_BACKDROP_URL),
    ]).then(([gltf, texture, stars, plant, birds, backdrop]) => {
      if (disposed) return;

      const model = gltf.scene;
      [texture, stars, plant, birds, backdrop].forEach((tex) =>
        prepColorTexture(tex, gl),
      );
      stars.wrapS = THREE.RepeatWrapping;
      stars.wrapT = THREE.RepeatWrapping;
      stars.repeat.set(4, 4);

      const { seaMaps } = sharedMaps;
      const neonName = PropertyBinding.sanitizeNodeName("Cylinder.004");
      const waterName = PropertyBinding.sanitizeNodeName("Cylinder.012");
      const starryCeilingName =
        PropertyBinding.sanitizeNodeName("StarryCeiling");
      const treePngName = PropertyBinding.sanitizeNodeName("TreePnNG");
      const backdropName = PropertyBinding.sanitizeNodeName("Backdrop");
      const ceilingLightName = PropertyBinding.sanitizeNodeName("CeilingLight");
      const leftStripName = PropertyBinding.sanitizeNodeName(
        "LeftGlassLightStrip",
      );
      const rightStripName = PropertyBinding.sanitizeNodeName(
        "RightGlassLightStrip",
      );
      const leftGlassName = PropertyBinding.sanitizeNodeName("LeftGlass");
      const rightSmallGlassName =
        PropertyBinding.sanitizeNodeName("RightSmallGlass");
      const rightBigGlassName =
        PropertyBinding.sanitizeNodeName("RightBigGlass");
      const birdPrefix = "bird";

      const glassMaterialInstance = makeGlassMaterial(glassParams);

      let neonMaterial = null;
      let neonMesh = null;
      let backgroundMaterial = null;
      let backgroundMesh = null;
      let waterMesh = null;
      let waterMaterial = null;
      let ceilingLightMaterial = null;
      let ceilingLightMesh = null;
      let leftStripMaterial = null;
      let leftStripMesh = null;
      let rightStripMaterial = null;
      let rightStripMesh = null;

      model.traverse((child) => {
        if (!child.isMesh) return;
        child.material?.dispose();

        if (child.name === neonName) {
          child.material = makeNeonTwoMaterial();
          neonMaterial = child.material;
          neonMesh = child;
        } else if (child.name === ceilingLightName) {
          child.material = makeNeonTwoMaterial();
          ceilingLightMaterial = child.material;
          ceilingLightMesh = child;
        } else if (child.name === leftStripName) {
          child.material = makeNeonTwoMaterial();
          leftStripMaterial = child.material;
          leftStripMesh = child;
        } else if (child.name === rightStripName) {
          child.material = makeNeonTwoMaterial();
          rightStripMaterial = child.material;
          rightStripMesh = child;
        } else if (child.name === waterName) {
          child.material = makeSeaWaveMaterialTwo(seaMaps);
          unregisterFns.push(engine.registerAnimated(child.material));
          waterMaterial = child.material;
          waterMesh = child;
        } else if (
          child.name === leftGlassName ||
          child.name === rightSmallGlassName ||
          child.name === rightBigGlassName
        ) {
          child.material = glassMaterialInstance;
        } else if (child.name === starryCeilingName) {
          child.material = new THREE.MeshBasicMaterial({
            map: stars,
            transparent: true,
            alphaTest: 0.5,
          });
        } else if (child.name === backdropName) {
          child.material = new THREE.MeshBasicMaterial({
            map: backdrop,
            color: new THREE.Color(0.7, 0.7, 0.7),
          });
          backgroundMaterial = child.material;
          backgroundMesh = child;
        } else if (child.name === treePngName) {
          child.material = new THREE.MeshBasicMaterial({
            map: plant,
            transparent: true,
            alphaTest: 0.5,
          });
        } else if (child.name.toLowerCase().startsWith(birdPrefix)) {
          child.material = new THREE.MeshBasicMaterial({
            map: birds,
            transparent: true,
            alphaTest: 0.5,
          });
        } else {
          child.material = new THREE.MeshBasicMaterial({ map: texture });
        }
      });

      // Tuned warm-white glow + authored positions for the three fixtures
      // (from Scene.jsx's Scene Four > [fixture] > Export).
      if (ceilingLightMaterial)
        ceilingLightMaterial.color.setRGB(...WARM_WHITE);
      if (ceilingLightMesh)
        ceilingLightMesh.position.set(
          0,
          2.522563934326172,
          -10.392892837524414,
        );
      if (leftStripMaterial) leftStripMaterial.color.setRGB(...WARM_WHITE);
      if (leftStripMesh)
        leftStripMesh.position.set(
          -3.805037021636963,
          -1.9937138557434082,
          -10.961800575256348,
        );
      if (rightStripMaterial) rightStripMaterial.color.setRGB(...WARM_WHITE);
      if (rightStripMesh)
        rightStripMesh.position.set(
          4.368300437927246,
          -2.0060312747955322,
          -11.339961051940918,
        );

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
      model.position.z = 6.77078252967445;
      // model.position.z = 8.42127474627829;

      group.add(model);

      const range = Math.max(size.x, size.y, size.z) || 1;
      if (gui) {
        folder = gui.addFolder("Scene Four");
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
        addEmissiveGui(folder, {
          material: ceilingLightMaterial,
          mesh: ceilingLightMesh,
          range,
          label: "Ceiling light",
        });
        addEmissiveGui(folder, {
          material: leftStripMaterial,
          mesh: leftStripMesh,
          range,
          label: "Left glass strip",
        });
        addEmissiveGui(folder, {
          material: rightStripMaterial,
          mesh: rightStripMesh,
          range,
          label: "Right glass strip",
        });
        addSeaGui(folder, { material: waterMaterial, mesh: waterMesh, range });
        addGlassGui(folder, { material: glassMaterialInstance, glassParams });
        applyFolderSettings(folder, settings, "Scene Four");
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
