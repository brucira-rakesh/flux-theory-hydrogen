import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PropertyBinding } from "three";
import { createLoaders, prepColorTexture } from "../loaders";
import {
  makeSeaWaveMaterialTwo,
  makePillarGlassMaterial,
  pillarGlassParams,
  setupWaterReflection,
} from "../materials";
import { useSceneEngine, applyFolderSettings } from "../SceneEngineContext";
import { useLoaderManager } from "../useLoaderManager";
import {
  addSeaGui,
  addEmissiveGui,
  addTransformGui,
  addGlassGui,
} from "../gui/guiHelpers";
import { disposeObject } from "../disposeObject";
import SelectiveBloomV2 from "../SelectiveBloomV2";
import {
  SCENE_THREE_BLOOM_LAYER,
  defaultSceneThreeBloomParams,
} from "../selectiveBloomConstants";

const MODEL_THREE_PILLAR_URL = "/models/Final-Lover-Pillar2_compressed.glb";
const MODEL_THREE_BAKE_URL = "/models/Final-Lover-Bake_13_compressed.glb";
const TEXTURE_THREE_PILLARS_URL = "/textures/Lover_Pillars_etc1s.ktx2";
const TEXTURE_THREE_LIGHT_MAP_URL = "/textures/Lover-Light_Map4_etc1s.ktx2";
const TEXTURE_THREE_BG_URL = "/textures/Lover_Bg_etc1s.ktx2";
const TEXTURE_THREE_TREE_URL = "/textures/Lover_Tree_etc1s.ktx2";

export default function SceneThreeV2({
  visible = true,
  sharedMaps,
  postFxEnabled = true,
}) {
  const groupRef = useRef(null);
  const modelRef = useRef(null);
  const { gl } = useThree();
  const { engine, gui, settings } = useSceneEngine();
  const manager = useLoaderManager();
  const loadedRef = useRef(false);
  const bloomParams = useMemo(() => defaultSceneThreeBloomParams(), []);
  const bloomPassRef = useRef(null);

  useEffect(() => {
    if (!sharedMaps || loadedRef.current || !groupRef.current) return;
    loadedRef.current = true;
    const group = groupRef.current;

    let disposed = false;
    const unregisterFns = [];
    let folder = null;

    const { gltfLoader, ktx2Loader } = createLoaders(manager, gl);

    Promise.all([
      gltfLoader.loadAsync(MODEL_THREE_PILLAR_URL),
      gltfLoader.loadAsync(MODEL_THREE_BAKE_URL),
      ktx2Loader.loadAsync(TEXTURE_THREE_PILLARS_URL),
      ktx2Loader.loadAsync(TEXTURE_THREE_LIGHT_MAP_URL),
      ktx2Loader.loadAsync(TEXTURE_THREE_BG_URL),
      ktx2Loader.loadAsync(TEXTURE_THREE_TREE_URL),
    ]).then(
      ([
        pillarGltf,
        bakeGltf,
        texturePillars,
        textureLightMap,
        textureBg,
        textureTree,
      ]) => {
        if (disposed) return;

        const model = new THREE.Group();
        model.add(pillarGltf.scene, bakeGltf.scene);
        prepColorTexture(texturePillars, gl);
        prepColorTexture(textureLightMap, gl);
        prepColorTexture(textureBg, gl);
        prepColorTexture(textureTree, gl);

        const { seaMaps } = sharedMaps;
        const meshNode002Name =
          PropertyBinding.sanitizeNodeName("mesh_node.002");
        const mainWallName =
          PropertyBinding.sanitizeNodeName("MainWall-Curve.002");
        const waterOneName = PropertyBinding.sanitizeNodeName("Cylinder.003");
        const waterTwoName = PropertyBinding.sanitizeNodeName("Circle.002");

        let backgroundMaterial = null;
        let backgroundMesh = null;
        let waterOneMesh = null;
        let waterOneMaterial = null;
        let waterTwoMesh = null;
        let waterTwoMaterial = null;
        let pillarMesh = null;
        let pillarMaterial = null;
        const modelMeshes = [];

        model.traverse((child) => {
          if (!child.isMesh) return;
          child.material?.dispose();

          if (child.name === meshNode002Name) {
            child.material = makePillarGlassMaterial(texturePillars);
            pillarMesh = child;
            pillarMaterial = child.material;
          } else if (child.name === mainWallName) {
            child.material = new THREE.MeshBasicMaterial({
              map: textureBg,
              color: new THREE.Color(1, 1, 1),
            });
            backgroundMaterial = child.material;
            backgroundMesh = child;
            backgroundMesh.position.x = 0.79141367264522;
          } else if (child.name === waterOneName) {
            child.material = makeSeaWaveMaterialTwo(seaMaps);
            unregisterFns.push(engine.registerAnimated(child.material));
            waterOneMesh = child;
            waterOneMaterial = child.material;
          } else if (child.name === waterTwoName) {
            child.material = makeSeaWaveMaterialTwo(seaMaps);
            unregisterFns.push(engine.registerAnimated(child.material));
            waterTwoMesh = child;
            waterTwoMaterial = child.material;
          } else {
            child.material = new THREE.MeshBasicMaterial({
              map: textureLightMap,
            });
            modelMeshes.push(child);
          }
        });

        let reflectorOne = null;
        if (waterOneMesh) {
          reflectorOne = setupWaterReflection(
            waterOneMesh,
            waterOneMaterial,
            gl,
          );
          model.add(reflectorOne);
          unregisterFns.push(
            engine.registerWater({
              mesh: waterOneMesh,
              material: waterOneMaterial,
              reflector: reflectorOne,
            }),
          );
        }
        let reflectorTwo = null;
        if (waterTwoMesh) {
          reflectorTwo = setupWaterReflection(
            waterTwoMesh,
            waterTwoMaterial,
            gl,
          );
          model.add(reflectorTwo);
          unregisterFns.push(
            engine.registerWater({
              mesh: waterTwoMesh,
              material: waterTwoMaterial,
              reflector: reflectorTwo,
            }),
          );
        }

        let treeMesh = null;
        let treeMaterial = null;
        if (backgroundMesh) {
          const texWidth = textureTree.image?.width || 1;
          const texHeight = textureTree.image?.height || 1;
          const aspect = texWidth / texHeight;
          const planeHeight = 1;
          const planeWidth = planeHeight * aspect;

          treeMaterial = new THREE.MeshBasicMaterial({
            map: textureTree,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          });
          treeMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(planeWidth, planeHeight),
            treeMaterial,
          );
          treeMesh.position.set(
            -1.68929748733125,
            0.493153423368817,
            -15.4645026482336,
          );
          treeMesh.scale.setScalar(1.66);
          model.add(treeMesh);
        }

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y = -0.0146558087526891;
        model.position.z = 8.31490007867246;
        group.add(model);
        modelRef.current = model;

        const range = Math.max(size.x, size.y, size.z) || 1;
        if (gui) {
          folder = gui.addFolder("Scene Three");
          addTransformGui(folder, { object: model, range, label: "Model" });
          addEmissiveGui(folder, {
            material: backgroundMaterial,
            mesh: backgroundMesh,
            range,
            label: "Background",
          });
          addSeaGui(folder, {
            material: waterOneMaterial,
            mesh: waterOneMesh,
            range,
            label: "Sea (Cylinder.003)",
          });
          addSeaGui(folder, {
            material: waterTwoMaterial,
            mesh: waterTwoMesh,
            range,
            label: "Sea (Circle.002)",
          });
          addGlassGui(folder, {
            material: pillarMaterial,
            glassParams: pillarGlassParams,
            label: "Pillar Glass",
          });
          addTransformGui(folder, { object: treeMesh, range, label: "Tree" });

          const bloom = folder.addFolder("Selective Bloom");
          bloom
            .add(bloomParams, "strength", 0, 3, 0.01)
            .name("Strength")
            .onChange((v) => {
              if (bloomPassRef.current) bloomPassRef.current.strength = v;
            });
          bloom
            .add(bloomParams, "radius", 0, 1, 0.01)
            .name("Radius")
            .onChange((v) => {
              if (bloomPassRef.current) bloomPassRef.current.radius = v;
            });
          bloom
            .add(bloomParams, "threshold", 0, 1, 0.01)
            .name("Threshold")
            .onChange((v) => {
              if (bloomPassRef.current) bloomPassRef.current.threshold = v;
            });

          const objects = bloom.addFolder("Objects");
          const objBloom = (meshes, label) => {
            const list = (Array.isArray(meshes) ? meshes : [meshes]).filter(
              Boolean,
            );
            if (!list.length) return;
            const toggleParams = {
              enabled: list[0].layers.isEnabled(SCENE_THREE_BLOOM_LAYER),
            };
            objects
              .add(toggleParams, "enabled")
              .name(label)
              .onChange((v) => {
                for (const mesh of list) {
                  if (v) mesh.layers.enable(SCENE_THREE_BLOOM_LAYER);
                  else mesh.layers.disable(SCENE_THREE_BLOOM_LAYER);
                }
              });
          };
          objBloom(modelMeshes, "Model");
          objBloom(pillarMesh, "Pillar Glass");
          objBloom(backgroundMesh, "Background");
          objBloom(waterOneMesh, "Sea (Cylinder.003)");
          objBloom(waterTwoMesh, "Sea (Circle.002)");

          applyFolderSettings(folder, settings, "Scene Three");
          folder.close();
        }
      },
    );

    return () => {
      disposed = true;
      for (const off of unregisterFns) off();
      folder?.destroy();
      disposeObject(group);
      group.clear();
      modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedMaps]);

  return (
    <group ref={groupRef} visible={visible}>
      {/* Only mounted once PostFX's own composer has taken over rendering
          (see postFxEnabled in Scene.v2.jsx) — useFrame with a nonzero
          priority disables R3F's default auto-render entirely, so mounting
          this any earlier would blank the canvas during the intro, when
          nothing else is driving the render loop yet. */}
      {postFxEnabled && (
        <SelectiveBloomV2
          rootRef={modelRef}
          active={visible}
          params={bloomParams}
          passRef={bloomPassRef}
        />
      )}
    </group>
  );
}
