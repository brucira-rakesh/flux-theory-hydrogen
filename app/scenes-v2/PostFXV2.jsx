import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
} from "postprocessing";
import { useSceneEngine } from "./SceneEngineContext";
import { getBloomExclusions, getBloomExclusionVersion } from "./bloomExclusion";
import { shouldRunHeavyPasses } from "./restGate";

const MINIMAP_SIZE = 400;
const MINIMAP_PAD = 20;

// Bloom-only variant of PostFX.jsx — no N8AO pass, no
// BrightnessContrast/Vignette grading pass. Same overbright-color trick
// every "emissive" material here relies on needs bloom to actually glow
// (see Scene.jsx's original comment). Taking over rendering via useFrame's
// priority arg tells R3F to stop auto-rendering the default camera each
// frame.
const DEFAULT_BLOOM = { strength: 1.6, radius: 0.55, threshold: 0.65 };

export default function PostFXV2({
  minimapEnabled,
  minimapCamera,
  progressRef,
  productActiveRef,
  productRevealed,
  handoffFogRef,
  handoffActiveRef,
  roomRevealedRef,
}) {
  const { gl, scene, camera, size } = useThree();
  const { engine } = useSceneEngine();
  const [clock] = useState(() => new THREE.Clock());
  // Last exclusion-registry version this composer's selection was built from.
  const syncedVersion = useRef(-1);

  const { composer, bloom, bloomPass } = useMemo(() => {
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
    c.addPass(new RenderPass(scene, camera));

    // Selective rather than plain BloomEffect purely so certain meshes can
    // opt OUT (see bloomExclusion) — everything else blooms exactly as it did
    // before. `inverted` is what makes the selection an exclusion list: the
    // mask keeps fragments whose depth does NOT match the selection's
    // (NotEqualDepth), so the selected objects are the ones held back. With
    // an empty selection the effect skips its mask pass altogether and this
    // is the old plain-bloom path, at the old cost.
    const bloomEffect = new SelectiveBloomEffect(scene, camera, {
      intensity: DEFAULT_BLOOM.strength,
      luminanceThreshold: DEFAULT_BLOOM.threshold,
      mipmapBlur: true,
    });
    bloomEffect.inverted = true;
    bloomEffect.mipmapBlurPass.radius = DEFAULT_BLOOM.radius;

    const bloomPass = new EffectPass(camera, bloomEffect);
    c.addPass(bloomPass);

    // Geometric edges (the floating bottle especially) are rasterized into
    // the composer's non-MSAA targets — Canvas `antialias` never sees them,
    // and dpr is capped at 1 on purpose (see Scene.v2.jsx). SMAA is a
    // fullscreen morphological pass, not 2x/4x fill. LOW/MEDIUM skip
    // diagonal + corner detection, which is exactly the bottle silhouette
    // (rounded cap, long diagonals). HIGH still only extra screen-space
    // taps. Do not swap this for composer MSAA or a dpr bump.
    c.addPass(
      new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })),
    );

    return { composer: c, bloom: bloomEffect, bloomPass };
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
  }, [composer, size]);

  // [DEBUG-perf] Temporary instrumentation — remove once the 3fps report is
  // diagnosed.
  //
  // The previous version of this read gl.info at priority 0 and reported
  // calls=1/tris=2, which was an artifact: three resets those counters on
  // every render() call, so it was only ever showing the composer's final
  // fullscreen quad. autoReset is disabled below and the counters are reset
  // once per frame instead, so they accumulate the WHOLE frame.
  //
  // The decisive number here is jsMs vs frameMs. Every useFrame in the app
  // runs between these two callbacks (-1000 sorts first, 1000 sorts last),
  // so jsMs is all the main-thread work we control. If jsMs is close to
  // frameMs, the bottleneck is our own JS. If jsMs is small while frameMs
  // stays ~166, nothing we execute is slow and the time is going to GPU
  // stall, video decode/upload, or compositing — an entirely different fix.
  const dbgRef = useRef({
    t0: 0,
    lastLog: performance.now(),
    frames: 0,
    js: 0,
    worst: 0,
  });
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  useFrame(() => {
    const d = dbgRef.current;
    d.t0 = performance.now();
    gl.info.reset();
  }, -1000);

  useFrame(() => {
    const d = dbgRef.current;
    const now = performance.now();
    d.js += now - d.t0;
    d.frames++;
    const sinceLog = now - d.lastLog;
    if (now - d.t0 > d.worst) d.worst = now - d.t0;
    if (sinceLog >= 1000) {
      // Logging disabled — diagnosis done. Counters below still reset each
      // window so re-enabling this later gives correct numbers immediately.
      // const info = gl.info;
      // eslint-disable-next-line no-console
      // console.log(
      //   `[DEBUG-perf] fps=${(d.frames / (sinceLog / 1000)).toFixed(1)}` +
      //     ` frameMs=${(sinceLog / d.frames).toFixed(1)}` +
      //     ` jsMs=${(d.js / d.frames).toFixed(1)}` +
      //     ` worstJsMs=${d.worst.toFixed(1)}` +
      //     ` calls=${info.render.calls} tris=${info.render.triangles}` +
      //     ` programs=${info.programs?.length ?? "?"}` +
      //     ` textures=${info.memory.textures}` +
      //     ` vids=${document.querySelectorAll("video").length}` +
      //     ` playing=${[...document.querySelectorAll("video")].filter((v) => !v.paused).length}`,
      // );
      d.lastLog = now;
      d.frames = 0;
      d.js = 0;
      d.worst = 0;
    }
  }, 1000);

  useFrame(() => {
    // Product's own flythrough (see SelectiveBlurRenderer) owns the frame
    // once scroll has carried past the carousel's own range — see
    // useProductPhase. Two priority-1 useFrame renderers sharing one canvas
    // would otherwise both draw to the same default framebuffer every
    // frame, wasting the GPU work of whichever drew first and leaving the
    // picture up to whichever happened to run last.
    if (productActiveRef?.current && productRevealed) return;

    // Bloom is switched OFF WHOLESALE once the cloud wipe has actually
    // swapped product's room in (roomRevealedRef, flipped by
    // useSceneToProductHandoff's timeline at the instant-swap point — the
    // same cue useProductAutoZoom starts its zoom on).
    //
    // This is not a look change: by that point EVERY mesh on screen is
    // already in the exclusion selection below (the room and all 25 bottle
    // primitives register themselves in useProductAssets), product's own
    // fog/rain planes are disabled, and BottleRigV2 + BottleLights — the
    // carousel's only bloom-eligible content — are inside a <HideWhile> on
    // the same phase (see Scene.v2.jsx). There is nothing left for the pass
    // to bloom; it was purely rendering a mask to prove that.
    //
    // And that mask is expensive in exactly the wrong place.
    // SelectiveBloomEffect only skips its mask work when the selection is
    // EMPTY (`if (ignoreBackground || !inverted || selection.size > 0)`);
    // with `inverted = true` it otherwise runs a full DepthPass with
    // `camera.layers.set(selection.layer)` — i.e. a second, depth-only
    // render of precisely the selected objects. In the carousel that's a
    // handful of video quads. In product it's the room (409k tris) plus the
    // bathroom bottles (1.62M tris, see useProductAssets), so the heaviest
    // geometry in the whole app was being drawn TWICE per frame just to
    // build a mask that holds all of it back. Clearing the selection takes
    // that path out; disabling the pass itself also skips the luminance +
    // mipmap-blur chain, which intensity 0 alone would still have paid for
    // (EffectComposer honours `pass.enabled` — see its own render loop).
    const productOwnsFrame = Boolean(roomRevealedRef?.current);
    const bloomShouldRun = !productOwnsFrame;
    if (bloomPass.enabled !== bloomShouldRun) {
      bloomPass.enabled = bloomShouldRun;
      if (!bloomShouldRun) {
        bloom.selection.clear();
      }
      // Force the sync below to rebuild the selection on the way back out —
      // the registry version hasn't moved, but the selection was emptied
      // behind its back.
      syncedVersion.current = -1;
    }

    // Re-sync only when a plane has actually mounted or unmounted — the
    // version counter is there so this isn't rebuilt every frame.
    if (
      !productOwnsFrame &&
      syncedVersion.current !== getBloomExclusionVersion()
    ) {
      syncedVersion.current = getBloomExclusionVersion();
      bloom.selection.clear();
      for (const object of getBloomExclusions()) bloom.selection.add(object);
    }

    const target = progressRef?.current?.bloom ?? DEFAULT_BLOOM;
    // Scaled down as the handoff fog rises, all the way to 0 once it's
    // fully opaque. A fully opaque wipe is meant to conceal the swap
    // completely, bloom included — this is what keeps anything still bright
    // underneath it (the carousel's own bottle, never added to
    // bloomExclusion.js the way the room/bathroom bottle were, so it blooms
    // same as always) from becoming more noticeable once it's the one
    // bright thing left against a misting backdrop, the same "existing glow
    // reads as worse once everything around it goes soft" effect the
    // blur-radius report turned out to be. A separate attempt at also
    // excluding the fog PLANE itself from bloom (rendering it on its own
    // layer, in an extra un-bloomed pass after composer.render()) caused a
    // WORSE regression — a black frame for the fog-covered span of every
    // transition, from fighting EffectComposer's own render-target/clear
    // state with raw gl.render() calls — and was reverted; this
    // intensity-scale is lower-risk (it only ever touches a number
    // SelectiveBloomEffect already reads every frame) and was already
    // doing most of the actual work.
    const fogOpacity = handoffFogRef?.current?.opacity ?? 0;
    const bloomFactor = 1 - THREE.MathUtils.clamp(fogOpacity, 0, 1);
    bloom.intensity = target.strength * bloomFactor;
    bloom.mipmapBlurPass.radius = target.radius;
    bloom.luminanceMaterial.threshold = target.threshold;

    engine.update(gl, scene, camera, clock.getElapsedTime(), {
      // Home has no N8AO (this composer is bloom-only; see PostFX.jsx for
      // the preview-page AO pass). The bathroom hitch here is the planar
      // water RT — freeze it mid-swing and under both wipes, keep the last
      // texture so rest doesn't flash black.
      updateReflections: shouldRunHeavyPasses({
        progressRef,
        handoffActiveRef,
      }),
    });
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
