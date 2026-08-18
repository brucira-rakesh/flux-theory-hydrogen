import { useEffect, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { SCENE_THREE_BLOOM_LAYER } from "./selectiveBloomConstants";

const BLACK_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000 });

// Plain (non-hook) factory, mirroring engine.js's createSceneEngine — all the
// per-frame mutation (swapping RenderPass.scene, darkening/restoring
// materials) happens inside closures here rather than directly in the
// component body, since useFrame callbacks aren't allowed to mutate a
// hook-returned value's own properties in place.
const createSelectiveBloomPipeline = (gl, camera, size, params) => {
  const composer = new EffectComposer(gl);
  composer.renderToScreen = false;
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.width, size.height),
    params.strength,
    params.radius,
    params.threshold,
  );
  composer.addPass(bloomPass);

  const quad = new FullScreenQuad(
    new THREE.MeshBasicMaterial({
      map: null,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  );

  const bloomLayerTest = new THREE.Layers();
  bloomLayerTest.set(SCENE_THREE_BLOOM_LAYER);
  const savedMaterials = new Map();

  return {
    bloomPass,
    setSize(width, height) {
      composer.setSize(width, height);
    },
    // Renders the WHOLE app scene through the bloom-only composer — not just
    // this scene's own model — with every non-bloom-layer mesh darkened to
    // flat black first. Rendering only Scene Three's own root here would
    // give the bloom pass no idea that e.g. the front bottle mockup (part of
    // a different object entirely, always on top) sits in front of it, so
    // the glow would get additively pasted straight over it regardless of
    // depth. Rendering everyone in one pass keeps a single, correct depth
    // buffer: darkened (non-bloom) foreground objects still occlude bloom
    // sources behind them exactly like the real frame does.
    renderFrame(scene) {
      scene.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (!bloomLayerTest.test(child.layers)) {
          savedMaterials.set(child, child.material);
          child.material = BLACK_MATERIAL;
        }
      });

      renderPass.scene = scene;
      composer.render();

      for (const [mesh, material] of savedMaterials) mesh.material = material;
      savedMaterials.clear();

      // The PURE bloom, not composer.readBuffer. UnrealBloomPass has
      // needsSwap=false and, when not rendering to screen, blends its bloom
      // additively *over its input* — so readBuffer ends up holding
      // "darkened scene + bloom". Additively compositing that would paint
      // every bloom-layer mesh onto the frame a second time at full material
      // color, regardless of strength (a 0-strength pass would still double
      // their brightness). renderTargetsHorizontal[0] is the composited mip
      // pyramid *before* that blend — it scales with strength and goes fully
      // black at 0, which is what an additive overlay actually wants.
      quad.material.map = bloomPass.renderTargetsHorizontal[0].texture;
      const prevAutoClear = gl.autoClear;
      gl.autoClear = false;
      gl.setRenderTarget(null);
      quad.render(gl);
      gl.autoClear = prevAutoClear;
    },
    dispose() {
      composer.dispose();
      quad.material.dispose();
      quad.dispose();
    },
  };
};

export default function SelectiveBloomV2({ rootRef, active, params, passRef }) {
  const { gl, scene, camera, size } = useThree();

  const pipeline = useMemo(
    () => createSelectiveBloomPipeline(gl, camera, size, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl, camera],
  );

  useEffect(() => {
    pipeline.setSize(size.width, size.height);
  }, [pipeline, size]);

  useEffect(() => {
    if (passRef) passRef.current = pipeline.bloomPass;
  }, [passRef, pipeline]);

  useEffect(() => () => pipeline.dispose(), [pipeline]);

  useFrame(() => {
    if (!active || !rootRef.current) return;
    pipeline.renderFrame(scene);
  }, 2);

  return null;
}
