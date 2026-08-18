import { useEffect, useMemo, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { useSceneEngine } from "./SceneEngineContext";
import { DEFAULT_AO, DEFAULT_GRADE } from "./postFxDefaults";

const MINIMAP_SIZE = 400;
const MINIMAP_PAD = 20;

// Same overbright-color trick every "emissive" material here relies on
// needs bloom to actually glow (see Scene.jsx's original comment). Taking
// over rendering via useFrame's priority arg tells R3F to stop
// auto-rendering the default camera each frame.
//
// The bloom effect no longer has its own static GUI sliders — its
// intensity/radius/threshold are driven every frame from `progressRef.current
// .bloom` instead, a plain object the carousel (see swingCarousel.js's
// applyTransitionBloom/snapRest) or the preview page (see
// ScenePreviewPage.jsx) keeps updated to the CURRENT scene's own bloom
// target, cross-fading between two scenes' targets while a transition is in
// flight. Each scene owns its own target values (GUI-tunable per scene,
// "Scene Bloom" folder) rather than one global set shared by all five.
const DEFAULT_BLOOM = { strength: 1.6, radius: 0.55, threshold: 0.65 };

export default function PostFX({
  minimapEnabled,
  minimapCamera,
  progressRef,
  ao,
  grade,
}) {
  const { gl, scene, camera, size } = useThree();
  const { engine } = useSceneEngine();
  const [clock] = useState(() => new THREE.Clock());

  const { composer, aoPass, bloom, contrast, vignette } = useMemo(() => {
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
    c.addPass(new RenderPass(scene, camera));

    const aoPass = new N8AOPostPass(scene, camera, size.width, size.height);
    c.addPass(aoPass);

    const bloomEffect = new BloomEffect({
      intensity: DEFAULT_BLOOM.strength,
      luminanceThreshold: DEFAULT_BLOOM.threshold,
      mipmapBlur: true,
    });
    bloomEffect.mipmapBlurPass.radius = DEFAULT_BLOOM.radius;

    const contrastEffect = new BrightnessContrastEffect({
      contrast: DEFAULT_GRADE.contrast,
    });
    const vignetteEffect = new VignetteEffect({
      offset: DEFAULT_GRADE.vignetteOffset,
      darkness: DEFAULT_GRADE.vignetteDarkness,
    });
    c.addPass(
      new EffectPass(camera, bloomEffect, contrastEffect, vignetteEffect),
    );

    return {
      composer: c,
      aoPass,
      bloom: bloomEffect,
      contrast: contrastEffect,
      vignette: vignetteEffect,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
  }, [composer, size]);

  useFrame(() => {
    const target = progressRef?.current?.bloom ?? DEFAULT_BLOOM;
    bloom.intensity = target.strength;
    bloom.mipmapBlurPass.radius = target.radius;
    bloom.luminanceMaterial.threshold = target.threshold;

    const aoParams = ao ?? DEFAULT_AO;
    aoPass.enabled = aoParams.enabled;
    Object.assign(aoPass.configuration, {
      aoRadius: aoParams.aoRadius,
      distanceFalloff: aoParams.distanceFalloff,
      intensity: aoParams.intensity,
      aoSamples: aoParams.aoSamples,
      denoiseSamples: aoParams.denoiseSamples,
      halfRes: aoParams.halfRes,
      screenSpaceRadius: aoParams.screenSpaceRadius,
    });

    const gradeParams = grade ?? DEFAULT_GRADE;
    contrast.contrast = gradeParams.contrast;
    vignette.offset = gradeParams.vignetteOffset;
    vignette.darkness = gradeParams.vignetteDarkness;

    engine.update(gl, scene, camera, clock.getElapsedTime());
    composer.render();

    // Debug picture-in-picture: composer.render() above already filled the
    // whole canvas from the main camera, so this just draws a second,
    // uncomposited (no bloom — plain gl.render, cheap) pass from the
    // minimap's own top-down camera into a scissored bottom-left square on
    // top of it. Scissor restricts BOTH the clear and the draw to that
    // rect, so nothing outside it is touched. Must reset scissor/viewport
    // back to full-canvas after, or composer's next frame would inherit the
    // leftover scissor rect and only redraw that corner.
    if (minimapEnabled && minimapCamera) {
      gl.setScissorTest(true);
      gl.setViewport(MINIMAP_PAD, MINIMAP_PAD, MINIMAP_SIZE, MINIMAP_SIZE);
      gl.setScissor(MINIMAP_PAD, MINIMAP_PAD, MINIMAP_SIZE, MINIMAP_SIZE);
      gl.clear(true, true, false);
      gl.render(scene, minimapCamera);
      gl.setScissorTest(false);
      gl.setViewport(0, 0, size.width, size.height);
    }
  }, 1);

  return null;
}
