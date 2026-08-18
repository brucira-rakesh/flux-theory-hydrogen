import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { useLenis } from 'lenis/react'
import GUI from 'lil-gui'
import { useNavigate } from 'react-router-dom'
import { getProductById } from '../data/products'
import { getPdpByProductId } from '../data/pdp'
import ProductDetailsV2 from '../components/ProductShelf/ProductDetailsV2'
import AnimatedDescription from '../components/AnimatedDescription/AnimatedDescription'
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl'
import bathroomTextureUrl from '~/assets/ktx2/bathroom_etc1s.ktx2?url'

// Overlay content shown for every clicked bottle (see the reveal/return
// wiring on isRevealed below) — the 3D scene has 9 independently-clickable
// bottle nodes across two different glTF models with no per-node product
// data, so rather than guess a mesh->product mapping, every reveal shows the
// same card (matches the reference design, sourced from "the-sport").
const OVERLAY_PRODUCT = getProductById('the-sport')

gsap.registerPlugin(ScrollTrigger)

const MODEL_URL = oxygenPublicUrl('/models/washroom_compressed.glb')
const TEXTURE_URL = bathroomTextureUrl

// Both bottle models ship their own materials + embedded KTX2 (basisu)
// label/normal textures, unlike the room (which has no material at all).
// GLTFLoader builds those into MeshStandardMaterial automatically — except
// meshes whose material uses KHR_materials_clearcoat, which GLTFLoader
// upgrades to MeshPhysicalMaterial. Per spec, every mesh here is rebuilt as
// a plain THREE.MeshStandardMaterial (dropping clearcoat), lit by the
// scene's existing ambient + directional lights — see the bottle setup below.
const BATHROOM_BOTTLE_MODEL_URL = oxygenPublicUrl('/models/bathroom_bottle.glb')
const WASHBASIN_BOTTLE_MODEL_URL = oxygenPublicUrl('/models/washbasin_bottle.glb')

// Camera.glb (verified by actually running GLTFLoader against it in Node —
// see the git history for the throwaway probe script) holds two root nodes
// with an attached PerspectiveCamera each — glTF node names "Camera" and
// "Camera.002" — plus two unrelated, mesh-less "BézierCurve" empties left
// over from Blender (the paths these cameras were animated along; harmless
// to load, nothing to render). Two animation clips drive them back-to-back:
//   "CameraAction"     -> node "Camera"     (translation only,      0-4s)
//   "Camera.002Action" -> node "Camera.002" (translation + rotation, 0-2.4583s)
// i.e. an authored two-part dolly-in/pan flythrough, not a single clip.
//
// IMPORTANT: GLTFLoader runs every node name through
// PropertyBinding.sanitizeNodeName, which STRIPS DOTS — so the actual
// runtime object's `.name` is "Camera002", not "Camera.002" (confirmed by
// running GLTFLoader against this exact file). Matching by name string is
// therefore fragile; instead we read `gltf.cameras[0]`/`gltf.cameras[1]`
// directly — the loader's own camera array, in glTF `cameras[]` definition
// order, which is unaffected by node-name sanitization and was confirmed
// (by identity check against the traversed scene) to line up as
// cameras[0] === the "Camera" node, cameras[1] === the "Camera.002" node.
const CAMERA_MODEL_URL = oxygenPublicUrl('/models/Camera.glb')
const CAMERA_CLIP_ONE_NAME = 'CameraAction'
const CAMERA_CLIP_TWO_NAME = 'Camera.002Action'

// Scroll distance (in viewport heights) the flythrough is scrubbed across.
const SCROLL_LENGTH_VH = 300

// Deadband (seconds of clip-time) around the clip-one/clip-two boundary
// that the render-camera swap must clear before flipping back — prevents
// rapid toggling if scroll velocity hovers right at the handoff.
const CAMERA_HANDOFF_HYSTERESIS = 0.05

// --- Click-to-reveal bottle interaction ---
// A mesh is click/hover-interactive if it belongs to a glTF node whose name
// starts with this prefix. IMPORTANT: every bottle mesh in these files has 5
// primitives, so GLTFLoader wraps each node in a Group named "NEW_BASE0XX"
// (sanitized, dot-stripped — see the Camera.glb note above) and the actual
// raycast-able child meshes are named after the *mesh* ("Plane0XX"), NOT the
// node — so this prefix must be tested by walking a mesh's ANCESTORS, not the
// mesh's own name (see tagInteractiveMeshes below). This still guards against
// picking up incidental non-bottle geometry if a future model revision adds any.
const INTERACTIVE_MESH_NAME_PREFIX = 'NEW_BASE'

// Fallback spin amount, in DEGREES, for any node without its own entry in
// SPIN_DEGREES_OVERRIDES below. There's deliberately no live GUI control for
// this — a shared "default spin" slider used to write through into every
// node's own value, which fought with each node's independent "Per-mesh
// spin degrees" slider (retargeting nodes the user wasn't even touching).
// Each mesh's spin is tuned solely via its own per-mesh slider.
const DEFAULT_SPIN_DEGREES = 360

// Hand-tuned per mesh — the exact degree amount each node spins by while
// flying toward the camera. Keyed by node.name; nodes not listed here just
// use DEFAULT_SPIN_DEGREES. Applied when each node is first tagged — see
// tagInteractiveMeshes. Any value works, not just multiples of 360 — see the
// whole/fractional-turn split in revealNode's docblock for how the landing
// angle stays exact regardless. Empty — every node is currently tuned to
// exactly DEFAULT_SPIN_DEGREES (360°), so none need an override.
const SPIN_DEGREES_OVERRIDES = {}

// Fallback FINAL landing rotation, in DEGREES about the same "up" axis the
// spin flourish uses, for any node without its own entry in
// FINAL_ROTATION_OVERRIDES below. Unlike SPIN_DEGREES_OVERRIDES (which only
// affects the in-flight flourish and never changes where the node lands —
// see revealNode's docblock), this offset is baked directly into the node's
// resting `targetQuaternion` itself, so it DOES change the final presented
// angle: 0 keeps the original camera-consistent viewing angle, any other
// value twists that angle by that many degrees.
const DEFAULT_FINAL_ROTATION_DEGREES = 0

// Hand-tuned per mesh — keyed by node.name; nodes not listed here just use
// DEFAULT_FINAL_ROTATION_DEGREES. Applied when each node is first tagged —
// see tagInteractiveMeshes.
const FINAL_ROTATION_OVERRIDES = {
  NEW_BASE011: -22,
  NEW_BASE014: -33,
  NEW_BASE016: 35,
  NEW_BASE018: 15,
  NEW_BASE001: -56,
  NEW_BASE003: -18,
  NEW_BASE007: -31,
}

// --- Selective blur on non-clicked geometry ---
// While a bottle node is revealed, everything EXCEPT that node blurs so it
// reads as the in-focus subject. Implemented as manual full-screen passes
// (no postprocessing lib, consistent with the rest of this file):
//   1. mask pass    - renders ONLY the revealed node's meshes, solid white
//                      on black, into maskRT (maskVertexShader/maskFragmentShader)
//   2. mask feather - the SAME Gaussian blur pass below, run on maskRT at a
//                      small fixed radius, so the sharp/blurred boundary
//                      reads as a soft falloff instead of a razor cutout
//   3. blur pass    - the Gaussian, run once horizontally then once
//                      vertically (ping-ponged through blurRTA/blurRTB)
//                      over the normally-rendered sceneRT
//   4. composite    - mix(blurred, sharp, featheredMask) so the masked node
//                      stays sharp over an otherwise-blurred frame, written
//                      to the canvas
// All passes share one full-screen quad (selectiveBlurVertexShader just
// forwards clip-space position/uv, ignoring the camera transform entirely,
// so any camera object satisfies renderer.render()'s API).
// blurParams.amount (the Gaussian's radius in texels for the background
// blur; 0 == no blur, see blurFragmentShader) is driven by the SAME gsap
// tween as the reveal/return flight in revealNode/returnNode below, so the
// blur fades in/out in lockstep with the bottle's motion instead of as a
// separate, out-of-sync effect.
const maskVertexShader = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const maskFragmentShader = /* glsl */ `
  void main() {
    gl_FragColor = vec4(1.0);
  }
`
const selectiveBlurVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`
// A true analytic Gaussian (not the fixed-weight/offset "optimized 5-tap"
// approximation, which only looks right at the one radius it was tuned
// for — scale its offsets up for a bigger blur and the same 5 samples just
// spread further apart, reading as banding/ghosting instead of a smooth
// blur). Here SAMPLES taps per side are spread evenly across the FULL
// requested radius and weighted by the actual Gaussian falloff (sigma tied
// to that same radius), so the kernel stays well-sampled and smooth no
// matter how large uRadius gets. uRadius === 0 collapses every offset to 0,
// so every tap samples the same texel and the pass is a lossless copy of
// its input — this is what makes amount = 0 read as perfectly sharp.
const blurFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  uniform float uRadius;
  const int SAMPLES = 8;
  void main() {
    float sigma = max(uRadius * 0.5, 0.0001);
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    for (int i = -SAMPLES; i <= SAMPLES; i++) {
      float offset = (float(i) / float(SAMPLES)) * uRadius;
      float weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
      color += texture2D(tDiffuse, vUv + uDirection * offset) * weight;
      totalWeight += weight;
    }
    gl_FragColor = color / totalWeight;
  }
`
// linearToOutputTexel() needs no declaration/import: three.js's WebGLProgram
// auto-injects it into every ShaderMaterial's fragment shader, matched to
// the CURRENT render target (identity when rendering into an RT, real
// linear->sRGB when rendering to the canvas) — the same mechanism built-in
// materials rely on. This is the only pass that ever renders straight to
// the canvas, so it's the only one that needs the call. `tMask` here is
// already the FEATHERED mask (see the pipeline docblock above), so the mix
// itself softens gradually across the boundary rather than snapping.
// uTintColor/uTintStrength wash the BLURRED region only (a color grade over
// the out-of-focus background, e.g. dimming/cooling it) — applied before the
// sharp/blur mix, so the clicked bottle itself is never tinted.
const compositeFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBlur;
  uniform sampler2D tMask;
  uniform vec3 uTintColor;
  uniform float uTintStrength;
  void main() {
    vec4 sharpColor = texture2D(tScene, vUv);
    vec4 blurredColor = texture2D(tBlur, vUv);
    blurredColor.rgb = mix(blurredColor.rgb, uTintColor, uTintStrength);
    float keepSharp = texture2D(tMask, vUv).r;
    gl_FragColor = mix(blurredColor, sharpColor, keepSharp);
    gl_FragColor = linearToOutputTexel(gl_FragColor);
  }
`
// Gaussian radius (in texels) once a reveal has fully settled in. Tweakable
// live via the "Selective Blur" GUI folder.
const MAX_BLUR_RADIUS = 8
// Gaussian radius (in texels) used to feather the mask's sharp/blur
// boundary — constant, NOT tied to the reveal tween, since the softness of
// that edge shouldn't change over the course of the animation. Tweakable
// live via the "Selective Blur" GUI folder.
const DEFAULT_MASK_FEATHER_RADIUS = 3

export default function Product() {
  const containerRef = useRef(null)
  // When mounted standalone (the /product route — no <ReactLenis> ancestor)
  // this is always null, and the effect below creates its own Lenis exactly
  // as before. When embedded inside HomeV2Page (which only renders this
  // component once ITS OWN useLenis() has resolved — see the render gate at
  // the call site), this is already the page's single root Lenis instance
  // on first mount, so the effect reuses it instead of spinning up a SECOND
  // Lenis fighting the root one for control of window scroll.
  const contextLenis = useLenis()
  const navigate = useNavigate()

  const handleBuy = (product) => {
    const pdp = getPdpByProductId(product.id)
    if (pdp) {
      navigate(`/products/${pdp.slug}`)
      return
    }
    console.info('[Flux Theory] Buy Now:', product.id)
  }

  // Drives the product-overlay fade below — toggled from inside the
  // imperative reveal/return flight logic further down (revealNode /
  // returnNode), which lives inside the mount-once effect and captures this
  // setter once (stable across renders, so that's safe).
  const [isRevealed, setIsRevealed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)

    // Rendered only until Camera.glb's own authored cameras have loaded and
    // taken over — see applyScrollProgress/activeCamera below.
    const fallbackCamera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    )
    fallbackCamera.position.set(3, 2, 5)
    let activeCamera = fallbackCamera

    const ambientLight = new THREE.AmbientLight(0xfece7c, 1)
    scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2)
    directionalLight.position.set(4, 6, 4)
    scene.add(directionalLight)

    // --- Per-bottle directional lights ---
    // Both lights below are hand-tuned via the "Copy values" button in the
    // GUI — position/target/color/intensity/shadow bias are the tuned
    // result, not placeholders, so neither target is re-aimed at the
    // bottle's bounding-box center after load; see the `autoAimTarget: false`
    // calls in fitBottleShadow below.
    // Shadow camera frustum is still re-fitted to each bottle's actual
    // bounding box once it loads (see the Promise.all `.then()` below).
    const bathroomBottleLight = new THREE.DirectionalLight(0xfee6be, 10)
    bathroomBottleLight.position.set(-5.6, 6.8, 1.4)
    bathroomBottleLight.target.position.set(-6.3852246662429, 4.901744542284266, 1.4861607474405694)
    bathroomBottleLight.castShadow = true
    bathroomBottleLight.shadow.mapSize.set(1024, 1024)
    bathroomBottleLight.shadow.camera.near = 0.1
    bathroomBottleLight.shadow.camera.far = 10
    bathroomBottleLight.shadow.camera.left = -1
    bathroomBottleLight.shadow.camera.right = 1
    bathroomBottleLight.shadow.camera.top = 1
    bathroomBottleLight.shadow.camera.bottom = -1
    bathroomBottleLight.shadow.bias = -0.0005
    scene.add(bathroomBottleLight)
    scene.add(bathroomBottleLight.target)
    const bathroomBottleLightHelper = new THREE.DirectionalLightHelper(bathroomBottleLight, 0.5)
    scene.add(bathroomBottleLightHelper)
    const washbasinBottleLight = new THREE.DirectionalLight(0xffc766, 3.32)
    washbasinBottleLight.position.set(8.5, 7.9, 9.4)
    washbasinBottleLight.target.position.set(3.7691904025709455, 3.847839194704494, 8.001336202107082)
    washbasinBottleLight.castShadow = true
    washbasinBottleLight.shadow.mapSize.set(1024, 1024)
    washbasinBottleLight.shadow.camera.near = 0.1
    washbasinBottleLight.shadow.camera.far = 10
    washbasinBottleLight.shadow.camera.left = -1
    washbasinBottleLight.shadow.camera.right = 1
    washbasinBottleLight.shadow.camera.top = 1
    washbasinBottleLight.shadow.camera.bottom = -1
    washbasinBottleLight.shadow.bias = -0.0005
    scene.add(washbasinBottleLight)
    scene.add(washbasinBottleLight.target)
    const washbasinBottleLightHelper = new THREE.DirectionalLightHelper(washbasinBottleLight, 0.5)
    scene.add(washbasinBottleLightHelper)

    // --- Shadow-catcher planes ---
    // The room (roomModel, added further below) is a baked-lighting mesh on
    // MeshBasicMaterial, which ignores lights entirely — it CANNOT receive a
    // real shadow map. THREE.ShadowMaterial is built for exactly this: it's
    // invisible except where a shadow falls on it, so laid flat over the
    // baked floor it reads as a contact shadow without relighting the bake.
    // One catcher per bottle; both share one PlaneGeometry (only the mesh's
    // position/scale differ), sized/positioned to each bottle's own
    // bounding box once it loads (see `.then()` below).
    const shadowPlaneGeometry = new THREE.PlaneGeometry(1, 1)

    const bathroomShadowMaterial = new THREE.ShadowMaterial({ opacity: 0.4 })
    const bathroomShadowPlane = new THREE.Mesh(shadowPlaneGeometry, bathroomShadowMaterial)
    bathroomShadowPlane.rotation.x = -Math.PI / 2
    bathroomShadowPlane.receiveShadow = true
    // Nudges the catcher a hair above the baked floor so it doesn't z-fight
    // with roomModel's own (coincident) floor geometry.
    bathroomShadowMaterial.polygonOffset = true
    bathroomShadowMaterial.polygonOffsetFactor = -1
    bathroomShadowMaterial.polygonOffsetUnits = -1
    scene.add(bathroomShadowPlane)

    const washbasinShadowMaterial = new THREE.ShadowMaterial({ opacity: 0.3 })
    const washbasinShadowPlane = new THREE.Mesh(shadowPlaneGeometry, washbasinShadowMaterial)
    washbasinShadowPlane.rotation.x = -Math.PI / 2
    washbasinShadowPlane.receiveShadow = true
    washbasinShadowMaterial.polygonOffset = true
    washbasinShadowMaterial.polygonOffsetFactor = -1
    washbasinShadowMaterial.polygonOffsetUnits = -1
    scene.add(washbasinShadowPlane)

    // --- lil-gui debug panel for the two bottle lights ---
    const gui = new GUI({ title: 'Bottle Lights', closeFolders: true })
    const colorParams = {
      bathroomBottleColor: '#fee6be',
      washbasinBottleColor: '#ffc766',
      ambientColor: '#fece7c',
    }

    // Adds a "Copy values" button to `folder` that dumps whatever
    // `getValues()` currently returns as JSON to the console + clipboard, so
    // hand-tuned light/shadow values can be pasted back in as new defaults.
    // Reads live (called only on click), so it always reflects what's on
    // screen — same pattern as Seawave.jsx's "Export values" button.
    const addCopyValuesButton = (folder, getValues) => {
      let copyController
      const copyValues = () => {
        const json = JSON.stringify(getValues(), null, 2)
        console.log('[Product] Copied light values:\n' + json)
        navigator.clipboard?.writeText(json).catch(() => {})
        if (copyController) {
          copyController.name('Copied to clipboard ✓')
          setTimeout(() => copyController.name('Copy values'), 1200)
        }
      }
      copyController = folder.add({ copy: copyValues }, 'copy').name('Copy values')
    }

    const bathroomLightFolder = gui.addFolder('Bathroom bottle light')
    bathroomLightFolder
      .addColor(colorParams, 'bathroomBottleColor')
      .name('Color')
      .onChange((v) => bathroomBottleLight.color.set(v))
    bathroomLightFolder.add(bathroomBottleLight, 'intensity', 0, 10, 0.01).name('Intensity')
    bathroomLightFolder.add(bathroomBottleLight.position, 'x', -15, 15, 0.1).name('Position X')
    bathroomLightFolder.add(bathroomBottleLight.position, 'y', -15, 15, 0.1).name('Position Y')
    bathroomLightFolder.add(bathroomBottleLight.position, 'z', -15, 15, 0.1).name('Position Z')
    bathroomLightFolder.add(bathroomBottleLight.target.position, 'x', -15, 15, 0.1).name('Target X')
    bathroomLightFolder.add(bathroomBottleLight.target.position, 'y', -15, 15, 0.1).name('Target Y')
    bathroomLightFolder.add(bathroomBottleLight.target.position, 'z', -15, 15, 0.1).name('Target Z')
    bathroomLightFolder.add(bathroomBottleLightHelper, 'visible').name('Show helper')
    bathroomLightFolder.add(bathroomBottleLight, 'castShadow').name('Cast shadow')
    bathroomLightFolder.add(bathroomBottleLight.shadow, 'bias', -0.01, 0.01, 0.0001).name('Shadow bias')
    bathroomLightFolder.add(bathroomShadowMaterial, 'opacity', 0, 1, 0.01).name('Shadow opacity')
    bathroomLightFolder.add(bathroomShadowPlane, 'visible').name('Show shadow catcher')
    addCopyValuesButton(bathroomLightFolder, () => ({
      color: `#${bathroomBottleLight.color.getHexString()}`,
      intensity: bathroomBottleLight.intensity,
      position: {
        x: bathroomBottleLight.position.x,
        y: bathroomBottleLight.position.y,
        z: bathroomBottleLight.position.z,
      },
      target: {
        x: bathroomBottleLight.target.position.x,
        y: bathroomBottleLight.target.position.y,
        z: bathroomBottleLight.target.position.z,
      },
      castShadow: bathroomBottleLight.castShadow,
      shadowBias: bathroomBottleLight.shadow.bias,
      shadowOpacity: bathroomShadowMaterial.opacity,
    }))

    const washbasinLightFolder = gui.addFolder('Washbasin bottle light')
    washbasinLightFolder
      .addColor(colorParams, 'washbasinBottleColor')
      .name('Color')
      .onChange((v) => washbasinBottleLight.color.set(v))
    washbasinLightFolder.add(washbasinBottleLight, 'intensity', 0, 10, 0.01).name('Intensity')
    washbasinLightFolder.add(washbasinBottleLight.position, 'x', -15, 15, 0.1).name('Position X')
    washbasinLightFolder.add(washbasinBottleLight.position, 'y', -15, 15, 0.1).name('Position Y')
    washbasinLightFolder.add(washbasinBottleLight.position, 'z', -15, 15, 0.1).name('Position Z')
    washbasinLightFolder.add(washbasinBottleLight.target.position, 'x', -15, 15, 0.1).name('Target X')
    washbasinLightFolder.add(washbasinBottleLight.target.position, 'y', -15, 15, 0.1).name('Target Y')
    washbasinLightFolder.add(washbasinBottleLight.target.position, 'z', -15, 15, 0.1).name('Target Z')
    washbasinLightFolder.add(washbasinBottleLightHelper, 'visible').name('Show helper')
    washbasinLightFolder.add(washbasinBottleLight, 'castShadow').name('Cast shadow')
    washbasinLightFolder.add(washbasinBottleLight.shadow, 'bias', -0.01, 0.01, 0.0001).name('Shadow bias')
    washbasinLightFolder.add(washbasinShadowMaterial, 'opacity', 0, 1, 0.01).name('Shadow opacity')
    washbasinLightFolder.add(washbasinShadowPlane, 'visible').name('Show shadow catcher')
    addCopyValuesButton(washbasinLightFolder, () => ({
      color: `#${washbasinBottleLight.color.getHexString()}`,
      intensity: washbasinBottleLight.intensity,
      position: {
        x: washbasinBottleLight.position.x,
        y: washbasinBottleLight.position.y,
        z: washbasinBottleLight.position.z,
      },
      target: {
        x: washbasinBottleLight.target.position.x,
        y: washbasinBottleLight.target.position.y,
        z: washbasinBottleLight.target.position.z,
      },
      castShadow: washbasinBottleLight.castShadow,
      shadowBias: washbasinBottleLight.shadow.bias,
      shadowOpacity: washbasinShadowMaterial.opacity,
    }))

    const ambientLightFolder = gui.addFolder('Ambient light')
    ambientLightFolder
      .addColor(colorParams, 'ambientColor')
      .name('Color')
      .onChange((v) => ambientLight.color.set(v))
    ambientLightFolder.add(ambientLight, 'intensity', 0, 5, 0.01).name('Intensity')
    addCopyValuesButton(ambientLightFolder, () => ({
      color: `#${ambientLight.color.getHexString()}`,
      intensity: ambientLight.intensity,
    }))

    // --- Selective blur render pipeline (see shader block near the top of
    // this file for the full pass-by-pass explanation) ---
    const blurParams = {
      amount: 0,
      maxRadius: MAX_BLUR_RADIUS,
      featherRadius: DEFAULT_MASK_FEATHER_RADIUS,
      // Color wash over the blurred region only — see compositeFragmentShader.
      // strength 0 == tintColor has no effect at all (pure passthrough).
      tintColor: '#000000',
      tintStrength: 0,
    }

    const makeSelectiveBlurRenderTarget = (depthBuffer) =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer,
      })
    const sceneRT = makeSelectiveBlurRenderTarget(true) // needs its own depth buffer: it's a real 3D render
    const maskRT = makeSelectiveBlurRenderTarget(true) // same camera/geometry as sceneRT, so needs depth too
    const maskBlurredRT = makeSelectiveBlurRenderTarget(false) // feathered mask fed to the composite pass
    const blurRTA = makeSelectiveBlurRenderTarget(false) // shared ping-pong scratch target — see renderSelectiveBlur
    const blurRTB = makeSelectiveBlurRenderTarget(false)

    const resizeSelectiveBlurTargets = () => {
      const pixelRatio = renderer.getPixelRatio()
      const width = Math.max(1, Math.floor(container.clientWidth * pixelRatio))
      const height = Math.max(1, Math.floor(container.clientHeight * pixelRatio))
      sceneRT.setSize(width, height)
      maskRT.setSize(width, height)
      maskBlurredRT.setSize(width, height)
      blurRTA.setSize(width, height)
      blurRTB.setSize(width, height)
    }
    resizeSelectiveBlurTargets()

    const maskMaterial = new THREE.ShaderMaterial({
      vertexShader: maskVertexShader,
      fragmentShader: maskFragmentShader,
    })
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
    })
    const compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: selectiveBlurVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBlur: { value: null },
        tMask: { value: null },
        uTintColor: { value: new THREE.Color(blurParams.tintColor) },
        uTintStrength: { value: blurParams.tintStrength },
      },
    })

    // Shared full-screen quad every pass below reuses (swapping .material) —
    // an orthographic camera fixed at identity, the exact rig three.js's own
    // postprocessing FullScreenQuad helper uses for the same purpose (see
    // three/examples/jsm/postprocessing/Pass.js). Neither its transform nor
    // projection is actually read by selectiveBlurVertexShader (which writes
    // clip-space position directly) — it only needs to exist to satisfy
    // renderer.render()'s API.
    const fsScene = new THREE.Scene()
    const fsGeometry = new THREE.PlaneGeometry(2, 2)
    const fsMesh = new THREE.Mesh(fsGeometry, blurMaterial)
    fsScene.add(fsMesh)
    const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // Renders `scene` through activeCamera as usual, but with everything
    // except `sharpMeshes` blurred by blurParams.amount. Falls back to a
    // single plain render — the cheap path used whenever no bottle part is
    // revealed or mid-transition — once the amount has settled back to 0.
    const renderSelectiveBlur = (sharpMeshes) => {
      if (blurParams.amount <= 0.0001 || sharpMeshes.length === 0) {
        renderer.setRenderTarget(null)
        renderer.render(scene, activeCamera)
        return
      }

      renderer.setRenderTarget(sceneRT)
      renderer.render(scene, activeCamera)

      // Mask pass: hide every mesh except the revealed node's own, and swap
      // in maskMaterial (solid white) over a forced-black background so the
      // composite pass can read "white == keep sharp" unambiguously.
      const previousVisibility = []
      scene.traverse((child) => {
        if (!child.isMesh) return
        previousVisibility.push([child, child.visible])
        child.visible = sharpMeshes.includes(child)
      })
      const previousBackground = scene.background
      scene.background = null
      scene.overrideMaterial = maskMaterial
      renderer.setRenderTarget(maskRT)
      renderer.setClearColor(0x000000, 1)
      renderer.render(scene, activeCamera)
      scene.overrideMaterial = null
      scene.background = previousBackground
      previousVisibility.forEach(([child, visible]) => {
        child.visible = visible
      })

      fsMesh.material = blurMaterial

      // Feather the mask's sharp/blur boundary first — a separable Gaussian
      // pass at the (small, constant) feather radius, ping-ponged through
      // blurRTA -> maskBlurredRT. blurRTA is reused again as scratch space
      // for the background blur right below; that's safe because its
      // contents are fully consumed into maskBlurredRT before anything
      // renders into blurRTA again.
      blurMaterial.uniforms.tDiffuse.value = maskRT.texture
      blurMaterial.uniforms.uDirection.value.set(1 / maskRT.width, 0)
      blurMaterial.uniforms.uRadius.value = blurParams.featherRadius
      renderer.setRenderTarget(blurRTA)
      renderer.render(fsScene, fsCamera)

      blurMaterial.uniforms.tDiffuse.value = blurRTA.texture
      blurMaterial.uniforms.uDirection.value.set(0, 1 / maskRT.height)
      renderer.setRenderTarget(maskBlurredRT)
      renderer.render(fsScene, fsCamera)

      // Two-pass separable Gaussian on the background: horizontal sceneRT
      // -> blurRTA, then vertical blurRTA -> blurRTB.
      blurMaterial.uniforms.tDiffuse.value = sceneRT.texture
      blurMaterial.uniforms.uDirection.value.set(1 / sceneRT.width, 0)
      blurMaterial.uniforms.uRadius.value = blurParams.amount
      renderer.setRenderTarget(blurRTA)
      renderer.render(fsScene, fsCamera)

      blurMaterial.uniforms.tDiffuse.value = blurRTA.texture
      blurMaterial.uniforms.uDirection.value.set(0, 1 / sceneRT.height)
      renderer.setRenderTarget(blurRTB)
      renderer.render(fsScene, fsCamera)

      compositeMaterial.uniforms.tScene.value = sceneRT.texture
      compositeMaterial.uniforms.tBlur.value = blurRTB.texture
      compositeMaterial.uniforms.tMask.value = maskBlurredRT.texture
      compositeMaterial.uniforms.uTintColor.value.set(blurParams.tintColor)
      compositeMaterial.uniforms.uTintStrength.value = blurParams.tintStrength
      fsMesh.material = compositeMaterial
      renderer.setRenderTarget(null)
      renderer.render(fsScene, fsCamera)
    }

    const blurFolder = gui.addFolder('Selective Blur')
    blurFolder.add(blurParams, 'maxRadius', 0, 30, 0.5).name('Max blur radius')
    blurFolder.add(blurParams, 'featherRadius', 0, 15, 0.5).name('Mask edge feather')
    blurFolder.addColor(blurParams, 'tintColor').name('Tint color')
    blurFolder.add(blurParams, 'tintStrength', 0, 1, 0.01).name('Tint strength')
    addCopyValuesButton(blurFolder, () => ({
      maxRadius: blurParams.maxRadius,
      featherRadius: blurParams.featherRadius,
      tintColor: blurParams.tintColor,
      tintStrength: blurParams.tintStrength,
    }))

    // --- Click-to-reveal bottle interaction ---
    // Live-tweakable via the "Bottle Reveal" GUI folder below — plain values
    // (not module consts) specifically so the GUI sliders can mutate them and
    // have the very next click pick up the change.
    const revealParams = {
      distanceFromCamera: 5.28, // world units in front of the camera — used by bathroom_bottle.glb nodes
      // washbasin_bottle.glb nodes use this instead (see revealDistanceKey in
      // tagInteractiveMeshes / revealNode below) so the two models can be
      // tuned to different reveal distances independently.
      washbasinDistanceFromCamera: 3.5,
      duration: 1.2, // seconds
      // Keyed by node.name (e.g. "NEW_BASE009") — populated once both bottle
      // glTFs load (see tagInteractiveMeshes below), one entry per flyable
      // node, seeded from SPIN_DEGREES_OVERRIDES/DEFAULT_SPIN_DEGREES, each
      // independently GUI-tweakable via its own "Per-mesh spin degrees"
      // slider. Any real number of degrees works, not just multiples of
      // 360 — see the whole/fractional-turn split in revealNode, which
      // keeps the node's final landing angle exact regardless. There is
      // deliberately no shared "default spin" control — see
      // DEFAULT_SPIN_DEGREES above for why.
      spinDegreesByNode: {},
      // Same per-node/GUI-tweakable shape as spinDegreesByNode, but this one
      // DOES change where the node ends up — see DEFAULT_FINAL_ROTATION_DEGREES
      // above and how it's applied to targetQuaternion in revealNode.
      finalRotationByNode: {},
    }

    // Re-runs revealNode() for currently-revealed nodes matching `predicate`
    // — used to make GUI tweaks reflect live on a bottle that's already been
    // clicked, WITHOUT re-triggering nodes the tweak doesn't actually apply
    // to (e.g. changing one mesh's own spin slider must never touch any
    // other mesh, and changing the bathroom distance must never touch
    // washbasin nodes). Deliberately wired to each control's
    // `onFinishChange` (fires once, when the drag/input actually ends) —
    // NOT `onChange` (fires continuously on every drag tick), because
    // calling revealNode() mid-drag kills and restarts the in-flight tween
    // on every single tick, which never lets the animation actually
    // progress — it looked like the reveal was "stuck" or ignoring the
    // dragged-to value, when it was really just being restarted from
    // near-zero dozens of times per second.
    const retargetNodesIf = (predicate) => {
      revealNodes.forEach((node) => {
        if (node.userData.isRevealed && predicate(node)) revealNode(node)
      })
    }
    const isBathroomNode = (node) => !node.userData.revealDistanceKey
    const isWashbasinNode = (node) => node.userData.revealDistanceKey === 'washbasinDistanceFromCamera'

    const revealFolder = gui.addFolder('Bottle Reveal')
    revealFolder
      .add(revealParams, 'distanceFromCamera', 0.5, 8, 0.1)
      .name('Bathroom distance from camera')
      .onFinishChange(() => retargetNodesIf(isBathroomNode))
    revealFolder
      .add(revealParams, 'washbasinDistanceFromCamera', 0.5, 8, 0.1)
      .name('Washbasin distance from camera')
      .onFinishChange(() => retargetNodesIf(isWashbasinNode))
    // Doesn't need a retarget — it only changes how FAST future reveals
    // play, never the target pose, so there's nothing for an already-resting
    // bottle to visibly update.
    revealFolder.add(revealParams, 'duration', 0.2, 3, 0.05).name('Duration (s)')
    addCopyValuesButton(revealFolder, () => ({ ...revealParams }))

    // `interactiveMeshes` (populated once both bottle glTFs load — see
    // tagInteractiveMeshes in the Promise.all `.then()` below) is what
    // hover/click actually raycast against. Reused across every pointer
    // event instead of allocated per-event.
    const raycaster = new THREE.Raycaster()
    const pointerNDC = new THREE.Vector2()
    const WORLD_UP = new THREE.Vector3(0, 1, 0)

    const pointerToNDC = (event, target) => {
      const rect = renderer.domElement.getBoundingClientRect()
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      target.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      return target
    }

    // Flies ONE clicked node — a single NEW_BASE0XX group (e.g. NEW_BASE014),
    // not the whole bottle — to a fixed distance in front of whichever camera
    // is currently active, presenting it at a consistent viewing angle no
    // matter where that camera is. The distance itself is looked up per node
    // via `revealDistanceKey` (set in tagInteractiveMeshes below: bathroom
    // nodes use revealParams.distanceFromCamera, washbasin nodes use
    // revealParams.washbasinDistanceFromCamera), so the two models can sit at
    // different reveal distances — see the per-node `revealRelativeQuaternion`
    // captured after load below for the consistent-angle part.
    //
    // Correctness: the camera pose is read in WORLD space (getWorldPosition/
    // getWorldQuaternion), and the node is a deep child of a glTF scene root
    // that may carry its own transform, so the world-space target is converted
    // into the node's PARENT-LOCAL space (worldToLocal + parent-quaternion
    // inverse) before being written to node.position/node.quaternion. Writing
    // a world target straight into a child's local transform — which the old
    // code did — is only right when every ancestor is at identity.
    //
    // Position lerps and rotation slerps under one shared power3.inOut-eased
    // GSAP tween, driven by two plain numeric properties GSAP animates
    // directly — `t` (0 -> 1, position lerp + arrival slerp progress) and
    // `spinDegrees` (0 -> the node's own spin amount, in DEGREES, straight
    // from revealParams.spinDegreesByNode — no turns/conversion involved) —
    // so both stay perfectly in sync under the same ease with no manual
    // per-frame angle math for the spin.
    //
    // A decorative spin about world-up is layered on top of the arrival
    // slerp via `.premultiply()`. The degree value can be anything (e.g.
    // 170°) — only a WHOLE multiple of 360° is rotationally a no-op though,
    // so a bare non-multiple-of-360 spin would land the node rotated away
    // from its intended target angle. Fixed the same way as the
    // distance/position math above: split the spin into its whole-360°-turns
    // part (cancels itself out naturally) and its leftover remainder,
    // pre-baked as an equal-and-opposite counter-rotation into the
    // quaternion the SLERP itself arrives at (`adjustedTargetQuaternion`).
    // Same-axis quaternion rotations compose by simply adding their angles,
    // so the spin contributed during the flourish and this pre-baked
    // counter-rotation cancel EXACTLY at t=1 regardless of the degree value
    // (verified numerically, not just algebraically — arbitrary
    // start/target orientations, spin amounts up to 1343°, landing error
    // consistently ~0 to within float precision). Note the trade-off: the
    // closer the remainder sits to 180° (i.e. the degree value sits near a
    // half-turn past a multiple of 360, e.g. 170°, 200°), the more this
    // pre-tilts the slerp's own target away from the true target, so the
    // arrival path itself bends more too — that's an inherent cost of an
    // arbitrary, non-360-aligned spin amount, not a bug.
    //
    // The spin amount is looked up per node
    // (revealParams.spinDegreesByNode[node.name], seeded from
    // SPIN_DEGREES_OVERRIDES/DEFAULT_SPIN_DEGREES at tag time — see
    // tagInteractiveMeshes below), since different meshes read best with
    // different amounts and each has its own "Per-mesh spin degrees" GUI
    // slider. Scale is never touched.
    const _forward = new THREE.Vector3()
    const revealNode = (node) => {
      const relativeQuaternion = node.userData.revealRelativeQuaternion
      if (!relativeQuaternion) return // clicked before load-time capture finished for this node

      const parent = node.parent
      parent.updateWorldMatrix(true, false)
      const parentWorldQuatInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert()

      // Active camera pose, in world space.
      const camWorldPos = activeCamera.getWorldPosition(new THREE.Vector3())
      const camWorldQuat = activeCamera.getWorldQuaternion(new THREE.Quaternion())
      _forward.set(0, 0, -1).applyQuaternion(camWorldQuat)

      const distanceFromCamera = revealParams[node.userData.revealDistanceKey ?? 'distanceFromCamera']
      const worldTargetPos = camWorldPos.addScaledVector(_forward, distanceFromCamera)
      const worldTargetQuat = camWorldQuat.clone().multiply(relativeQuaternion)

      // Convert the world-space target into the node's parent-local space.
      const targetPosition = parent.worldToLocal(worldTargetPos.clone())
      const targetQuaternion = parentWorldQuatInv.clone().multiply(worldTargetQuat)

      // World-up expressed in parent-local space, so the decorative spin reads
      // as an upright turntable spin regardless of the parent's orientation.
      const localSpinAxis = WORLD_UP.clone().applyQuaternion(parentWorldQuatInv).normalize()

      // Twists the FINAL landing pose itself, about the same axis as the
      // spin flourish — applied directly to targetQuaternion (before the
      // spin's own fractional-correction math below), so everything
      // downstream (the arrival slerp AND the spin's exact-landing
      // guarantee) automatically targets this adjusted angle instead of the
      // raw camera-consistent one. 0 (the default) leaves the original
      // angle untouched.
      const finalRotationDegrees = revealParams.finalRotationByNode[node.name] ?? DEFAULT_FINAL_ROTATION_DEGREES
      if (finalRotationDegrees !== 0) {
        const finalRotationOffset = new THREE.Quaternion().setFromAxisAngle(
          localSpinAxis,
          THREE.MathUtils.degToRad(finalRotationDegrees),
        )
        targetQuaternion.premultiply(finalRotationOffset)
      }

      const spinDegrees = revealParams.spinDegreesByNode[node.name] ?? DEFAULT_SPIN_DEGREES
      const spinTurns = spinDegrees / 360
      const fractionalSpinTurns = spinTurns - Math.trunc(spinTurns)
      const fractionalCorrection = new THREE.Quaternion().setFromAxisAngle(
        localSpinAxis,
        -fractionalSpinTurns * Math.PI * 2,
      )
      const adjustedTargetQuaternion = fractionalCorrection.multiply(targetQuaternion)

      const startPosition = node.position.clone()
      const startQuaternion = node.quaternion.clone()

      node.userData.revealTween?.kill() // retarget smoothly if already mid-reveal instead of fighting the old tween
      node.userData.isRevealed = true // lets retargetNodesIf() find this node when a GUI slider changes later
      activeRevealedNode = node // blocks hover/click on every other node until this one fully returns — see getInteractiveTargets AND handleClick's "click anywhere sends it back" check
      lenis.stop() // no page scroll while a bottle is mid-flight/revealed — resumed once returnNode() fully completes below
      lockPageScroll() // belt-and-braces: also blocks native keyboard/scrollbar scroll — see lockPageScroll's docblock above
      setIsRevealed(true) // fades the product overlay in alongside the flight

      const spinQuaternion = new THREE.Quaternion()
      // `blur` rides the same tween/ease as the flight itself (start value
      // is whatever blurParams.amount currently is, in case a fresh reveal
      // interrupts an in-flight return) so the rest of the scene blurs in
      // at exactly the pace the clicked node flies toward the camera — see
      // the "Selective blur" shader block near the top of this file.
      const anim = { t: 0, spinDegrees: 0, blur: blurParams.amount }
      node.userData.revealTween = gsap.to(anim, {
        t: 1,
        spinDegrees,
        blur: blurParams.maxRadius,
        duration: revealParams.duration,
        ease: 'power3.inOut',
        onUpdate: () => {
          node.position.lerpVectors(startPosition, targetPosition, anim.t)
          node.quaternion.slerpQuaternions(startQuaternion, adjustedTargetQuaternion, anim.t)
          spinQuaternion.setFromAxisAngle(localSpinAxis, THREE.MathUtils.degToRad(anim.spinDegrees))
          node.quaternion.premultiply(spinQuaternion)
          blurParams.amount = anim.blur
        },
        onComplete: () => {
          node.userData.revealTween = null
        },
      })
    }

    // Flies an already-revealed node back to its authored resting
    // position/orientation — the position/rotation counterpart of
    // revealNode(), including the same spin flourish (same per-node
    // spinDegreesByNode amount and the same exact-landing whole/fractional-
    // turn correction — see revealNode's docblock for how/why that works).
    // `restPosition`/`restQuaternion` are captured once per node in
    // tagInteractiveMeshes, before any reveal has ever touched it, so this
    // always returns to the true original pose regardless of how many
    // times the node has been revealed/returned since.
    const returnNode = (node) => {
      const restPosition = node.userData.restPosition
      const restQuaternion = node.userData.restQuaternion
      if (!restPosition || !restQuaternion) return // clicked before load-time capture finished for this node

      const parent = node.parent
      parent.updateWorldMatrix(true, false)
      const parentWorldQuatInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert()
      const localSpinAxis = WORLD_UP.clone().applyQuaternion(parentWorldQuatInv).normalize()

      const spinDegrees = revealParams.spinDegreesByNode[node.name] ?? DEFAULT_SPIN_DEGREES
      const spinTurns = spinDegrees / 360
      const fractionalSpinTurns = spinTurns - Math.trunc(spinTurns)
      const fractionalCorrection = new THREE.Quaternion().setFromAxisAngle(
        localSpinAxis,
        -fractionalSpinTurns * Math.PI * 2,
      )
      const adjustedRestQuaternion = fractionalCorrection.multiply(restQuaternion)

      const startPosition = node.position.clone()
      const startQuaternion = node.quaternion.clone()

      node.userData.revealTween?.kill() // retarget smoothly if already mid-flight instead of fighting the old tween
      // Set immediately (not on complete) so a click while it's still
      // mid-return is treated as "not revealed" and flies it back toward
      // the camera again instead of trying to return it a second time.
      node.userData.isRevealed = false
      setIsRevealed(false) // fades the product overlay out alongside the flight back

      const spinQuaternion = new THREE.Quaternion()
      // Mirrors revealNode's blur wiring, tweening back down to 0 — see
      // that docblock and the "Selective blur" shader block near the top of
      // this file.
      const anim = { t: 0, spinDegrees: 0, blur: blurParams.amount }
      node.userData.revealTween = gsap.to(anim, {
        t: 1,
        spinDegrees,
        blur: 0,
        duration: revealParams.duration,
        ease: 'power3.inOut',
        onUpdate: () => {
          node.position.lerpVectors(startPosition, restPosition, anim.t)
          node.quaternion.slerpQuaternions(startQuaternion, adjustedRestQuaternion, anim.t)
          spinQuaternion.setFromAxisAngle(localSpinAxis, THREE.MathUtils.degToRad(anim.spinDegrees))
          node.quaternion.premultiply(spinQuaternion)
          blurParams.amount = anim.blur
        },
        onComplete: () => {
          node.userData.revealTween = null
          // Only release the "other nodes are blocked" lock (and resume
          // scrolling) if nothing else (e.g. a fresh revealNode() call from
          // clicking this same node again mid-return) has already claimed
          // activeRevealedNode since this return started.
          if (activeRevealedNode === node) {
            activeRevealedNode = null
            lenis.start()
            unlockPageScroll()
          }
        },
      })
    }

    // While a node is flying toward the camera, resting revealed, or flying
    // back, every OTHER node is excluded from raycasting entirely — so only
    // one bottle part can ever be mid-interaction at a time. The active
    // node itself stays targetable (clicking it again is what sends it
    // back).
    const getInteractiveTargets = () => {
      if (!activeRevealedNode) return interactiveMeshes
      return interactiveMeshes.filter((mesh) => mesh.userData.revealNode === activeRevealedNode)
    }

    const handlePointerMove = (event) => {
      if (!interactiveMeshes.length) return
      raycaster.setFromCamera(pointerToNDC(event, pointerNDC), activeCamera)
      const hit = raycaster.intersectObjects(getInteractiveTargets(), false)
      renderer.domElement.style.cursor = hit.length ? 'pointer' : ''
    }

    // Clicking a not-yet-revealed node flies it toward the camera. Once ANY
    // node is out — still flying toward the camera, or already resting
    // (blurred background and all) — a click ANYWHERE, not just one that
    // actually hits that node, sends it back: with the background blurred
    // out, precisely re-hitting a moving (or small, backgrounded) bottle
    // isn't the point; "click while something's revealed" IS the cue to
    // put it back. activeRevealedNode stays set for this whole span (flying
    // in, resting, and even while flying back out) — see revealNode/
    // returnNode and the getInteractiveTargets lock above.
    const handleClick = (event) => {
      if (!interactiveMeshes.length) return
      if (activeRevealedNode) {
        returnNode(activeRevealedNode)
        return
      }
      raycaster.setFromCamera(pointerToNDC(event, pointerNDC), activeCamera)
      const [hit] = raycaster.intersectObjects(getInteractiveTargets(), false)
      if (!hit) return
      const node = hit.object.userData.revealNode
      if (!node) return
      revealNode(node)
    }

    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('click', handleClick)

    // --- Loaders: Draco geometry + KTX2 (basisu) texture, shared across both loads ---
    const dracoLoader = new DRACOLoader()

    const ktx2Loader = new KTX2Loader()
    ktx2Loader.detectSupport(renderer)

    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)
    gltfLoader.setKTX2Loader(ktx2Loader)

    let roomModel = null
    let roomTexture = null
    let bottleModel = null
    let interactiveMeshes = [] // raycast targets; populated once both bottle glTFs load — see tagInteractiveMeshes below
    const revealNodes = [] // unique NEW_BASE0XX node groups, each independently click-flyable
    // Whichever node is currently flying toward the camera, resting revealed,
    // or flying back — set in revealNode(), cleared only once returnNode()
    // fully completes (see below). While set, hover/click on every OTHER
    // node is ignored — see getInteractiveTargets — so only one bottle part
    // can ever be mid-interaction at a time.
    let activeRevealedNode = null
    let spinDegreesFolder = null // "Per-mesh spin degrees" GUI folder; created once node names are known — see tagInteractiveMeshes below
    let finalRotationFolder = null // "Per-mesh final rotation" GUI folder; created once node names are known — see tagInteractiveMeshes below
    let cameraRig = null
    let mixer = null
    let cameraOneObj = null
    let cameraTwoObj = null
    let cameraOneAction = null
    let cameraTwoAction = null
    let cameraOneDuration = 0
    let cameraTwoDuration = 0
    // Camera.glb's authored clips don't quite meet: clip two's first keyframe
    // sits a fraction of a unit away from clip one's last keyframe. Measured
    // once (right after both clips load, see below) and subtracted from
    // camera two every frame so the cut between the two cameras is
    // mathematically seamless instead of "close enough".
    const cameraTwoHandoffOffset = new THREE.Vector3()

    // Which authored camera is currently on screen. Guarded by a small
    // hysteresis band (see CAMERA_HANDOFF_HYSTERESIS) around the clip-one /
    // clip-two boundary — without it, a scroll velocity that hovers right at
    // that exact point (the lerp catching up from one side while the user's
    // raw scroll nudges the other way) can flip the render camera back and
    // forth several times in a row, which is exactly the "laggy" stutter
    // reported specifically at the second camera's entrance.
    let activeSegment = 1

    // Scrubs the two authored clips end-to-end across scroll progress [0, 1]:
    // clip one owns progress until its own duration is used up, then clip
    // two takes over (and the render camera swaps to match) for the rest.
    // Both actions' local time is kept in sync every frame — not just
    // whichever one is "active" — so re-crossing the boundary in either
    // direction always resumes from the exact right pose, never a stale one.
    const applyScrollProgress = (progress) => {
      if (!mixer || !cameraOneAction || !cameraTwoAction) return

      const totalDuration = cameraOneDuration + cameraTwoDuration
      if (totalDuration <= 0) return
      const t = progress * totalDuration

      cameraOneAction.time = THREE.MathUtils.clamp(t, 0, cameraOneDuration)
      cameraTwoAction.time = THREE.MathUtils.clamp(t - cameraOneDuration, 0, cameraTwoDuration)
      mixer.update(0)
      cameraTwoObj.position.add(cameraTwoHandoffOffset)

      if (activeSegment === 1 && t > cameraOneDuration + CAMERA_HANDOFF_HYSTERESIS) {
        activeSegment = 2
      } else if (activeSegment === 2 && t < cameraOneDuration - CAMERA_HANDOFF_HYSTERESIS) {
        activeSegment = 1
      }
      activeCamera = activeSegment === 1 ? cameraOneObj : cameraTwoObj
    }

    // Neither Lenis nor ScrollTrigger suppress the BROWSER's own native
    // rubber-band/overscroll bounce at the top/bottom of the page (index.css
    // sets no `overscroll-behavior` anywhere) — Lenis only owns the virtual
    // scroll VALUE, not that native elastic animation. Since the canvas is
    // pinned with `position: fixed`, that native bounce visibly drags the
    // whole view (and the camera with it) once the pinned section's scroll
    // range is exhausted — independent of Lenis/mixer timing entirely, so no
    // amount of easing tuning fixes it. Suppress it while this page is
    // mounted, restore whatever was there on unmount.
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior
    const prevBodyOverscroll = document.body.style.overscrollBehavior
    document.documentElement.style.overscrollBehavior = 'none'
    document.body.style.overscrollBehavior = 'none'

    // --- Hard scroll lock while a bottle is revealed ---
    // lenis.stop() (called from revealNode below) already blocks wheel/touch
    // input from moving Lenis's own virtual scroll, but it does NOT stop the
    // BROWSER's native scroll from keyboard input (Space/PageDown/arrows) or
    // a scrollbar drag — and Lenis's onNativeScroll handler resyncs its
    // animatedScroll to whatever the native scrollY becomes regardless of
    // isStopped, so a keyboard/scrollbar scroll while "stopped" still moves
    // ScrollTrigger's progress and the camera along with it. Locking
    // body.style.overflow additionally blocks every one of those native
    // scroll paths at the browser level. bodyOverflowBeforeLock guards
    // against a nested/duplicate lock (e.g. retargetNodesIf() re-running
    // revealNode() on an already-revealed node from a GUI tweak) clobbering
    // the real pre-lock value with 'hidden'.
    // Locking ONLY body.style.overflow is not enough: browsers propagate
    // body's overflow to the viewport ONLY while it's the initial 'visible'
    // — set it to 'hidden' and that propagation stops, so documentElement's
    // OWN overflow (still 'visible' by default; index.css only sets
    // overflow-x) takes over as the actual scrolling box and the page keeps
    // scrolling. Lock both.
    let bodyOverflowBeforeLock = null
    let htmlOverflowBeforeLock = null
    // This page mounts several OTHER sections (SceneV2's swing carousel,
    // IntroHero, CloudTransition) that each install their own window-level
    // 'wheel'/'touchmove'/'keydown' listeners to drive their own scroll-
    // linked animation, entirely independent of Lenis and of this reveal
    // lock — so overflow:hidden + lenis.stop() alone (which only stop the
    // PAGE from actually scrolling) still let those OTHER listeners react to
    // the same input and animate their own scene while a bottle is popped
    // up. `inputLocked` gates a capture-phase blocker below that preempts
    // ALL of them — same pattern CloudTransition.jsx already uses for its
    // own forward-wipe lock (capture + stopImmediatePropagation runs before
    // every bubble-phase listener, including Lenis's and the carousel's).
    let inputLocked = false
    const lockPageScroll = () => {
      if (bodyOverflowBeforeLock !== null) return
      bodyOverflowBeforeLock = document.body.style.overflow
      htmlOverflowBeforeLock = document.documentElement.style.overflow
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      inputLocked = true
    }
    const unlockPageScroll = () => {
      if (bodyOverflowBeforeLock === null) return
      document.body.style.overflow = bodyOverflowBeforeLock
      document.documentElement.style.overflow = htmlOverflowBeforeLock
      bodyOverflowBeforeLock = null
      htmlOverflowBeforeLock = null
      inputLocked = false
    }
    const blockScrollInput = (event) => {
      if (!inputLocked) return
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    const blockScrollKeydown = (event) => {
      if (!inputLocked) return
      // Never swallow keyboard interaction with the overlay's OWN controls
      // (e.g. Space/Enter activating the "Buy Now" button in ProductDetailsV2,
      // which is the one thing inside this lock that's meant to stay usable).
      const target = event.target
      if (target && (target.isContentEditable || /^(input|textarea|select|button|a)$/i.test(target.tagName))) {
        return
      }
      if (
        [' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(
          event.key,
        )
      ) {
        event.preventDefault()
      }
      event.stopImmediatePropagation()
    }
    window.addEventListener('wheel', blockScrollInput, { capture: true, passive: false })
    window.addEventListener('touchmove', blockScrollInput, { capture: true, passive: false })
    window.addEventListener('keydown', blockScrollKeydown, { capture: true })

    // --- Lenis: smooth, inertia-based scrolling ---
    // `ownsLenis` is false when a parent page (HomeV2Page) already provided
    // a root Lenis instance via context (see contextLenis above) — reusing
    // that ONE instance instead of creating a second is what keeps this
    // component safe to embed inside an already-Lenis-driven page, since two
    // independent Lenis instances would both try to own window scroll and
    // fight each other. Only the route that mounts Product standalone
    // (/product, no <ReactLenis> ancestor) actually owns/creates/destroys
    // its own instance here, same as before.
    //
    // Deliberately lerp-based, not duration-based: `duration` mode restarts
    // a full fixed-length tween on EVERY wheel tick, so the very last tick's
    // tween keeps playing out (up to `duration` seconds) after the user has
    // already stopped scrolling — the camera "drifting on its own," most
    // noticeable right at the end where nothing else is moving to mask it.
    // `lerp` instead continuously decays toward the live target every frame,
    // so it settles almost immediately once input actually stops.
    const ownsLenis = !contextLenis
    const lenis = contextLenis ?? new Lenis({
      lerp: 0.1,
      smoothWheel: true,
    })
    let tickLenis
    if (ownsLenis) {
      // Lenis drives scroll via its own rAF loop rather than native 'scroll'
      // events firing at the browser's pace, so ScrollTrigger needs an
      // explicit nudge to re-measure the pin/progress on every Lenis tick.
      // When reusing a parent-provided instance, the parent page already
      // does this (see HomeV2Page's own `useLenis(() => ScrollTrigger.update())`).
      lenis.on('scroll', ScrollTrigger.update)
      tickLenis = (time) => lenis.raf(time * 1000)
      gsap.ticker.add(tickLenis)
      gsap.ticker.lagSmoothing(0) // Lenis already owns catch-up smoothing; GSAP's own lag correction would fight it
    }

    // Camera pose is driven DIRECTLY and ONLY from this callback — no extra
    // per-frame lerp/easing layer on top. Lenis already supplies the smooth,
    // inertia-based scroll feel (self.progress here reflects Lenis's already-
    // damped scroll position); a second independent easing stage on top of
    // that meant the camera's displayed pose could lag behind — or keep
    // "catching up" to — the actual current scroll position, which is what
    // read as the camera moving under its own power instead of strictly
    // following the authored path. This way the camera is ALWAYS at exactly
    // the point on the path that the current scroll position maps to, full
    // stop — it changes only when this callback fires, never on its own.
    const scrollTriggerInstance = ScrollTrigger.create({
      trigger: container,
      start: 'top top',
      end: () => `+=${window.innerHeight * (SCROLL_LENGTH_VH / 100)}`,
      pin: true,
      onUpdate: (self) => {
        applyScrollProgress(THREE.MathUtils.clamp(self.progress, 0, 1))
      },
    })

    Promise.all([
      gltfLoader.loadAsync(MODEL_URL),
      ktx2Loader.loadAsync(TEXTURE_URL),
      gltfLoader.loadAsync(CAMERA_MODEL_URL),
      gltfLoader.loadAsync(BATHROOM_BOTTLE_MODEL_URL),
      gltfLoader.loadAsync(WASHBASIN_BOTTLE_MODEL_URL),
    ])
      .then(([roomGltf, texture, cameraGltf, bathroomBottleGltf, washbasinBottleGltf]) => {
        if (disposed) return // component unmounted before load finished

        // glTF UVs assume flipY = false; base color maps are sRGB.
        texture.flipY = false
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texture.needsUpdate = true
        roomTexture = texture

        roomModel = roomGltf.scene
        roomModel.traverse((child) => {
          if (!child.isMesh) return
          child.material?.dispose() // drop the original imported material
          child.material = new THREE.MeshBasicMaterial({ map: texture })
        })
        scene.add(roomModel)

        // --- Bottles: GLTFLoader already built maps/colors/roughness from each
        // file's own materials (+ embedded KTX2 textures) — reuse those texture
        // objects (already correctly flipY/colorSpace-configured by the loader
        // itself, unlike the room's manually-loaded texture above) on a plain
        // MeshStandardMaterial per spec, dropping any clearcoat upgrade.
        // Both bottle scenes are grouped under one Object3D so the rest of the
        // file (scene.add / disposal traversal) keeps treating "the bottle" as
        // a single object.
        const rebuildStandardMaterial = (root) => {
          root.traverse((child) => {
            if (!child.isMesh) return
            const original = child.material
            child.material = new THREE.MeshStandardMaterial({
              map: original.map ?? null,
              normalMap: original.normalMap ?? null,
              color: original.color ? original.color.clone() : new THREE.Color(0xffffff),
              roughness: original.roughness ?? 1,
              metalness: original.metalness ?? 0,
              transparent: original.transparent,
              opacity: original.opacity,
              alphaTest: original.alphaTest,
              side: original.side,
            })
            child.castShadow = true
            child.receiveShadow = true
            original.dispose() // drop the physical/standard material the loader built (maps are reused above, not disposed)
          })
        }

        const bathroomBottleModel = bathroomBottleGltf.scene
        rebuildStandardMaterial(bathroomBottleModel)

        const washbasinBottleModel = washbasinBottleGltf.scene
        rebuildStandardMaterial(washbasinBottleModel)

        bottleModel = new THREE.Group()
        bottleModel.name = 'Bottles'
        bottleModel.add(bathroomBottleModel, washbasinBottleModel)
        scene.add(bottleModel)

        // Resolves each raycast-able mesh to the single NEW_BASE0XX node it
        // belongs to and records that node on the mesh (userData.revealNode),
        // so a click on ANY primitive of a node flies exactly that one node —
        // not the whole bottle. Because each glTF mesh has 5 primitives, the
        // meshes are "Plane…"-named children of a NEW_BASE node Group (see
        // INTERACTIVE_MESH_NAME_PREFIX); eligibility/identity is therefore
        // found by walking each mesh's ANCESTORS (up to but not past `root`)
        // for a NEW_BASE-prefixed name — checking both the sanitized runtime
        // name ("NEW_BASE009") and GLTFLoader's preserved original
        // (`userData.name` = "NEW_BASE.009"). Populates the shared
        // `interactiveMeshes` (raycast targets) and `revealNodes` (unique
        // flyable node groups) arrays.
        const hasInteractivePrefix = (obj) =>
          obj.name?.startsWith(INTERACTIVE_MESH_NAME_PREFIX) ||
          obj.userData?.name?.startsWith(INTERACTIVE_MESH_NAME_PREFIX)

        const findInteractiveNode = (mesh, root) => {
          let node = mesh
          while (node && node !== root.parent) {
            if (hasInteractivePrefix(node)) return node
            node = node.parent
          }
          return null
        }

        // `revealDistanceKey` names which revealParams property revealNode()
        // should read for this node's reveal distance — lets the two models
        // be tuned to different distances independently (see revealParams /
        // the "Bottle Reveal" GUI folder above). `undefined` for bathroom
        // nodes falls back to revealParams.distanceFromCamera in revealNode.
        // Also seeds this node's own entries in revealParams.spinDegreesByNode
        // and revealParams.finalRotationByNode — from the *_OVERRIDES tables
        // if this node has a hand-tuned value, otherwise from the defaults —
        // so both are independent, GUI-tweakable from the moment it loads.
        const tagInteractiveMeshes = (root, revealDistanceKey) => {
          root.traverse((child) => {
            if (!child.isMesh) return
            const node = findInteractiveNode(child, root)
            if (!node) return
            child.userData.revealNode = node
            interactiveMeshes.push(child)
            if (!revealNodes.includes(node)) {
              revealNodes.push(node)
              node.userData.revealDistanceKey = revealDistanceKey
              revealParams.spinDegreesByNode[node.name] = SPIN_DEGREES_OVERRIDES[node.name] ?? DEFAULT_SPIN_DEGREES
              revealParams.finalRotationByNode[node.name] =
                FINAL_ROTATION_OVERRIDES[node.name] ?? DEFAULT_FINAL_ROTATION_DEGREES
              // Authored resting pose, captured now (before this node has
              // ever been revealed) so returnNode() always has the true
              // original to animate back to.
              node.userData.restPosition = node.position.clone()
              node.userData.restQuaternion = node.quaternion.clone()
            }
          })
        }
        tagInteractiveMeshes(bathroomBottleModel)
        tagInteractiveMeshes(washbasinBottleModel, 'washbasinDistanceFromCamera')

        // One independent "spin degrees" slider per flyable node, added only
        // now that node names are actually known (glTFs just finished
        // loading) — labeled with which bottle each belongs to since
        // NEW_BASE numbering isn't unique-looking across the two models at a
        // glance (it IS unique in practice — bathroom uses .009/.011/.014/
        // .016/.018, washbasin uses .001/.003/.005/.007 — but the label
        // still helps at a glance).
        //
        // Each slider's onFinishChange retargets ONLY its own node — never
        // any other mesh's reveal — and only once (on release), not
        // continuously mid-drag; see retargetNodesIf above for why. Range
        // covers a few full turns (0-1440°) with a 1° step, since exact
        // degree amounts (e.g. 170°) are the whole point of this control.
        spinDegreesFolder = revealFolder.addFolder('Per-mesh spin degrees')
        revealNodes.forEach((node) => {
          const bottleLabel = node.userData.revealDistanceKey ? 'Washbasin' : 'Bathroom'
          spinDegreesFolder
            .add(revealParams.spinDegreesByNode, node.name, 0, 1440, 1)
            .name(`${bottleLabel} ${node.name}`)
            .onFinishChange(() => retargetNodesIf((n) => n === node))
        })

        // Same pattern as spinDegreesFolder above, but this controls the
        // FINAL landing angle (see FINAL_ROTATION_OVERRIDES /
        // DEFAULT_FINAL_ROTATION_DEGREES / targetQuaternion in revealNode) —
        // -180 to 180 since it's a twist around the presented angle, not a
        // multi-turn spin amount.
        finalRotationFolder = revealFolder.addFolder('Per-mesh final rotation')
        revealNodes.forEach((node) => {
          const bottleLabel = node.userData.revealDistanceKey ? 'Washbasin' : 'Bathroom'
          finalRotationFolder
            .add(revealParams.finalRotationByNode, node.name, -180, 180, 1)
            .name(`${bottleLabel} ${node.name}`)
            .onFinishChange(() => retargetNodesIf((n) => n === node))
        })

        // Re-fits each light's shadow-camera frustum and its shadow-catcher
        // plane to the bottle's real bounding box (world space, after being
        // parented under bottleModel above), instead of the -1..1 placeholder
        // set at light-creation time. `autoAimTarget` (default true) would
        // also re-aim the light's target at that bounding-box center, but
        // both bottle lights already have hand-tuned targets (see their
        // creation above), so both calls below pass `autoAimTarget: false`
        // to keep this load-time fit from clobbering those tuned values.
        const fitBottleShadow = (bottleObject, light, shadowPlane, { autoAimTarget = true } = {}) => {
          const box = new THREE.Box3().setFromObject(bottleObject)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())

          if (autoAimTarget) {
            light.target.position.copy(center)
          }
          light.target.updateMatrixWorld()

          const halfExtent = Math.max(size.x, size.y, size.z) * 1.5 || 1
          light.shadow.camera.left = -halfExtent
          light.shadow.camera.right = halfExtent
          light.shadow.camera.top = halfExtent
          light.shadow.camera.bottom = -halfExtent
          light.shadow.camera.far = halfExtent * 6
          light.shadow.camera.updateProjectionMatrix()

          // Plane footprint with margin so the shadow doesn't clip at the bottle's edges.
          const footprint = Math.max(size.x, size.z) * 2.5 || 1
          shadowPlane.scale.set(footprint, footprint, 1)
          shadowPlane.position.set(center.x, box.min.y + 0.002, center.z)
        }

        fitBottleShadow(bathroomBottleModel, bathroomBottleLight, bathroomShadowPlane, { autoAimTarget: false })
        bathroomBottleLightHelper.update()

        fitBottleShadow(washbasinBottleModel, washbasinBottleLight, washbasinShadowPlane, { autoAimTarget: false })
        washbasinBottleLightHelper.update()

        // Reflect the computed target positions in the GUI sliders (they were
        // bound before these centers were known).
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay())

        // --- Camera rig: the two authored cameras, by glTF cameras[] index (see note above) ---
        cameraRig = cameraGltf.scene
        scene.add(cameraRig)
        cameraOneObj = cameraGltf.cameras[0] ?? null
        cameraTwoObj = cameraGltf.cameras[1] ?? null

        if (!cameraOneObj || !cameraTwoObj) {
          console.error('[Product] Camera.glb is missing an expected camera')
          return
        }

        // Captures, per flyable node, the fixed WORLD-space orientation of
        // that node relative to cameraOneObj's authored bind pose (measured
        // now, before any scroll-driven animation is applied to the camera
        // below). revealNode() reapplies it against whichever camera is active
        // at click time (worldTargetQuat = camWorldQuat * relativeQuaternion),
        // so each node always presents the exact same face/angle no matter
        // where the flythrough camera happens to be. World quaternions are
        // used on both sides (getWorldQuaternion updates from ancestors),
        // matching how revealNode consumes them — so any transform on the
        // camera rig or the bottle scene roots is accounted for.
        const cameraBindWorldQuatInv = cameraOneObj.getWorldQuaternion(new THREE.Quaternion()).invert()
        revealNodes.forEach((node) => {
          const nodeWorldQuat = node.getWorldQuaternion(new THREE.Quaternion())
          node.userData.revealRelativeQuaternion = cameraBindWorldQuatInv.clone().multiply(nodeWorldQuat)
        })

        const aspect = container.clientWidth / container.clientHeight
        cameraOneObj.aspect = aspect
        cameraOneObj.updateProjectionMatrix()
        cameraTwoObj.aspect = aspect
        cameraTwoObj.updateProjectionMatrix()

        const cameraOneClip = cameraGltf.animations.find((clip) => clip.name === CAMERA_CLIP_ONE_NAME)
        const cameraTwoClip = cameraGltf.animations.find((clip) => clip.name === CAMERA_CLIP_TWO_NAME)
        if (!cameraOneClip || !cameraTwoClip) {
          console.error('[Product] Camera.glb is missing an expected animation clip')
          return
        }

        mixer = new THREE.AnimationMixer(cameraRig)

        cameraOneAction = mixer.clipAction(cameraOneClip)
        cameraOneAction.play()
        cameraOneAction.paused = true // driven manually via .time, see applyScrollProgress
        cameraOneDuration = cameraOneClip.duration

        cameraTwoAction = mixer.clipAction(cameraTwoClip)
        cameraTwoAction.play()
        cameraTwoAction.paused = true
        cameraTwoDuration = cameraTwoClip.duration

        // Measure the authored gap between clip one's final pose and clip
        // two's first pose once, so applyScrollProgress can cancel it out
        // every frame (see cameraTwoHandoffOffset above).
        cameraOneAction.time = cameraOneDuration
        cameraTwoAction.time = 0
        mixer.update(0)
        cameraTwoHandoffOffset.subVectors(cameraOneObj.position, cameraTwoObj.position)

        applyScrollProgress(scrollTriggerInstance.progress) // sync to wherever the user already scrolled to
      })
      .catch((error) => {
        console.error('[Product] Failed to load bathroom model/texture/camera rig/bottle', error)
      })

    const handleResize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      const aspect = width / height

      fallbackCamera.aspect = aspect
      fallbackCamera.updateProjectionMatrix()
      if (cameraOneObj) {
        cameraOneObj.aspect = aspect
        cameraOneObj.updateProjectionMatrix()
      }
      if (cameraTwoObj) {
        cameraTwoObj.aspect = aspect
        cameraTwoObj.updateProjectionMatrix()
      }
      renderer.setSize(width, height)
      resizeSelectiveBlurTargets()
    }
    window.addEventListener('resize', handleResize)

    // Purely a render loop now — camera pose is set exclusively inside
    // ScrollTrigger's onUpdate (see above), never here, so nothing in this
    // function can move the camera off the authored path on its own.
    let animationFrameId
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      // Keep the wireframe helpers in sync with any GUI-driven position/target changes.
      bathroomBottleLightHelper.update()
      washbasinBottleLightHelper.update()
      const sharpMeshes = activeRevealedNode
        ? interactiveMeshes.filter((mesh) => mesh.userData.revealNode === activeRevealedNode)
        : []
      renderSelectiveBlur(sharpMeshes)
    }
    animate()

    return () => {
      disposed = true
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('wheel', blockScrollInput, { capture: true })
      window.removeEventListener('touchmove', blockScrollInput, { capture: true })
      window.removeEventListener('keydown', blockScrollKeydown, { capture: true })
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('click', handleClick)
      cancelAnimationFrame(animationFrameId)
      gui.destroy()
      bathroomBottleLightHelper.dispose()
      washbasinBottleLightHelper.dispose()
      shadowPlaneGeometry.dispose()
      bathroomShadowMaterial.dispose()
      washbasinShadowMaterial.dispose()
      sceneRT.dispose()
      maskRT.dispose()
      maskBlurredRT.dispose()
      blurRTA.dispose()
      blurRTB.dispose()
      fsGeometry.dispose()
      maskMaterial.dispose()
      blurMaterial.dispose()
      compositeMaterial.dispose()
      scrollTriggerInstance.kill()
      if (ownsLenis) {
        gsap.ticker.remove(tickLenis)
        gsap.ticker.lagSmoothing(500, 33) // restore GSAP's default lag correction for other routes
        lenis.destroy()
      }
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll
      document.body.style.overscrollBehavior = prevBodyOverscroll
      unlockPageScroll() // in case the component unmounts mid-reveal (e.g. route navigation) before returnNode() ever restores it

      mixer?.stopAllAction()
      dracoLoader.dispose()
      ktx2Loader.dispose()
      roomTexture?.dispose()
      roomModel?.traverse((child) => {
        if (!child.isMesh) return
        child.geometry?.dispose()
        child.material?.dispose()
      })
      revealNodes.forEach((node) => node.userData.revealTween?.kill())
      bottleModel?.traverse((child) => {
        if (!child.isMesh) return
        child.geometry?.dispose()
        child.material?.map?.dispose()
        child.material?.normalMap?.dispose()
        child.material?.dispose()
      })
      renderer.dispose()

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
    // Mount-once by design (heavy scene/loader setup). contextLenis is read
    // once at the top, synchronously, for the ownsLenis decision above — see
    // its own comment for why it's already resolved by the time this
    // component ever mounts, so it deliberately isn't a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // containerRef must stay the direct ScrollTrigger pin target with no
    // SIZED ancestor wrapping it — GSAP grows ITS pin-spacer to reserve the
    // full SCROLL_LENGTH_VH of scroll room, and an explicit-height ancestor
    // would cap that growth (see the pin config above). `relative` alone
    // adds no size, so it's safe here, and it's what lets the overlay below
    // use `absolute` instead of `fixed`: as a CHILD of this div (not a
    // sibling), the overlay always exactly matches container's own box —
    // whether pinned (container goes position:fixed, full viewport) or not
    // (container's natural h-screen box) — instead of a `fixed inset-0`
    // overlay covering the whole page regardless of where <Product /> is
    // mounted (e.g. bleeding over HomeV2Page's other sections).
    <div ref={containerRef} className="relative w-full h-screen">
      {/* Product overlay — fades in/out with the reveal/return flight above
          (see setIsRevealed in revealNode/returnNode). Only the details card
          takes pointer events; the rest stays click-through so clicking
          anywhere else on the canvas still sends the bottle back. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-end transition-opacity duration-500 ease-out md:block ${
          isRevealed ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden={!isRevealed}
      >
        <img
          src={oxygenPublicUrl('/images/product_text.svg')}
          alt={OVERLAY_PRODUCT?.focusTitle ?? ''}
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-[8%] w-[min(85%,380px)] -translate-x-1/2 select-none"
        />

        <div className="pointer-events-none absolute bottom-[6%] left-1/2 w-[min(90%,360px)] -translate-x-1/2 text-center text-white [font-family:var(--font-body)] text-sm font-medium leading-[1.45] md:bottom-[8%]">
          {OVERLAY_PRODUCT?.quote ? (
            <AnimatedDescription
              className="m-0 text-center text-inherit"
              replayKey={isRevealed ? OVERLAY_PRODUCT.id : `${OVERLAY_PRODUCT.id}-hidden`}
              delay={0.15}
            >
              {OVERLAY_PRODUCT.quote}
            </AnimatedDescription>
          ) : null}
        </div>

        <div className="pointer-events-auto">
          <ProductDetailsV2 product={OVERLAY_PRODUCT} onBuy={handleBuy} />
        </div>
      </div>
    </div>
  )
}
