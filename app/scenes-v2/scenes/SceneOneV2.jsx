import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PropertyBinding } from "three";
import { createLoaders, prepColorTexture } from "../loaders";
import {
  makeSeaWaveMaterialTwo,
  makeFogMaterial,
  makeDropletMaterial,
  setupWaterReflection,
  fogSharedDefaults,
} from "../materials";
import { useSceneEngine, applyFolderSettings } from "../SceneEngineContext";
import { useLoaderManager } from "../useLoaderManager";
import {
  addSeaGui,
  addFogGui,
  addDropletGui,
  addEmissiveGui,
  addTransformGui,
} from "../gui/guiHelpers";
import { disposeObject } from "../disposeObject";
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

const MODEL_URL = oxygenPublicUrl("/models/Final-Player-Bake9-v1.glb");
const LIGHT_MAP_URL = oxygenPublicUrl("/textures/Player_Light_Map_7_etc1s.ktx2");
const STONES_URL = oxygenPublicUrl("/textures/Player_Stones_etc1s.ktx2");
const BG_TEXTURE_URL = oxygenPublicUrl("/images/sceneonebg.ktx2");

// The Player bake ships geometry only (no glTF materials, no fog/droplet
// planes), so fogone/fogtwo/shower water.001 still come out of the previous
// Scene One export. Both glTF roots sit at identity, so the lifted nodes
// keep their tuned local transforms when reparented onto the new model.
const FOG_SOURCE_URL = oxygenPublicUrl("/models/sceneonev1.glb");
const DROPLET_NAME = PropertyBinding.sanitizeNodeName("shower water.001");

// Ports Scene.jsx's Scene One model+material setup (glTF traverse ->
// material-by-node-name, water reflection, tuned transforms, GUI folder)
// with none of the scroll-carousel/holder logic — this group just sits
// wherever its parent <group> (see Scene.v2.jsx's circle layout) places it.
export default function SceneOneV2({ visible = true, sharedMaps }) {
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
      gltfLoader.loadAsync(MODEL_URL),
      gltfLoader.loadAsync(FOG_SOURCE_URL),
      ktx2Loader.loadAsync(LIGHT_MAP_URL),
      ktx2Loader.loadAsync(STONES_URL),
      ktx2Loader.loadAsync(BG_TEXTURE_URL),
    ]).then(([gltf, fogGltf, lightMap, stonesMap, bgTexture]) => {
      if (disposed) return;

      const model = gltf.scene;
      prepColorTexture(lightMap, gl);
      prepColorTexture(stonesMap, gl);
      prepColorTexture(bgTexture, gl);

      const { seaMaps, fogNoise } = sharedMaps;

      const factoryByOriginalName = {
        "Cylinder.002": () => new THREE.MeshBasicMaterial({ map: lightMap }),
        "Cylinder.005": () => new THREE.MeshBasicMaterial({ map: stonesMap }),
        "Cylinder.001": () =>
          new THREE.MeshBasicMaterial({ map: bgTexture, color: new THREE.Color(1.5, 1.5, 1.5) }),
        "Cylinder.012": () => makeSeaWaveMaterialTwo(seaMaps),
      };
      const factoryBySanitizedName = {};
      for (const [name, factory] of Object.entries(factoryByOriginalName)) {
        factoryBySanitizedName[PropertyBinding.sanitizeNodeName(name)] = factory;
      }

      const lightMapName = PropertyBinding.sanitizeNodeName("Cylinder.002");
      const stonesName = PropertyBinding.sanitizeNodeName("Cylinder.005");
      const bgName = PropertyBinding.sanitizeNodeName("Cylinder.001");
      const seaName = PropertyBinding.sanitizeNodeName("Cylinder.012");
      const fogOneName = PropertyBinding.sanitizeNodeName("fogone");
      const fogTwoName = PropertyBinding.sanitizeNodeName("fogtwo");

      let waterMesh = null;
      let waterMaterial = null;
      let backgroundMaterial = null;
      let backgroundMesh = null;
      let lightMapMesh = null;
      let lightMapMaterial = null;
      let stonesMesh = null;
      let stonesMaterial = null;

      model.traverse((child) => {
        if (!child.isMesh) return;
        child.material?.dispose();

        const factory = factoryBySanitizedName[child.name];
        if (!factory) {
          child.material = new THREE.MeshBasicMaterial({ color: 0x888888 });
          return;
        }
        child.material = factory();
        if (child.material.uniforms?.uTime) {
          unregisterFns.push(engine.registerAnimated(child.material));
        }
        if (child.name === seaName) waterMesh = child;
        if (child.name === bgName) {
          backgroundMaterial = child.material;
          backgroundMesh = child;
        }
        if (child.name === lightMapName) {
          lightMapMaterial = child.material;
          lightMapMesh = child;
        }
        if (child.name === stonesName) {
          stonesMaterial = child.material;
          stonesMesh = child;
        }
      });

      // Lift only fogone/fogtwo/shower water.001 off the old export and drop
      // the rest of it — reparenting keeps each mesh's local transform, which
      // is then overridden with the tuned values below for the fog planes
      // (same as the previous Scene One setup). The droplet has no tuned
      // override (it was never wired up before), so it keeps its authored
      // transform as-is — retune via the GUI below if it doesn't line up.
      let fogOneMesh = null;
      let fogOneMaterial = null;
      let fogTwoMesh = null;
      let fogTwoMaterial = null;
      let dropletMesh = null;
      let dropletMaterial = null;
      const fogMeshes = [];
      fogGltf.scene.traverse((child) => {
        if (
          child.isMesh &&
          (child.name === fogOneName ||
            child.name === fogTwoName ||
            child.name === DROPLET_NAME)
        ) {
          fogMeshes.push(child);
        }
      });
      for (const mesh of fogMeshes) {
        mesh.material?.dispose();
        if (mesh.name === DROPLET_NAME) {
          mesh.material = makeDropletMaterial();
          unregisterFns.push(engine.registerAnimated(mesh.material));
          dropletMesh = mesh;
          dropletMaterial = mesh.material;
        } else {
          mesh.material = makeFogMaterial(fogNoise, fogSharedDefaults);
          unregisterFns.push(engine.registerAnimated(mesh.material));
          if (mesh.name === fogOneName) {
            fogOneMesh = mesh;
            fogOneMaterial = mesh.material;
          } else {
            fogTwoMesh = mesh;
            fogTwoMaterial = mesh.material;
          }
        }
        model.add(mesh);
      }
      disposeObject(fogGltf.scene);

      // Tuned defaults (from Scene.jsx's GUI Export values). The Player bake
      // already carries its own water/geometry transforms, so only the fog
      // planes still need placing by hand.
      if (fogOneMesh) {
        fogOneMesh.position.set(-0.795750617980957, -1.16504198369925, -11.6433935006058);
        fogOneMesh.scale.set(2.13110151171684, 0.915924486398697, 1.1774723751545);
      }
      if (fogTwoMesh) fogTwoMesh.scale.set(2.13110151171684, 0.915924486398697, 1.1774723751545);

      let reflector = null;
      if (waterMesh) {
        waterMaterial = waterMesh.material;
        reflector = setupWaterReflection(waterMesh, waterMaterial, gl);
        model.add(reflector);
        unregisterFns.push(engine.registerWater({ mesh: waterMesh, material: waterMaterial, reflector }));
      }

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      group.add(model);

      const range = Math.max(size.x, size.y, size.z) || 1;
      if (gui) {
        folder = gui.addFolder("Scene One");
        addTransformGui(folder, { object: model, range, label: "Model" });
        addEmissiveGui(folder, { material: backgroundMaterial, mesh: backgroundMesh, range, label: "Background" });
        addEmissiveGui(folder, { material: lightMapMaterial, mesh: lightMapMesh, range, label: "Cylinder.002" });
        addEmissiveGui(folder, { material: stonesMaterial, mesh: stonesMesh, range, label: "Cylinder.005" });
        addSeaGui(folder, { material: waterMaterial, mesh: waterMesh, range });
        addDropletGui(folder, { material: dropletMaterial, mesh: dropletMesh, range });
        const fog = folder.addFolder("Fog");
        addFogGui(fog, { material: fogOneMaterial, mesh: fogOneMesh, range, label: "Fog One" });
        addFogGui(fog, { material: fogTwoMaterial, mesh: fogTwoMesh, range, label: "Fog Two" });
        applyFolderSettings(folder, settings, "Scene One");
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
