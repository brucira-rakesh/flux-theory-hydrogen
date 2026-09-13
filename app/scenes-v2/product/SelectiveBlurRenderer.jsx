import { useEffect, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from "postprocessing";
import { useSceneEngine } from "../SceneEngineContext";
import {
  maskVertexShader,
  maskFragmentShader,
  selectiveBlurVertexShader,
  blurFragmentShader,
  toneMapResolveFragmentShader,
  compositeFragmentShader,
} from "./shaders";
import { addCopyValuesButton } from "./guiUtils";

// Only sceneRT is HalfFloatType, and only because it is the ONE target that
// holds pre-tone-map values: three.js refuses to tone map anything rendered
// into a render target (see toneMapResolveFragmentShader's docblock), so
// what lands there is raw linear HDR, routinely past 1.0 wherever the
// hand-tuned bottle lights hit — intensity 10 on the bathroom one. 8-bit
// would clamp exactly the highlights the ACES curve exists to roll off.
// Everything downstream reads sceneLdrRT instead, which the resolve pass
// has already tone mapped into display range, so those stay 8-bit — as do
// the mask targets, which only ever hold a 0..1 coverage value.
const makeRenderTarget = (depthBuffer, type = THREE.UnsignedByteType, samples = 0) =>
  new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type,
    depthBuffer,
    samples,
  });

// Depth-only target for the soft-particle pre-pass below (see
// renderSelectiveBlur's own comment) — its color output is never read, only
// its attached depthTexture, so Nearest filtering (cheaper, and correct for
// a value that must never be interpolated/blended) is fine everywhere.
const makeDepthRenderTarget = () => {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
  });
  rt.depthTexture = new THREE.DepthTexture(1, 1);
  rt.depthTexture.minFilter = THREE.NearestFilter;
  rt.depthTexture.magFilter = THREE.NearestFilter;
  return rt;
};

// Scratch for stashing the renderer's clear colour across the mask pass, so
// the black that pass needs never leaks into the frames PostFXV2 draws.
const clearColorScratch = new THREE.Color();

// Renders `scene` through `camera` as usual, but with everything except
// `sharpMeshes` blurred by blurParams.amount. Ported from Product.jsx's
// renderSelectiveBlur (see that file's own pass-by-pass pipeline docblock:
// mask -> feather -> background blur -> composite).
//
// EVERY frame goes through the render-target pipeline, including the idle
// one where nothing is revealed. Product.jsx could afford to shortcut that
// case with a plain `gl.render(scene, camera)` straight to the canvas, and
// this did too until it turned out to be the source of a visible jump in
// the shadows on every click. The shadow catchers are ShadowMaterial —
// TRANSPARENT, so what they produce depends on when tone mapping happens
// relative to their blend. Drawing to the canvas tone maps inside each
// material as it draws, giving `0.6 * ACES(floor)`; going through a render
// target blends in linear HDR and tone maps once at the end, giving
// `ACES(0.6 * floor)`. ACES is a curve, so those differ — measured 45/255
// apart in the shadow — and no amount of matching the tone mapping OPERATOR
// closes it, because the mismatch is one of ORDER. Rendering both states
// the same way is the only thing that does. (Product.jsx never hit this:
// it left toneMapping at NoToneMapping, where the curve is the identity and
// blend order stops mattering.) Blending in linear and tone mapping last is
// also the correct order, and the one three's own OutputPass imposes.
//
// The idle case still skips the mask/feather/blur passes — it only pays for
// the scene render, the tone-map resolve, and a straight-through composite.
// Depth-only pre-pass so the fog plane's own shader (see fog.frag's
// soft-particle fade) can sample "what's actually behind me" from a texture
// that's already finished rendering — reading a depth attachment from WITHIN
// the same draw call still writing it would be an invalid feedback loop.
//
// Deliberately called OUTSIDE renderSelectiveBlur, and BEFORE that function's
// own "does product own this frame?" bail: the fog is drawn whenever the
// product room is revealed, which includes resting in the room, where
// PostFXV2 — not this renderer — owns the frame. Running it only inside
// renderSelectiveBlur left uSceneDepth on its white placeholder for exactly
// that resting state, which reads as `soft = 1` everywhere, i.e. NO depth
// carving at all: the fog drew as a raw slab with hard intersection lines
// until the first scroll into the flythrough snapped it to the carved look.
//
// This touches only its own render target (and resets to null afterwards),
// never PostFXV2's composer — see HandoffFogWipe's and PostFXV2's own
// comments on the black-frame regression that raw gl.render() calls around
// that composer caused.
//
// The fog mesh is hidden for this pass: with `scene.overrideMaterial` set,
// EVERY visible mesh renders with depthOnlyMaterial regardless of its own
// depthWrite setting, so leaving the fog visible would write its own depth
// into the very buffer it's about to compare itself against.
function renderFogDepthPrepass(gl, scene, camera, pipeline, fogMesh, depthOutRef) {
  const { depthRT, depthOnlyMaterial } = pipeline;

  const fogWasVisible = fogMesh.visible;
  fogMesh.visible = false;
  scene.overrideMaterial = depthOnlyMaterial;
  gl.setRenderTarget(depthRT);
  gl.render(scene, camera);
  scene.overrideMaterial = null;
  gl.setRenderTarget(null);
  fogMesh.visible = fogWasVisible;

  depthOutRef.current.texture = depthRT.depthTexture;
  depthOutRef.current.near = camera.near;
  depthOutRef.current.far = camera.far;
  depthOutRef.current.width = depthRT.width;
  depthOutRef.current.height = depthRT.height;
}

function renderSelectiveBlur(gl, scene, camera, pipeline, blurParams, sharpMeshes) {
  const {
    sceneRT,
    sceneLdrRT,
    maskRT,
    maskBlurredRT,
    blurRTA,
    blurRTB,
    whiteTexture,
    maskMaterial,
    blurMaterial,
    toneMapResolveMaterial,
    compositeMaterial,
    fsScene,
    fsMesh,
    fsCamera,
  } = pipeline;

  const isIdle = blurParams.amount <= 0.0001 || sharpMeshes.length === 0;

  gl.setRenderTarget(sceneRT);
  gl.render(scene, camera);

  // Resolve the HDR scene down to display range BEFORE anything samples it,
  // so the blur below convolves tone-mapped values rather than raw HDR — see
  // toneMapResolveFragmentShader for why doing this at the end instead
  // blows out every shadow the blur touches. From here on sceneRT is done
  // with and sceneLdrRT is what the pipeline reads.
  toneMapResolveMaterial.uniforms.tDiffuse.value = sceneRT.texture;
  fsMesh.material = toneMapResolveMaterial;
  gl.setRenderTarget(sceneLdrRT);
  gl.render(fsScene, fsCamera);

  // Nothing revealed: hand sceneLdrRT straight to the composite with an
  // all-white mask (keepSharp == 1 everywhere, so tBlur is never read) and
  // skip the mask/feather/blur passes entirely. Same shader, same colour
  // path, same blend order as the revealed case — just without the work.
  if (isIdle) {
    compositeMaterial.uniforms.tScene.value = sceneLdrRT.texture;
    compositeMaterial.uniforms.tBlur.value = sceneLdrRT.texture;
    compositeMaterial.uniforms.tMask.value = whiteTexture;
    compositeMaterial.uniforms.uTintStrength.value = 0;
    presentWithSmaa(gl, pipeline);
    return;
  }

  // Mask pass: hide every mesh except the revealed node's own, and swap in
  // maskMaterial (solid white) over a forced-black background so the
  // composite pass can read "white == keep sharp" unambiguously.
  const previousVisibility = [];
  scene.traverse((child) => {
    if (!child.isMesh) return;
    previousVisibility.push([child, child.visible]);
    child.visible = sharpMeshes.includes(child);
  });
  const previousBackground = scene.background;
  scene.background = null;
  scene.overrideMaterial = maskMaterial;
  gl.setRenderTarget(maskRT);

  // Clear maskRT EXPLICITLY rather than leaving it to gl.render()'s own
  // clear, which does not happen here. `gl.autoClear` is false for the whole
  // app — postprocessing's EffectComposer sets it on the renderer the moment
  // one is constructed (see its setRenderer), and this file builds one for
  // the SMAA blit, as does PostFXV2 — and three only force-clears past that
  // when the scene HAS a background to paint (WebGLBackground.render's
  // `forceClear`). The scene render above keeps working precisely because it
  // still has one; this pass nulls the background so the mask reads
  // unambiguously, which also removes the only thing that was clearing it.
  //
  // So maskRT was never cleared after the frame it was created on: every
  // frame's white silhouette OR-ed onto every previous frame's, and what
  // reached the composite was the union of the bottle's coverage across the
  // whole fly-in and spin — a smeared blob of "keep sharp" spreading well
  // past the bottle, growing for as long as the reveal ran. Depth is in the
  // clear too, for the same reason: stale depth from an earlier camera pose
  // rejects fragments of the bottle at its current one.
  const previousClearAlpha = gl.getClearAlpha();
  gl.getClearColor(clearColorScratch);
  gl.setClearColor(0x000000, 1);
  gl.clear(true, true, false);
  gl.render(scene, camera);
  gl.setClearColor(clearColorScratch, previousClearAlpha);
  scene.overrideMaterial = null;
  scene.background = previousBackground;
  previousVisibility.forEach(([child, visible]) => {
    child.visible = visible;
  });

  fsMesh.material = blurMaterial;

  // Feather the mask's sharp/blur boundary first — a separable Gaussian
  // pass at the (small, constant) feather radius, ping-ponged through
  // blurRTA -> maskBlurredRT. blurRTA is reused again as scratch space for
  // the background blur right below; safe because its contents are fully
  // consumed into maskBlurredRT before anything renders into blurRTA again.
  blurMaterial.uniforms.tDiffuse.value = maskRT.texture;
  blurMaterial.uniforms.uDirection.value.set(1 / maskRT.width, 0);
  blurMaterial.uniforms.uRadius.value = blurParams.featherRadius;
  gl.setRenderTarget(blurRTA);
  gl.render(fsScene, fsCamera);

  blurMaterial.uniforms.tDiffuse.value = blurRTA.texture;
  blurMaterial.uniforms.uDirection.value.set(0, 1 / maskRT.height);
  gl.setRenderTarget(maskBlurredRT);
  gl.render(fsScene, fsCamera);

  // Two-pass separable Gaussian on the background: horizontal sceneLdrRT ->
  // blurRTA, then vertical blurRTA -> blurRTB.
  blurMaterial.uniforms.tDiffuse.value = sceneLdrRT.texture;
  blurMaterial.uniforms.uDirection.value.set(1 / sceneLdrRT.width, 0);
  blurMaterial.uniforms.uRadius.value = blurParams.amount;
  gl.setRenderTarget(blurRTA);
  gl.render(fsScene, fsCamera);

  blurMaterial.uniforms.tDiffuse.value = blurRTA.texture;
  blurMaterial.uniforms.uDirection.value.set(0, 1 / sceneLdrRT.height);
  gl.setRenderTarget(blurRTB);
  gl.render(fsScene, fsCamera);

  compositeMaterial.uniforms.tScene.value = sceneLdrRT.texture;
  compositeMaterial.uniforms.tBlur.value = blurRTB.texture;
  compositeMaterial.uniforms.tMask.value = maskBlurredRT.texture;
  compositeMaterial.uniforms.uTintColor.value.set(blurParams.tintColor);
  compositeMaterial.uniforms.uTintStrength.value = blurParams.tintStrength;
  presentWithSmaa(gl, pipeline);
}

// Composite into an LDR target, then SMAA that image to the canvas.
// Same HIGH preset as PostFXV2 — morphological AA on the already-drawn
// bottle silhouette, not a second 3D render and not MSAA/dpr. The blit
// vertex shader writes NDC directly so the composer RenderPass is a
// fullscreen copy of compositeRT.
function presentWithSmaa(gl, pipeline) {
  const {
    compositeMaterial,
    fsScene,
    fsMesh,
    fsCamera,
    compositeRT,
    blitMaterial,
    smaaComposer,
  } = pipeline;
  fsMesh.material = compositeMaterial;
  gl.setRenderTarget(compositeRT);
  gl.render(fsScene, fsCamera);
  if (!smaaComposer || !blitMaterial || !compositeRT) {
    gl.setRenderTarget(null);
    gl.render(fsScene, fsCamera);
    return;
  }
  blitMaterial.uniforms.tDiffuse.value = compositeRT.texture;
  smaaComposer.render();
}

// Takes over the frame (useFrame priority 1, same mechanism PostFXV2.jsx
// uses to disable R3F's own auto-render) so it can render with whichever
// camera is actually flying through the scene right now
// (useCameraFlythrough's activeCameraRef) instead of R3F's inert default
// `state.camera`. Mounted permanently alongside PostFXV2 in the SAME shared
// canvas/scene now (see Scene.v2.jsx) — `activeRef` (see useProductPhase)
// is what keeps the two from fighting over the same frame: this one is a
// no-op everywhere PostFXV2 owns the picture (the carousel), and PostFXV2 is
// a no-op everywhere this one does (the product flythrough).
export default function SelectiveBlurRenderer({
  assetsRef,
  activeCameraRef,
  activeRevealedNodeRef,
  blurParamsRef,
  activeRef,
  fogMeshRef,
  depthOutRef,
}) {
  const { gl, scene, size } = useThree();
  const { gui } = useSceneEngine();

  const pipeline = useMemo(() => {
    // 4x MSAA on the two 3D passes (scene + mask). Canvas dpr is 1 and
    // gl.antialias is off (see Scene.v2.jsx); PostFXV2 covers the carousel
    // with SMAA. This renderer already draws into its own RTs, so we can
    // MSAA the bottle geometry here without touching the canvas. Mask must
    // match — an aliased keepSharp mix stairs the silhouette even if
    // sceneRT is smooth.
    //
    // Force the classic MSAA renderbuffer + blit resolve. ANGLE's
    // WEBGL_multisampled_render_to_texture path with HalfFloat does not
    // actually filter the silhouette (samples stays 4, output stays 1px
    // stairs). three.js opts into that extension automatically.
    // SMAA HIGH after composite still runs — leftover chroma stairs
    // against the beige shelf, same preset as PostFXV2.
    const msaa = Math.min(4, gl.capabilities.maxSamples || 0);
    const sceneRT = makeRenderTarget(true, THREE.HalfFloatType, msaa);
    const sceneLdrRT = makeRenderTarget(false);
    const maskRT = makeRenderTarget(true, THREE.UnsignedByteType, msaa);
    gl.properties.get(sceneRT).__useRenderToTexture = false;
    gl.properties.get(maskRT).__useRenderToTexture = false;
    const maskBlurredRT = makeRenderTarget(false); // feathered mask fed to the composite pass
    const blurRTA = makeRenderTarget(false); // shared ping-pong scratch target
    const blurRTB = makeRenderTarget(false);
    const compositeRT = makeRenderTarget(false); // LDR composite; SMAA input (never MSAA)

    const maskMaterial = new THREE.ShaderMaterial({
      vertexShader: maskVertexShader,
      fragmentShader: maskFragmentShader,
    });
    const blurMaterial = new THREE.ShaderMaterial({
      vertexShader: selectiveBlurVertexShader,
      fragmentShader: blurFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2() },
        uRadius: { value: 0 },
      },
    });
    // 1x1 white — the "keep everything sharp" mask the idle path composites
    // through, so that path needs no second shader of its own.
    const whiteTexture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    whiteTexture.needsUpdate = true;

    const toneMapResolveMaterial = new THREE.ShaderMaterial({
      vertexShader: selectiveBlurVertexShader,
      fragmentShader: toneMapResolveFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
      },
    });
    const compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: selectiveBlurVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBlur: { value: null },
        tMask: { value: null },
        uTintColor: { value: new THREE.Color(blurParamsRef.current.tintColor) },
        uTintStrength: { value: blurParamsRef.current.tintStrength },
      },
    });

    // Shared full-screen quad every pass reuses (swapping .material) — an
    // orthographic camera fixed at identity, same rig three.js's own
    // postprocessing FullScreenQuad helper uses.
    const fsScene = new THREE.Scene();
    const fsGeometry = new THREE.PlaneGeometry(2, 2);
    const fsMesh = new THREE.Mesh(fsGeometry, blurMaterial);
    fsScene.add(fsMesh);
    const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // SMAA blit: copy compositeRT through a composer that only runs SMAA
    // HIGH (same preset as PostFXV2). toneMapped:false — compositeRT is
    // already display-range; ACES here would wash the reveal vs the shelf.
    const blitMaterial = new THREE.ShaderMaterial({
      vertexShader: selectiveBlurVertexShader,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tDiffuse: { value: null } },
    });
    const blitScene = new THREE.Scene();
    const blitGeometry = new THREE.PlaneGeometry(2, 2);
    const blitMesh = new THREE.Mesh(blitGeometry, blitMaterial);
    blitMesh.frustumCulled = false;
    blitScene.add(blitMesh);
    const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH });
    // HIGH's 0.1 threshold misses the bottle-on-beige shelf; 0.05 is ULTRA's
    // cutoff and still only extra screen-space taps.
    smaaEffect.edgeDetectionMaterial.edgeDetectionThreshold = 0.05;
    const smaaComposer = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
    });
    smaaComposer.addPass(new RenderPass(blitScene, blitCamera));
    smaaComposer.addPass(new EffectPass(blitCamera, smaaEffect));

    // Depth-only pre-pass target + override material for the fog plane's
    // soft-particle fade (see renderFogDepthPrepass's own comment). colorWrite
    // false skips shading entirely — cheaper than three's own
    // MeshDepthMaterial, and all that matters here is depthRT's depth
    // attachment.
    const depthRT = makeDepthRenderTarget();
    const depthOnlyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

    return {
      sceneRT,
      sceneLdrRT,
      maskRT,
      maskBlurredRT,
      blurRTA,
      blurRTB,
      compositeRT,
      whiteTexture,
      maskMaterial,
      blurMaterial,
      toneMapResolveMaterial,
      compositeMaterial,
      blitMaterial,
      blitGeometry,
      smaaEffect,
      smaaComposer,
      fsScene,
      fsGeometry,
      fsMesh,
      fsCamera,
      depthRT,
      depthOnlyMaterial,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => {
    return () => {
      pipeline.sceneRT.dispose();
      pipeline.sceneLdrRT.dispose();
      pipeline.maskRT.dispose();
      pipeline.maskBlurredRT.dispose();
      pipeline.blurRTA.dispose();
      pipeline.blurRTB.dispose();
      pipeline.compositeRT.dispose();
      pipeline.whiteTexture.dispose();
      pipeline.fsGeometry.dispose();
      pipeline.maskMaterial.dispose();
      pipeline.blurMaterial.dispose();
      pipeline.toneMapResolveMaterial.dispose();
      pipeline.compositeMaterial.dispose();
      pipeline.blitMaterial.dispose();
      pipeline.blitGeometry.dispose();
      pipeline.smaaEffect.dispose();
      pipeline.smaaComposer.dispose();
      pipeline.depthRT.dispose();
      pipeline.depthOnlyMaterial.dispose();
    };
  }, [pipeline]);

  // Sized off the canvas's own pixel dimensions (pixel-ratio aware) —
  // replaces Product.jsx's manual resizeSelectiveBlurTargets/resize listener.
  useEffect(() => {
    const pixelRatio = gl.getPixelRatio();
    const width = Math.max(1, Math.floor(size.width * pixelRatio));
    const height = Math.max(1, Math.floor(size.height * pixelRatio));
    pipeline.sceneRT.setSize(width, height);
    pipeline.maskRT.setSize(width, height);
    gl.properties.get(pipeline.sceneRT).__useRenderToTexture = false;
    gl.properties.get(pipeline.maskRT).__useRenderToTexture = false;
    pipeline.sceneLdrRT.setSize(width, height);
    pipeline.maskBlurredRT.setSize(width, height);
    pipeline.blurRTA.setSize(width, height);
    pipeline.blurRTB.setSize(width, height);
    pipeline.compositeRT.setSize(width, height);
    pipeline.depthRT.setSize(width, height);
    pipeline.smaaComposer.setSize(size.width, size.height);
  }, [pipeline, gl, size.width, size.height]);

  useEffect(() => {
    if (!gui) return undefined;
    const blurParams = blurParamsRef.current;
    const blurFolder = gui.addFolder("Selective Blur");
    blurFolder.add(blurParams, "maxRadius", 0, 30, 0.5).name("Max blur radius");
    blurFolder.add(blurParams, "featherRadius", 0, 15, 0.5).name("Mask edge feather");
    blurFolder
      .addColor(blurParams, "tintColor")
      .name("Tint color")
      .onChange((v) => pipeline.compositeMaterial.uniforms.uTintColor.value.set(v));
    blurFolder.add(blurParams, "tintStrength", 0, 1, 0.01).name("Tint strength");
    addCopyValuesButton(
      blurFolder,
      () => ({
        maxRadius: blurParams.maxRadius,
        featherRadius: blurParams.featherRadius,
        tintColor: blurParams.tintColor,
        tintStrength: blurParams.tintStrength,
      }),
      "[ProductV2]",
    );
    return () => blurFolder.destroy();
  }, [gui, pipeline, blurParamsRef]);

  useFrame(() => {
    const activeCamera = activeCameraRef.current;
    if (!activeCamera) return; // camera rig hasn't loaded yet — nothing to render with

    // Ahead of the frame-ownership bail below, so the fog's soft-particle
    // fade behaves identically whether PostFXV2 (resting in the room) or
    // this renderer (the flythrough) is drawing — see
    // renderFogDepthPrepass's own comment. Gated on the fog actually being
    // drawn (uRevealFade > 0, eased by ProductSceneV2) so the carousel
    // never pays for an extra scene render it has no use for.
    const fogMesh = fogMeshRef?.current;
    const revealFade = fogMesh?.material?.uniforms?.uRevealFade?.value ?? 0;
    if (fogMesh && depthOutRef && revealFade > 0.001) {
      renderFogDepthPrepass(gl, scene, activeCamera, pipeline, fogMesh, depthOutRef);
    }

    if (!activeRef.current) return; // carousel owns this frame, not product

    // Exact complement of PostFXV2's own bail (`productActiveRef.current &&
    // productRevealed`), and it MUST stay that way: both are priority-1
    // useFrame renderers drawing to the same default framebuffer, so any
    // state where both run means one of them is pure wasted GPU work.
    //
    // That is exactly what was happening. PostFXV2 only steps aside once a
    // bottle is actually revealed, but this renderer used to take every
    // frame product was on screen at all — so for the whole zoom, the whole
    // resting shot, and everything after (i.e. almost always), the scene was
    // rendered TWICE per frame. And this was the copy that lost: PostFXV2
    // mounts after ProductSceneV2 in Scene.v2.jsx, so it subscribes later,
    // runs later, and overwrites this output before it is ever displayed.
    // Full scene render + tone-map resolve + composite, every frame, thrown
    // away — on top of the depth pre-pass above.
    //
    // `activeRevealedNodeRef` rather than the `productRevealed` React state
    // PostFXV2 reads, deliberately: the ref is written synchronously by
    // useBottleReveal while the state lands a render later, and the skew
    // always falls the safe way (both render for a frame, as before) rather
    // than leaving a frame nobody draws. It also stays set for the whole
    // return flight — which is required, since that is when the blur tween
    // is easing back down to 0 and this renderer is the one drawing it.
    const activeRevealedNode = activeRevealedNodeRef.current;
    if (!activeRevealedNode) return; // no bottle revealed — PostFXV2 owns the frame

    const interactiveMeshes = assetsRef.current.interactiveMeshes;
    const sharpMeshes = interactiveMeshes.filter(
      (mesh) => mesh.userData.revealNode === activeRevealedNode,
    );

    renderSelectiveBlur(
      gl,
      scene,
      activeCamera,
      pipeline,
      blurParamsRef.current,
      sharpMeshes,
    );
  }, 1);

  return null;
}
