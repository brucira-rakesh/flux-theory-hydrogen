import { useEffect, useRef } from 'react'
import { useLenis } from 'lenis/react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import GUI from 'lil-gui'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import seawaveVertex from './shaders/seawave/vertex.glsl'
import seawaveFragment from './shaders/seawave/fragment.glsl'
// NEW: splash-system shaders (crown sheets) and the CPU mirror of the sea
// height field used for surface-break detection.
import crownVertex from './shaders/splash/crownVertex.glsl'
import crownFragment from './shaders/splash/crownFragment.glsl'
import cloudsVertex from './shaders/clouds/vertex.glsl'
import cloudsFragment from './shaders/clouds/fragment.glsl'
import planeCloudsFragment from './shaders/planeClouds/fragment.glsl'
import { sampleOceanHeight } from './oceanHeight.js'
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl'

// Flat plane driven by a raging-sea height field (vertex.glsl) and shaded as
// polished liquid metal / mercury via procedural environment reflection +
// fresnel (fragment.glsl). Tweak everything live through the lil-gui panel.
const PLANE_SIZE = 44
// PERF: was 1024 — at that density the plane is ~1.05M vertices, and the
// vertex shader evaluates the full displacement (4 Gerstner waves + perlin
// shimmer + the bottle-interaction terms) THREE times per vertex for
// finite-difference normals (see vertex.glsl), so this segment count is the
// single biggest constant GPU cost in the scene, paid every frame regardless
// of camera/bottle state. 640 keeps the same 44-unit span at ~1.7x the
// vertex spacing (~0.069 world units/segment vs ~0.043 before) — still fine
// enough to resolve the sea's own wave frequencies and the splash ripples'
// tightest band (~freq 17, i.e. ~0.37-unit wavelength) with several vertices
// per wavelength — while cutting vertex count (and this 3x-evaluated
// displacement cost) by ~61%.
const PLANE_SEGMENTS = 640 // surface resolution — high enough to keep wave normals crisp for reflections without the earlier 1024's GPU cost

// Draco + KHR_texture_basisu (KTX2) compressed bottle, sitting on the sea.
// Unlike the sea's unlit ShaderMaterial, GLTFLoader gives its meshes real
// PBR materials (MeshStandardMaterial, upgraded to MeshPhysicalMaterial for
// the clearcoat plastic) — same pattern as Scene.jsx's bottle flavors — so
// it needs actual scene lights to be visible; the sea shader ignores them.
const BOTTLE_MODEL_URL = oxygenPublicUrl('/models/bottle_nolabel_compressed.glb')
// NEW: sky clouds model — a flat cloud-card plane rendered with a custom
// ShaderMaterial (see the loader below and shaders/clouds/) that reads its
// baked texture's R/G channels as density/alpha data rather than displaying
// them as colour.
const CLOUDS_MODEL_URL = oxygenPublicUrl('/models/clouds.glb')
// NEW: a second, differently-authored cloud-bank asset — same treatment
// (loaded once, expanded into several InstancedMesh copies, see
// createCloudLayer below), layered on top of CLOUDS_MODEL_URL for a denser
// sky. Its reference texture is a plain grayscale JPEG (black = empty sky)
// rather than clouds.glb's density+green-key packing, so it gets its own
// fragment shader (planeClouds/fragment.glsl) that keys black to alpha.
const PLANE_CLOUDS_MODEL_URL = oxygenPublicUrl('/models/plane_clouds.glb')
const BOTTLE_TARGET_HEIGHT = 1.6 // world units — normalize scale so the bottle reads at a consistent size regardless of its authored units
// Interaction radius the water reaction uses at the waterline. Tuned by hand
// (0.58) rather than derived from the mesh bounds — the compressed bottle's
// bounding box is wider than the slim neck actually piercing the surface, so a
// fixed value reads truer than the auto-computed half-extent.
const BOTTLE_INTERACTION_RADIUS = 0.58
// How much page scroll (in viewport heights) it takes to scrub through the
// whole bottle-launch timeline, top to bottom. Higher = a slower, more
// deliberate scrub per pixel scrolled.
// Raised alongside gapParams.riseAmount/duration below: a bigger post-settle
// gap between the bottle and the sea means the baked launch timeline itself
// got longer (more seconds of simulated motion to scrub through), and since
// scrollProgress 0..1 always maps onto the WHOLE timeline regardless of its
// length, a longer timeline squeezed into the same scroll distance would
// just play back faster/more rushed. Scaled up by the same ~2.09x the
// timeline grew from its ORIGINAL 6.0/3.0 riseAmount/duration (verified by
// replaying bakeLaunchTimeline's math offline), so the scroll-to-motion
// pacing stays the same as before every gap increase since.
// Trimmed back down a bit (1003 -> 850) — the bottle's bottom-to-top rise
// needed too much scroll to complete; this doesn't touch the baked timeline
// itself (bakeLaunchTimeline/gapParams below are untouched), just how much
// physical scroll distance that same timeline gets scrubbed across.
const SCROLL_HEIGHT_VH = 850
// Lenis-style smoothing rate for the scroll scrub, in 1/seconds: how fast the
// value actually driving the camera/timeline catches up to the raw scroll
// position. This is exponential-decay smoothing (framerate-independent — see
// the animate() loop), not a fixed per-frame lerp fraction, so it feels the
// same at 30fps and 144fps. Lower = heavier/smoother "premium" glide, higher
// = snappier/less lag. ~4-5 reads like Lenis's default lerp feel. Lowered
// again (1.4 -> 0.9 -> 0.45) — the camera intro/reveal read as too fast/
// abrupt at 0.9, this is a much heavier, super-smooth catch-up — this is a
// straight exponential lag on top of an already-linear scroll->time mapping
// (see the breach-sync virtualTime remap in animate()): it always
// monotonically catches up to the target, so pushing it heavier only adds
// inertia/smoothness, it can't reintroduce any uneven-pacing artifact.
const SCROLL_SMOOTHING = 0.45
// Reverse (scrolling back UP) uses its own, slightly snappier rate — same
// exponential-decay math/character as SCROLL_SMOOTHING above (still a smooth
// glide, not a different motion style), just a bit quicker to catch up so
// scrolling back out of the section doesn't feel as heavy/laggy as the
// forward reveal. Picked direction-by-direction each frame (see `isReversing`
// in animate()), so it only kicks in while scrollProgress is actually
// trending down, and this is also what makes the reverse-scroll gate at the
// section's top edge (see REVERSE_GATE_EPSILON below) settle faster.
const REVERSE_SCROLL_SMOOTHING = 0.75
// Flat fraction of TOTAL page scroll (0..1) that must pass before the bottle
// launch timeline starts advancing at all. 0 = the bottle starts rising the
// INSTANT scroll begins — the same instant the opening camera reveal starts
// moving too, so both read as one single continuous motion ("the bottle
// comes out of the sea as the camera pulls back") rather than the bottle
// waiting for the camera to do its own thing first. Independent of
// cameraRevealParams.fraction/enabled: this is a plain threshold on
// scrollProgress itself, not tied to how far the reveal has gotten.
const BOTTLE_START_SCROLL_FRACTION = 0
// Fraction of the camera reveal's OWN scroll range (cameraRevealParams.
// fraction) at which the bottle should have FULLY breached the surface —
// see the virtualTime remap in animate(). 1.0 = breach lands exactly when
// the reveal finishes; lower means breach completes earlier, WHILE the
// camera is still moving toward the established shot, so the bottle is
// already visibly out of the water for the tail end of the reveal instead
// of only just clearing the surface the instant the camera stops.
const BREACH_LEAD_FRACTION = 0.6
// --- Reverse-scroll gate --------------------------------------------------
// ROOT CAUSE of "scrolling back up reveals IntroHeroV2 mid-animation": the
// sticky canvas (see the returned JSX's `position: sticky` wrapper) detaches
// based on RAW, instant scroll position — the moment real scroll crosses back
// above this section's own top, the browser un-sticks it immediately and
// IntroHeroV2 (sitting right above it in the document) becomes visible. But
// the bottle/camera animation is driven by `scrollProgress`, which is
// heavily EASED toward that raw position (see SCROLL_SMOOTHING —
// deliberately slow, "premium glide" lag). A fast upward flick can carry the
// raw scroll position back above the section's top well before the eased
// value has decayed back to 0, so the sticky canvas detaches — and
// IntroHeroV2 appears — while the sea/bottle are still mid-reverse.
// A buffer zone at the boundary (tried first) doesn't fix this: a fast
// enough flick crosses any fixed distance buffer in less real time than the
// easing needs to converge, since the buffer only changes WHERE
// scrollProgress reaches 0, not how long the flick takes to get there.
// A first attempt at a genuine gate then hard-froze the raw scroll position
// the instant a crossing was detected (lenis.stop() + an INSTANT/immediate
// scrollTo snap back to the edge) — that fixed the correctness bug (the hero
// could no longer appear mid-animation) but reads as jumpy: an `immediate`
// scrollTo teleports the real page scroll position in a single frame, which
// is itself a visible discontinuity independent of anything the eased
// bottle/camera state is doing.
// The fix below keeps the same guarantee (raw scroll can never cross the
// boundary while the animation is still unsettled) but replaces the instant
// snap with Lenis's own EASED, `lock: true` scrollTo — a tween back to the
// edge that can't be interrupted by further wheel/touch input mid-flight
// (Lenis sets `isLocked` for its duration and clears it automatically on
// completion — see node_modules/lenis's scrollTo). Because it's a tween, not
// a teleport, the page glides to a stop at the boundary — reads as gentle
// resistance/rubber-banding rather than a hard wall.
// A second pass sped up `scrollProgress`'s own catch-up (a separate,
// snappier smoothing rate used only while a correction was in flight) to
// bound the wait — but that gave the reverse completion a visibly different
// character/pace than forward scrolling: exactly what was reported as "not
// as smooth as forward". Fixed by deleting that entirely: this gate now
// reuses the SAME two smoothing layers forward scrolling already uses,
// unmodified —
//   1) the boundary scrollTo below passes no duration/easing of its own, so
//      it inherits Lenis's own configured `options.duration`/`options.easing`
//      (see <ReactLenis> in HomeV2Page.jsx) — the exact same tween Lenis
//      itself already uses for every ordinary wheel/touch scroll, so this
//      correction is indistinguishable in feel from the user's own scrolling.
//   2) `scrollProgress` below eases at REVERSE_SCROLL_SMOOTHING whenever it's
//      trending down (see `isReversing` in animate()) — gate or no gate,
//      boundary or mid-section — so the bottle/camera settle a bit quicker
//      on the way back down, but it's still ONE consistent rate for the
//      whole reverse direction, not a special faster mode that only kicks in
//      right at the edge.
// A third pass reported the page "feels locked at initial state" — the gate
// re-checked its trigger condition every single frame, so if `scrollProgress`
// hadn't fully settled below REVERSE_GATE_EPSILON by the time one correction
// tween finished, and the user was still trying to scroll further up (e.g. a
// hard flick, held trackpad gesture, or Home-key jump from deep in the
// section), it would immediately fire ANOTHER lock, then another — each one
// (re)pulling the page back down to the section's top and eating another
// ~1.2s of Lenis's own tween duration. Back-to-back-to-back corrections read
// exactly like the whole page being stuck/unresponsive right at the
// boundary, worst on a big scrollProgress gap (Home key from deep in the
// timeline) since that can take multiple correction cycles to fully decay.
// Fixed with a one-shot arm/disarm flag (`reverseGateArmed` in animate()) —
// the same pattern CloudTransition.jsx already uses for ITS OWN boundary
// (see `forwardArmedRef` there): the gate is only ALLOWED to fire once per
// approach, then disarms itself immediately. It only re-arms once scroll is
// back solidly inside the section (past REVERSE_GATE_REARM_FRACTION of the
// scrollable distance) — i.e. the user actually turned around and scrolled
// forward again, not just bounced off the same correction. So at most ONE
// ~1.2s correction ever plays per reverse pass: if scrollProgress genuinely
// hasn't settled by the time that single tween ends, the user is simply let
// through (a rare, still-finishing-up bottle rather than a stuck page) —
// never being fought a second time on the same attempt.
const REVERSE_GATE_EPSILON = 0.004 // scrollProgress below this counts as "fully reversed" — small enough that any remaining bottle/camera motion is visually imperceptible
const REVERSE_GATE_REARM_FRACTION = 0.05 // fraction of the section's scrollable distance the user must scroll back INTO before the gate is willing to fire again

// Cubic Hermite interpolation between (x0,y0) with tangent m0 and (x1,y1)
// with tangent m1 (tangents in dy/dx units, scaled internally by the
// segment width). Used to stitch the two straight scroll->virtualTime
// segments below into ONE value-AND-derivative-continuous curve — two plain
// lines that happen to meet at the same point can still have very DIFFERENT
// slopes there (the rise segment is steep, the tail segment is shallow),
// which is a velocity discontinuity: the bottle's rise rate snaps to a new
// speed the instant it crosses that point, reading as a glitch/jump right
// at breach. Matching the tangent at the shared knot removes that snap.
const hermite = (x, x0, y0, m0, x1, y1, m1) => {
  const h = x1 - x0
  if (h <= 1e-6) return y0
  const t = THREE.MathUtils.clamp((x - x0) / h, 0, 1)
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1
}

const Seawave = () => {
  const mountRef = useRef(null)
  // Outer scroll-driving wrapper (SCROLL_HEIGHT_VH tall, normal document
  // flow) — mountRef's canvas sticks to the viewport top only while this
  // wrapper is in view, then scrolls away with it, same "sticky, not fixed"
  // pattern SceneV2 uses (see Scene.v2.css). Scroll progress below is
  // measured against THIS element's own position, not the whole document,
  // so the animation only advances while the user is actually scrolling
  // through this section rather than from the very top of the page.
  const sectionRef = useRef(null)

  // ROOT CAUSE of the reported camera-transition stutter: this page scrolls
  // via Lenis (see HomeV2Page.jsx's <ReactLenis root>, driven manually off
  // gsap.ticker with autoRaf off), which smooths scroll by repeatedly
  // calling `window.scrollTo(..., { behavior: 'instant' })` on its OWN
  // requestAnimationFrame tick — a completely separate rAF loop from this
  // component's own `animate()`. HomeV2Page.jsx already discovered (see its
  // useHeaderModeOverSection comment) that native 'scroll' events aren't a
  // reliable signal for Lenis's programmatic scrolling and switched that
  // logic to read Lenis's own tick instead — but this component was never
  // updated to match, so it was still driving the camera off
  // window.scrollY + a native 'scroll' listener. Two independently-clocked
  // rAF loops racing each frame (which one reads/writes scroll first is
  // whatever order the browser happens to run queued callbacks in) means
  // the value this component read could be a frame ahead or behind Lenis's
  // actual current position on any given tick — exactly the kind of
  // per-frame timing jitter that reads as "the camera stutters" even though
  // overall render FPS is fine. useLenis's callback fires synchronously
  // inside Lenis's OWN tick (the same "scroll" event ScrollTrigger.update()
  // already relies on elsewhere on this page), so reading `lenis.scroll`
  // from it is frame-exact — no race, no stale reads. A ref (not state) so
  // this never triggers a React re-render; the imperative effect below
  // reads it directly every animate() frame instead of listening for DOM
  // scroll events at all.
  const lenisScrollRef = useRef(0)
  // Seawave also has a standalone dev-preview route (/seawave in App.jsx)
  // rendered with no <ReactLenis> ancestor at all — there, useLenis's
  // callback never fires (no lenis instance to subscribe to), so
  // lenisScrollRef would otherwise stay frozen at 0 forever. This flag lets
  // the effect below fall back to a plain native 'scroll' listener in that
  // case, while staying out of the way entirely once Lenis IS active.
  const lenisActiveRef = useRef(false)
  // The Lenis instance itself, so animate()'s reverse-scroll gate (see
  // REVERSE_GATE_EPSILON above) can call .scrollTo() on it directly to clamp
  // the real scroll position — reading lenis.scroll alone (lenisScrollRef)
  // isn't enough to actually hold the page in place.
  const lenisInstanceRef = useRef(null)
  useLenis((lenis) => {
    lenisActiveRef.current = true
    lenisInstanceRef.current = lenis
    lenisScrollRef.current = lenis.scroll
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const width = window.innerWidth
    const height = window.innerHeight

    // PERF: the lil-gui tweak panel and Stats.js FPS panel are dev/tuning
    // tools, not part of the shipped experience — but until now both were
    // unconditionally mounted for every real visitor. Stats redraws its own
    // canvas every frame, and several GUI controllers below use `.listen()`,
    // which (see lil-gui's source) spins up its OWN per-controller
    // requestAnimationFrame polling loop that keeps running regardless of
    // whether the panel is visually hidden — so just hiding the panel
    // wouldn't remove that cost. Gated behind dev mode or an explicit
    // `?debug` URL param so tuning still works on demand without shipping
    // always-on overhead to everyone else.
    const debugEnabled = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')

    // PERF: antialias:true only multisamples the CANVAS's own default
    // framebuffer — but every pass in this pipeline renders into the
    // EffectComposer's offscreen WebGLRenderTargets (created without MSAA
    // samples; see composer/bloomComposer below), and the only thing ever
    // drawn to the real default framebuffer is OutputPass's single
    // full-screen textured quad. A full-screen quad has no internal
    // triangle edges to smooth, so multisampling the canvas buys nothing —
    // every actual geometric edge in the scene (sea plane, bottle, clouds)
    // was already rasterized without AA, into the non-MSAA offscreen
    // targets, before antialias:true ever gets a chance to matter. The flag
    // was pure overhead: the browser still allocates and resolves a
    // multisampled backbuffer every frame for zero visual benefit. Turning
    // it off changes nothing on screen (there was never any AA on scene
    // geometry to begin with) and removes that resolve cost from every
    // frame. If edge aliasing ever needs addressing, add SMAAPass/FXAAPass
    // to `composer` instead — that's the correct place for it in a
    // post-processed pipeline.
    const renderer = new THREE.WebGLRenderer({ antialias: false })
    // PERF: base/full pixel ratio, kept so the transient dynamic-resolution
    // dip during the opening camera descent (see applyRenderResolution
    // below) can restore exactly this once the descent settles, rather than
    // drifting from repeated scale multiplications.
    const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2)
    renderer.setSize(width, height)
    renderer.setPixelRatio(BASE_PIXEL_RATIO)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    // composer.render() below makes several internal renderer.render() calls
    // per frame (RenderPass, the bloom pass's own blur sub-passes, OutputPass),
    // which would reset renderer.info.render after each one — reading it after
    // composer.render() would only reflect the LAST pass. Reset manually once
    // per frame in animate() instead so perfData accumulates the true total.
    renderer.info.autoReset = false
    mount.appendChild(renderer.domElement)

    const stats = new Stats()
    stats.showPanel(0)
    if (debugEnabled) {
      document.body.appendChild(stats.dom)
    }

    const scene = new THREE.Scene()

    // Vertical gradient backdrop (top -> bottom), tweakable live in the GUI's
    // "Scene background" folder further below. Drawn once onto a small canvas
    // and used as scene.background — costs nothing per frame (no extra
    // full-screen pass/geometry) and needs no aspect-ratio handling since a
    // vertical-only gradient looks identical however it's stretched
    // horizontally. Kept separate from `scene.environment` (the PMREM cube map
    // above) — that one only drives PBR material reflections.
    const bgGradientCanvas = document.createElement('canvas')
    bgGradientCanvas.width = 2
    bgGradientCanvas.height = 256
    const bgGradientCtx = bgGradientCanvas.getContext('2d')
    const bgGradientTexture = new THREE.CanvasTexture(bgGradientCanvas)
    bgGradientTexture.colorSpace = THREE.SRGBColorSpace
    // NOTE: the original flat colour (0x05070b) was so dark that a gradient
    // toward anything similarly dark reads as "no change at all" — these
    // defaults are deliberately a clearly lighter dusk blue at the top fading
    // to near-black at the bottom, so the gradient is obviously visible out of
    // the box. Tweak freely in the GUI ("Scene background" folder).
    const bgParams = {
      topColor: '#5171d2',
      bottomColor: '#c9c9c9',
    }
    const drawBackgroundGradient = () => {
      const grad = bgGradientCtx.createLinearGradient(0, 0, 0, bgGradientCanvas.height)
      grad.addColorStop(0, bgParams.topColor)
      grad.addColorStop(1, bgParams.bottomColor)
      bgGradientCtx.fillStyle = grad
      bgGradientCtx.fillRect(0, 0, bgGradientCanvas.width, bgGradientCanvas.height)
      bgGradientTexture.needsUpdate = true
    }
    drawBackgroundGradient()
    scene.background = bgGradientTexture

    // Real image-based environment for the bottle's PBR (MeshStandardMaterial)
    // meshes. Kept OFF scene.background so the solid backdrop colour above is
    // untouched; the sea/splash stay their own procedural ShaderMaterial
    // look (metalEnv.glsl) and are unaffected by this.
    //
    // IMPORTANT: assigning the raw 6-image CubeTexture straight to .envMap and
    // trusting three's automatic PMREM conversion silently produces NO visible
    // reflection until every one of the 6 images has finished decoding AND the
    // renderer happens to re-run that conversion check — easy to end up stuck
    // with a null envMap if that race is lost. So the PMREM (prefiltered,
    // roughness-aware) map is generated explicitly, only once the cube texture
    // has actually finished loading, and applied to the bottle materials at
    // that point (`applyEnvironmentMap`, called from both this loader's onLoad
    // AND the bottle's onLoad below — whichever finishes second does the
    // assignment, so there's no load-order race).
    let environmentMap = null
    let bottleMaterialsForEnv = [] // populated once the bottle's meshes are known
    let bottleBaseMaterials = [] // subset of the above belonging to the NEW_BASE006 mesh — see bottleTweaks.color
    // Tweaked live via the GUI's "Environment map" folder further below.
    const envMapParams = {
      enabled: true,
      // Raised from 1.2 — this reflection now drives the WHOLE bottle's
      // liquid-metal look (see bottleTweaks/applyBottleMaterialTweaks:
      // metalness 1 across every mesh, not just the small base mesh), so it
      // needs more presence to read as a properly reflective liquid mercury
      // surface instead of a dim grey metal.
      intensity: 1.28,
      rotation: Math.PI, // radians, about Y — spins which part of the cube map reflects where
    }
    // Cheap path for intensity/rotation: both just feed uniforms refreshed every
    // frame, so no shader recompile (mat.needsUpdate) is needed — safe to call
    // continuously while dragging a GUI slider.
    const updateEnvMapLook = () => {
      bottleMaterialsForEnv.forEach((mat) => {
        mat.envMapIntensity = envMapParams.intensity
        mat.envMapRotation.y = envMapParams.rotation
      })
    }
    // Full path: (re)assigns envMap itself (or clears it), which flips the
    // USE_ENVMAP shader define, so it DOES need a recompile — used on initial
    // load and when the "Enabled" toggle changes, not on every slider tick.
    const applyEnvironmentMap = () => {
      if (!environmentMap) return
      bottleMaterialsForEnv.forEach((mat) => {
        mat.envMap = envMapParams.enabled ? environmentMap : null
        mat.needsUpdate = true
      })
      updateEnvMapLook()
      // PERF: mat.needsUpdate above flips a shader #define (USE_ENVMAP), which
      // forces WebGL to recompile every one of these materials' programs the
      // next time each is actually drawn. Left alone, that recompile lands
      // lazily on whatever frame first renders the bottle — which, since the
      // cube map + bottle GLTF both finish loading within the first couple of
      // seconds of page life, is usually the SAME window the opening
      // scroll-driven camera descent (cameraIntroParams/cameraRevealParams)
      // is playing, and reads as a stutter right as the camera moves top to
      // bottom. Precompiling here, immediately once the materials/env are
      // actually ready, moves that one-time cost out of the animation path —
      // compileAsync uses KHR_parallel_shader_compile where available so it
      // doesn't block the main thread either. Safe to call before the bottle
      // has loaded (bottleMaterialsForEnv still empty): compiles whatever's
      // currently in the scene, which is cheap/no-op.
      renderer.compileAsync(scene, camera).catch(() => {})
    }
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    pmremGenerator.compileCubemapShader()
    const cubeTextureLoader = new THREE.CubeTextureLoader()
    cubeTextureLoader.setPath(oxygenPublicUrl('/environment/'))
    cubeTextureLoader.load(
      ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'],
      (loadedCubeTexture) => {
        loadedCubeTexture.colorSpace = THREE.SRGBColorSpace
        environmentMap = pmremGenerator.fromCubemap(loadedCubeTexture).texture
        scene.environment = environmentMap
        applyEnvironmentMap()
        // The raw 6-face cube texture and the generator are only intermediate
        // inputs to the PMREM prefilter above — the GPU-resident PMREM render
        // target (environmentMap) is what's actually sampled from here on, so
        // free both now.
        loadedCubeTexture.dispose()
        pmremGenerator.dispose()
      },
      undefined,
      (error) => {
        console.error('[Seawave] Failed to load environment map from /environment/ (px/nx/py/ny/pz/nz.png) — reflections will stay off.', error)
      }
    )

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.set(0, 0.0799999999999931, 4.227170327794697)

    // No OrbitControls: this is a scroll-driven scene, and mouse-drag orbiting
    // would fight the scroll-scrub camera/animation. `cameraTarget` stands in
    // for the removed controls' `.target` (look-at point) so the GUI's camera
    // panel keeps working.
    const cameraTarget = new THREE.Vector3(0, 0.940999999999999, 0)

    // cameraEndPosition/cameraEndTarget/cameraEndFov are the ESTABLISHED shot
    // — where the opening descent (below) ends and the existing bottle-launch
    // timeline begins. Captured here, once, before anything mutates them
    // every frame.
    const cameraEndPosition = camera.position.clone()
    const cameraEndTarget = cameraTarget.clone()
    let cameraEndFov = camera.fov
    // Frozen orientation for the established shot, captured once here (camera
    // is still sitting at cameraEndPosition, untouched) — applied directly
    // during the opening descent below instead of calling lookAt every frame,
    // so the camera's rotation stays fixed as it drops rather than swiveling
    // to track cameraTarget (the bottle's spawn point) from each intermediate
    // height. Ordinary lookAt-every-frame behaviour resumes once the descent
    // finishes (see the reveal block + final camera.lookAt in animate()).
    camera.lookAt(cameraEndTarget)
    const cameraEndQuaternion = camera.quaternion.clone()
    // Opening camera descent: first `fraction` of the page's scroll eases
    // camera.position.y DOWN from `startY` to the established Y
    // (cameraEndPosition.y) — X/Z and the look-at target (cameraTarget) stay
    // fixed at their established values throughout, so this is a straight
    // top-to-bottom drop into the established shot, not a pan/re-aim. THEN
    // the bottle sequence (untouched, see bakeLaunchTimeline/
    // sampleTimelineAt) takes over. `fraction`/`enabled` also pace the
    // bottle's breach timing against scroll (see BREACH_LEAD_FRACTION and
    // the virtualTime remap in animate()).
    const cameraRevealParams = {
      enabled: true,
      fraction: 0.22, // portion of total scroll spent on the descent before the bottle timeline starts advancing — raised from 0.12, which finished (and handed off to the bottle timeline) over too little scroll and read as an abrupt snap rather than a smooth glide
      startY: 0.5, // tuned live via the GUI — reads as a subtle drop-in rather than a steep fall from high overhead
      // NEW: extra rotation (degrees, on top of the frozen established
      // framing) applied at the very START of the descent (revealEase 0) and
      // eased back out to zero exactly as revealEase reaches 1 — so the
      // camera still hands off to cameraEndQuaternion with zero
      // discontinuity, it just tilts/pans in from an offset angle on the way
      // down instead of holding the established orientation the whole drop.
      rotationX: 0, // pitch offset at the start of the descent
      rotationY: 0, // yaw offset at the start of the descent
      rotationZ: 0, // roll offset at the start of the descent
    }

    // NEW: intro descent, layered ON TOP of the scroll-tied reveal above
    // instead of replacing it. `cameraRevealParams.startY` is the "resting"
    // top of the reveal (where the camera sits once the intro settles, and
    // deliberately left untouched here) — this stage eases the EFFECTIVE
    // start height from `fromY` down to `cameraRevealParams.startY` over the
    // FIRST `fraction` of total page scroll (same scroll-driven mechanism as
    // the reveal, just its own earlier fraction) — no real-time animation,
    // so it stays perfectly in sync with scroll position/direction (including
    // scrolling back up). Once past `fraction`, the effective start height is
    // pinned at `startY` and the existing reveal takes over exactly as before.
    const cameraIntroParams = {
      enabled: true,
      fromY: 24, // 3x the previous 8 — a much higher starting point for the drop-in
      fraction: 0.12, // portion of total scroll spent easing fromY -> startY, before the reveal's own fraction begins — raised from 0.05, which finished almost instantly and read as an abrupt jump rather than a smooth drop
    }

    // NEW: back-to-front Z dolly, riding the SAME revealEase as the Y drop
    // above — not a bow that returns to zero (that was tried and reverted),
    // a genuine one-way translation: the camera starts `backOffsetZ` world
    // units further away than the established shot and eases forward,
    // toward the bottle, arriving at EXACTLY cameraEndPosition.z the instant
    // revealEase reaches 1. Expressed as an offset from cameraEndPosition.z
    // (not an absolute Z) so it stays correct even if the established shot's
    // own Z is retuned live in the GUI above. Because it shares revealEase
    // with the Y drop, the two read as one continuous diagonal move — the
    // camera descends AND pushes in toward the subject at once, like a
    // crane/drone shot settling into a close establishing frame, rather than
    // a flat vertical elevator.
    const cameraDollyParams = {
      enabled: true,
      backOffsetZ: 4.1, // world units further back (larger Z) than the established shot at the very start of the descent
    }

    // NEW: continuous "river" drift. Once the opening reveal hands off to the
    // bottle sequence (rise/spin/tilt), the camera used to sit dead still for
    // the rest of the page — the water only ever moved from its own wave
    // animation, never from scroll. This adds a small, continuous camera
    // creep — applied on TOP of the established shot, scaled linearly by
    // bottleScrollProgress (0 at hand-off, 1 by the end) — so the landscape
    // keeps gliding past for as long as the bottle is rising/spinning,
    // instead of the scene going static the moment the reveal ends.
    // Position and target drift together (a near-parallel move, not a
    // re-aim), which reads as the camera gliding low over the water rather
    // than swinging to look somewhere new.
    //
    // IMPORTANT: the established camera sits at Y ≈ 0.098 — barely above the
    // (wavy, real-geometry) sea plane already. ANY negative Y drift here
    // pushes it toward/below the water surface, which clips the near plane
    // straight into wave geometry and reads as the screen going to a solid
    // extreme-close-up blur (this happened during tuning — kept the note so
    // it isn't reintroduced). Keep Y at or above 0 and keep the other axes
    // small; this is meant to be a subtle glide, not a repositioning.
    const cameraDriftParams = {
      enabled: true,
      position: new THREE.Vector3(-0.06, 0.1, -0.3), // total offset reached by bottleScrollProgress = 1
      target: new THREE.Vector3(-0.04, 0.04, -0.2),
    }

    // --- Post-processing: UnrealBloomPass for a soft glow on bright surfaces
    // (the metal sun glint, specular highlights on the sea/bottle).
    // Clouds must stay crisp/un-glowing, so bloom can't be one straight pass
    // over the whole frame — that would bloom the clouds too. Instead this
    // renders bloom from an offscreen composer with the clouds hidden (so
    // they never contribute to or receive bloom), then additively composites
    // that bloom texture onto the normal frame (clouds visible, un-bloomed)
    // in the main composer. See the `cloudLayerRefs` visibility toggle in
    // the render loop below for the hide/restore side of this.
    // OutputPass applies the renderer's tone mapping + output color space at
    // the very end of the chain, since render/bloom operate on the raw linear image.
    //
    // PERF: bloomComposer's own RenderPass re-renders the ENTIRE scene a
    // second time every frame (on top of the main composer's render), plus
    // UnrealBloomPass's 5-level blur chain on top of that — by far the
    // biggest fixed per-frame GPU cost in this file, paid every single
    // frame regardless of camera/bottle motion. Bloom is an inherently soft/
    // blurred effect (UnrealBloomPass itself downsamples internally through
    // 5 mip levels), so running its capture+blur chain at HALF resolution
    // instead of full loses no visible quality while cutting that duplicate
    // scene render + every blur pass to 1/4 the pixel count. bloomComposer is
    // sized explicitly (not via EffectComposer's default full-res buffer) and
    // kept in sync at half of whatever the main composer is sized to, see
    // handleResize below. The main composer/bloomMixPass still sample the
    // result via ordinary bilinear-filtered texture lookups, which upscales
    // it smoothly.
    const bloomWidth = Math.max(1, Math.round(width / 2))
    const bloomHeight = Math.max(1, Math.round(height / 2))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(bloomWidth, bloomHeight), 0.05, 0.4, 0.85)
    const bloomComposer = new EffectComposer(renderer)
    bloomComposer.renderToScreen = false
    bloomComposer.setSize(bloomWidth, bloomHeight)
    bloomComposer.addPass(new RenderPass(scene, camera))
    bloomComposer.addPass(bloomPass)

    const bloomMixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: bloomComposer.renderTarget2.texture },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
          }
        `,
      }),
      'baseTexture'
    )

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloomMixPass)
    const outputPass = new OutputPass()
    composer.addPass(outputPass)

    // --- Mercury sea: shader-driven displaced plane ---
    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS)
    // The shader computes its own normals (finite differences in vertex.glsl)
    // and samples no textures, so the geometry's `normal` and `uv` attributes
    // are dead weight — at 512² that's ~5 MB of per-vertex data never read.
    // Delete them so only `position` is uploaded/streamed.
    geometry.deleteAttribute('normal')
    geometry.deleteAttribute('uv')

    const uniforms = {
      uTime: { value: 0 },

      // Fluid flow — crossing Gerstner waves (X/Z orbit + Y elevation)
      uBigWavesElevation: { value: 0.0 },
      uBigWavesFrequency: { value: new THREE.Vector2(1.7, 1.62) },
      uBigWavesSpeed: { value: 0.5 },
      uBigWavesSteepness: { value: 0.3 }, // Gerstner Q — how much horizontal X/Z flow

      // Surface ripple — gentle smooth shimmer on top of the flow
      uSmallWavesElevation: { value: 0.04 },
      uSmallWavesFrequency: { value: 1.5 },
      uSmallWavesSpeed: { value: 0.51 },
      uSmallIterations: { value: 3 },

      // Metal albedo tint (depth = troughs, surface = crests)
      uDepthColor: { value: new THREE.Color(0x000000) },
      uSurfaceColor: { value: new THREE.Color(0x1d232f) },
      uColorOffset: { value: 0.48 },
      uColorMultiplier: { value: 4.43 },

      // Sun disk reflected in the metal
      uSunDirection: { value: new THREE.Vector3(0.9, 8.5, -11.1) },
      uSunColor: { value: new THREE.Color(0xbdbdbd) },
      uSunIntensity: { value: 12.05 },
      uSunSharpness: { value: 1000.0 },

      // Procedural studio environment the metal mirrors
      uSkyColor: { value: new THREE.Color(0x000000) },
      uHorizonColor: { value: new THREE.Color(0xffffff) },
      uGroundColor: { value: new THREE.Color(0x000000) },
      uSkyGradient: { value: 0.6 },
      uGroundGradient: { value: 0.5 },

      // Reflection response
      uFresnelPower: { value: 9.96 },
      uFresnelBias: { value: 0.0 },
      uSpecularStrength: { value: 10.0 },
      uShininess: { value: 578.0 },
      uDiffuseStrength: { value: 0.0 },

      // Positioned light producing the travelling metallic glint
      uLightPosition: { value: new THREE.Vector3(4.9, 0.0, 4.0) },
      uLightColor: { value: new THREE.Color(0xffffff) },
      uLightIntensity: { value: 1.85 },
      uMetalShininess: { value: 500.0 },

      // NEW: sea-shader copies of the two coloured accent directional lights
      // (bottleOrange/PurpleLight). Refreshed every frame from those light
      // objects in animate(), so a single GUI light drives BOTH the bottle
      // (real light) and the sea's coloured reflection + glint at once.
      uOrangeDirection: { value: new THREE.Vector3(-1.9, 7.1, -11.9) },
      uOrangeColor: { value: new THREE.Color(0xfebe90) },
      uOrangeIntensity: { value: 0.33 },
      uPurpleDirection: { value: new THREE.Vector3(-1.5, 3, -3) },
      uPurpleColor: { value: new THREE.Color(0xb98aff) },
      uPurpleIntensity: { value: 0.67 },

      // --- NEW: bottle → ocean interaction ------------------------------
      // These are shared by reference with the crown material (see
      // sharedInteractionUniforms below) so one per-frame update in
      // animate() feeds every splash system at once. Declared in the
      // bottleInteraction.glsl include on the shader side.
      uBottlePosition: { value: new THREE.Vector3(0, 0, 0) }, // (x, waterlineY, z)
      uBottleRadius: { value: BOTTLE_INTERACTION_RADIUS }, // hull radius at the waterline
      uBottleVelocityY: { value: 0 },      // world units / sec (+ = rising)
      uContact: { value: 0 },              // 0..1 bottle straddling the surface
      uImpactTime: { value: -1 },          // uTime of last break-through (<0 = none)
      uImpactStrength: { value: 0 },       // 0..1 splash energy from impact speed
      // NEW: reverse-scroll re-entry (bottle going back UNDER the surface).
      // Only read by the sea material (see bottleDisplacement in
      // bottleInteraction.glsl) — deliberately NOT added to
      // sharedInteractionUniforms below, so it never spawns crown sheets,
      // just a gentle ripple on the water itself.
      uReentryTime: { value: -1 },         // uTime of last downward re-submersion (<0 = none)
      uReentryStrength: { value: 0 },      // 0..1 — gentler ripple energy for that re-entry
      uInfluenceRadius: { value: 2.2 },    // outer radius of the water reaction
      uInteractionEnabled: { value: 1 },   // master toggle
      uFoamElevation: { value: 1.0 },      // intensity of the churned-water bump (vertex, not a color effect)
      uSplashAmplitude: { value: 0.32 },   // global height scale for the collar/ring/impact-ripple bulge
      uRippleStrength: { value: 3.0 },     // amplitude scale for the lingering aftermath ripples
      uRippleDuration: { value: 8.0 },     // seconds the aftermath ripples keep radiating before fading out
    }

    const material = new THREE.ShaderMaterial({
      vertexShader: seawaveVertex,
      fragmentShader: seawaveFragment,
      uniforms,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    scene.add(mesh)

    // =====================================================================
    //  NEW: Splash systems (crown sheets)
    // ---------------------------------------------------------------------
    //  Reuses the SAME uniform objects as the sea (shared by reference) for
    //  the metallic look + the bottle-interaction state, so:
    //    - tuning the sea's metal/env in the GUI retints the splash too, and
    //    - the single per-frame interaction update in animate() drives both
    //      materials.
    //  Everything stays GPU-driven: the crown is one displaced annulus. No
    //  particle engine, no CPU physics.
    // =====================================================================
    const sharedInteractionUniforms = {
      uTime: uniforms.uTime,
      // metallic environment (shared with the sea look)
      uDepthColor: uniforms.uDepthColor,
      uSurfaceColor: uniforms.uSurfaceColor,
      uSunDirection: uniforms.uSunDirection,
      uSunColor: uniforms.uSunColor,
      uSunIntensity: uniforms.uSunIntensity,
      uSunSharpness: uniforms.uSunSharpness,
      uSkyColor: uniforms.uSkyColor,
      uHorizonColor: uniforms.uHorizonColor,
      uGroundColor: uniforms.uGroundColor,
      uSkyGradient: uniforms.uSkyGradient,
      uGroundGradient: uniforms.uGroundGradient,
      uFresnelPower: uniforms.uFresnelPower,
      uFresnelBias: uniforms.uFresnelBias,
      uSpecularStrength: uniforms.uSpecularStrength,
      uShininess: uniforms.uShininess,
      uLightPosition: uniforms.uLightPosition,
      uLightColor: uniforms.uLightColor,
      uLightIntensity: uniforms.uLightIntensity,
      uMetalShininess: uniforms.uMetalShininess,
      // bottle interaction state
      uBottlePosition: uniforms.uBottlePosition,
      uBottleRadius: uniforms.uBottleRadius,
      uBottleVelocityY: uniforms.uBottleVelocityY,
      uContact: uniforms.uContact,
      uImpactTime: uniforms.uImpactTime,
      uImpactStrength: uniforms.uImpactStrength,
      uInfluenceRadius: uniforms.uInfluenceRadius,
      uInteractionEnabled: uniforms.uInteractionEnabled,
      uFoamElevation: uniforms.uFoamElevation,
      uSplashAmplitude: uniforms.uSplashAmplitude,
      uRippleStrength: uniforms.uRippleStrength,
      uRippleDuration: uniforms.uRippleDuration,
    }

    // --- Splash crown: a flat annulus (XZ) raised into vertical sheets ----
    // Built centred on the origin; positioned onto the bottle's waterline
    // each frame. Generous outer radius; the shader fades the rim so the
    // mesh boundary never shows.
    const buildCrownGeometry = (rInner, rOuter, radialSegments, ringSegments) => {
      const positions = []
      const indices = []
      for (let j = 0; j <= ringSegments; j++) {
        const r = rInner + (rOuter - rInner) * (j / ringSegments)
        for (let i = 0; i <= radialSegments; i++) {
          const a = (i / radialSegments) * Math.PI * 2
          positions.push(Math.cos(a) * r, 0, Math.sin(a) * r)
        }
      }
      const stride = radialSegments + 1
      for (let j = 0; j < ringSegments; j++) {
        for (let i = 0; i < radialSegments; i++) {
          const p0 = j * stride + i
          const p1 = p0 + 1
          const p2 = p0 + stride
          const p3 = p2 + 1
          indices.push(p0, p2, p1, p1, p2, p3)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      g.setIndex(indices)
      return g
    }

    const crownGeometry = buildCrownGeometry(0.0, 2.2, 160, 48)
    const crownMaterial = new THREE.ShaderMaterial({
      vertexShader: crownVertex,
      fragmentShader: crownFragment,
      uniforms: {
        ...sharedInteractionUniforms,
        uCrownHeight: { value: 0.7 }, // world-units the sheets can reach
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const crownMesh = new THREE.Mesh(crownGeometry, crownMaterial)
    crownMesh.frustumCulled = false // vertices are displaced far in-shader
    // Hidden: this is the raised, alpha-blended "crown" sheet ring around the
    // bottle at break-through — reported as a translucent elevated wave patch
    // that should not be visible. The rest of the splash (sea collar/ring/
    // ripples/foam) is untouched and keeps animating.
    crownMesh.visible = false
    scene.add(crownMesh)

    // --- Bottle lights ---
    // The sea's ShaderMaterial computes its own lighting from uniforms and
    // ignores these entirely — they only affect the bottle below.
    const bottleHemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5)
    bottleHemiLight.position.set(0, 5, 0)
    scene.add(bottleHemiLight)

    const bottleKeyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    bottleKeyLight.position.set(3, 5, 2)
    scene.add(bottleKeyLight)

    // NEW: two coloured rim/accent directional lights on the bottle — a warm
    // orange from one side and a cool purple from the other. Like the key
    // light above, these only touch the bottle's PBR materials (the sea shader
    // ignores all scene lights), so they add cinematic colour to the bottle
    // without changing the sea or any of the splash animation.
    const bottleOrangeLight = new THREE.DirectionalLight(0x969696, 0.33)
    bottleOrangeLight.position.set(-1.9, 7.1, -11.9)
    scene.add(bottleOrangeLight)

    const bottlePurpleLight = new THREE.DirectionalLight(0x696969, 0.67)
    bottlePurpleLight.position.set(-1.5, 3, -3)
    scene.add(bottlePurpleLight)

    // NEW: a strong white KEY light pointing at the bottle from the front-top
    // (camera side), lighting the revealed bottle's PBR material as a real
    // THREE light.
    const bottleCoatLight = new THREE.DirectionalLight(0xffffff, 2.2)
    bottleCoatLight.position.set(2.5, 4.5, 4.0)
    bottleCoatLight.target.position.set(0, 0.9, 0)
    scene.add(bottleCoatLight)
    scene.add(bottleCoatLight.target)
    const coatLightHelper = new THREE.DirectionalLightHelper(bottleCoatLight, 1.2)
    coatLightHelper.visible = false
    scene.add(coatLightHelper)

    // NEW: camera back light — a directional light that stays BEHIND the
    // camera and points the same way it's looking, so the bottle/sea always
    // get a consistent light from the viewer's own position as the camera
    // moves through the scroll-driven reveal/rise/spin sequence, instead of
    // a fixed light falling out of alignment with the shot. Updated every
    // frame in animate(), right after camera.lookAt(cameraTarget) — see
    // cameraLightViewDir below.
    const cameraLightParams = {
      enabled: true,
      distanceBehind: 3, // world units the light sits behind the camera, along its own view direction
      intensity: 1.5,
    }
    const cameraLight = new THREE.DirectionalLight(0xffffff, cameraLightParams.intensity)
    scene.add(cameraLight)
    scene.add(cameraLight.target)
    const cameraLightHelper = new THREE.DirectionalLightHelper(cameraLight, 1.2)
    cameraLightHelper.visible = false
    scene.add(cameraLightHelper)
    // Reused every frame instead of allocating a new Vector3 in the render loop.
    const cameraLightViewDir = new THREE.Vector3()
    // Reused every frame for the reveal's extra rotation offset (see
    // cameraRevealParams.rotationX/Y/Z) instead of allocating in animate().
    const revealExtraEuler = new THREE.Euler()
    const revealExtraQuaternion = new THREE.Quaternion()

    // NEW: direction helpers for the two accent lights. Unlike the sun (a
    // uniform-only fake), these are real THREE.DirectionalLights, so the
    // helper attaches directly; colour is omitted so each helper tracks its
    // light's live colour. Kept in sync in animate() as the GUI moves them.
    const orangeHelper = new THREE.DirectionalLightHelper(bottleOrangeLight, 1.2)
    orangeHelper.visible = false
    scene.add(orangeHelper)
    const purpleHelper = new THREE.DirectionalLightHelper(bottlePurpleLight, 1.2)
    purpleHelper.visible = false
    scene.add(purpleHelper)

    // --- Sun helper (visual only) ---
    // uSunDirection is a shader uniform, not a real THREE.Light — the "sun"
    // is a purely procedural glint/reflection in the fragment shader, so
    // there's nothing for a LightHelper to attach to. This proxy
    // DirectionalLight exists only to drive a DirectionalLightHelper arrow
    // showing where the sun currently points; intensity 0 keeps it from
    // actually lighting the bottle. Position/helper are kept in sync with
    // uSunDirection every frame in animate().
    const sunHelperLight = new THREE.DirectionalLight(uniforms.uSunColor.value, 0)
    sunHelperLight.target.position.set(0, 0, 0)
    scene.add(sunHelperLight)
    scene.add(sunHelperLight.target)
    const sunHelper = new THREE.DirectionalLightHelper(sunHelperLight, 1.5)
    sunHelper.visible = false
    scene.add(sunHelper)

    // --- Bottle model (Draco + KTX2 compressed) ---
    let disposed = false
    let bottleModel = null
    let bottleFolder = null

    // Three.WebGLRenderer.compileAsync polls `program.isReady()` on a
    // setTimeout that is not cancelled when the renderer is disposed. After
    // unmount, `currentProgram` is gone and that timer throws TypeError.
    // Same compile + poll, aborted from this effect's cleanup via `disposed`,
    // and guarded with `program?.isReady()` if a program is already gone.
    renderer.compileAsync = (compileScene, compileCamera, targetScene = null) => {
      const materials = renderer.compile(compileScene, compileCamera, targetScene)
      return new Promise((resolve) => {
        const checkMaterialsReady = () => {
          if (disposed) {
            resolve(compileScene)
            return
          }
          materials.forEach((material) => {
            const program = renderer.properties.get(material)?.currentProgram
            if (!program || program.isReady()) {
              materials.delete(material)
            }
          })
          if (materials.size === 0) {
            resolve(compileScene)
            return
          }
          setTimeout(checkMaterialsReady, 10)
        }
        checkMaterialsReady()
      })
    }

    // NEW: bottle geometry facts, hoisted so animate() can read them (filled
    // in once the GLB loads).
    let bottleRestingY = 0 // position.y that puts the base at sea level (y = 0)
    let bottleWorldHeight = BOTTLE_TARGET_HEIGHT // scaled height in world units

    // NEW: the bottle's FINAL resting height once the splash animation has
    // played out — i.e. exactly what world-space Y the 'settling' spring
    // (below) targets. It does NOT shift the hidden/rising/airborne motion:
    // the bottle still starts genuinely hidden and rises/arcs under real
    // forces, then parks at this exact Y once it settles.
    // facingY is the bottle's static base yaw (which side faces the camera at
    // rest) — NOT animated. animate() adds the baked post-reveal spin
    // (sample.rotY, see spinParams/bakeLaunchTimeline) on top of this each
    // frame, so it has to be a plain tweak read every frame rather than a
    // value the GUI writes straight onto bottleModel.rotation.y — otherwise
    // the per-frame animate() write would fight the GUI slider's write.
    const bottleTweaks = {
      positionY: 0.5,
      facingY: 0,
      // NEW: global metal-look override for the bottle's PBR materials (see
      // applyBottleMaterialTweaks below), applied to EVERY mesh so the whole
      // bottle reads as the same liquid mercury the sea is made of — not just
      // the small NEW_BASE006 base mesh. Low roughness for a sharp, mirror-
      // like liquid-metal reflection rather than a brushed/matte metal.
      metalness: 1.0,
      roughness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.28,
      // NEW: material colour (mat.color) override, GUI-tunable alongside
      // metalness/roughness/clearcoat above — but scoped to ONLY the
      // NEW_BASE006 mesh (see bottleBaseMaterials), not the whole bottle.
      // For a metalness=1 surface this tints the environment reflection
      // itself (metals have no separate diffuse albedo) — e.g. away from
      // white toward a warm gold or cool blue liquid-metal look.
      color: '#949494',
    }
    let bottleYOffset = bottleTweaks.positionY // keep the GUI's initial value and the applied target in sync

    // NEW: post-reveal turntable spin. Once the bottle has physically settled
    // (position + wobble, see positionSettled below), it turns in place about
    // Y for `duration` seconds —
    // a "show it off" beat baked onto the END of the same timeline the rise/
    // breach/settle already live on, so it inherits the whole file's
    // scroll-scrub reversibility for free (scrolling back mid-spin winds it
    // back out, same as every other stage). `turns` is full rotations
    // (2π each); eased in/out (see the smoothstep below) rather than linear
    // so it doesn't snap to a start/stop.
    const spinParams = {
      enabled: true,
      turns: 0.5, // reduced from 1 full rotation — a half-turn reads as "presenting" the bottle rather than a full spin-around
      duration: 8.0, // seconds for one full turn — slower/more deliberate than the original 4.0
      // NEW: the side-to-side lean (roll) on Z now rides the SAME master
      // ease as the rotation itself (see spinEase in the bake loop below) —
      // starting the instant the spin begins and reaching its full lean
      // exactly when rotation finishes (end of the spin+gap tail, i.e. end
      // of scroll for this segment). One continuous, smoothly co-developing
      // tilt-and-turn for the whole beat, rather than easing in early and
      // holding flat. Z-axis only.
      tiltAmountZ: 0.36, // radians (~21°) of side-to-side lean
    }

    // NEW: final gap rise. Starts at the SAME instant as the turntable spin
    // (see spinStartTime in the bake loop) — the bottle rises and rotates
    // together — climbing further to increase the visual gap between it and
    // the water below, instead of the camera cutting to a different shot.
    // This stays part of the SAME baked timeline as the rise/spin (see
    // bakeLaunchTimeline below), so the whole sequence reads
    // as one continuous scroll-driven motion rather than a hand-off between
    // separate animation systems.
    //
    // `cameraFollow` (0..1) is how much of this extra rise BOTH the camera's
    // position AND its look-at target track together (see animate()) — using
    // the SAME factor for both is what keeps the bottle anchored at a fixed
    // point in frame (center) instead of drifting: moving position and
    // target by identical amounts translates the whole camera rig with the
    // bottle, so the camera-to-bottle angle never changes. The water, which
    // does NOT rise, still visibly sinks lower in frame as the camera climbs
    // — that's what reads as "the gap increasing" on screen, even though the
    // bottle itself stays centered and still.
    const gapParams = {
      enabled: true,
      // Raised again, 20.25 -> 40.5 (originally 6.0) — this jump is 2x
      // rather than the earlier 1.5x steps — for even more visible
      // separation between the bottle and the sea by the end of the
      // sequence; duration raised by the same 2x factor alongside it so
      // the climb rate (world units/s) stays the same as before — a bigger
      // rise over the same time would read as a sudden speed-up rather than
      // "more of the same" motion. (SCROLL_HEIGHT_VH above was rescaled to
      // match the resulting longer baked timeline.)
      riseAmount: 40.5, // additional world units the bottle climbs, in sync with the spin (starts AND ends together)
      duration: 20.25, // seconds ADDED to spinParams.duration to form the total tail length the rise/spin both span (see spinEaseDuration) — not the rise's own separate timer anymore
      cameraFollow: 1.0, // 1 = camera rig fully tracks the bottle (stays centered); lower values let it drift toward the top of frame as it rises
      // NEW: one extra full turntable rotation (2π) folded into the spin's
      // total turns (see totalSpinTurns in the bake loop) — on top of the
      // "presenting" spin from spinParams.turns, all riding the same
      // continuous ease as the rise.
      spinTurns: 1.0,
    }

    // =====================================================================
    //  NEW: bottle physics — a small real simulation instead of a fixed-
    //  duration ease curve, so the motion (and therefore the splash it earns)
    //  is physically grounded rather than scripted.
    //
    //  State machine, one float-Y integrator (semi-implicit Euler):
    //   'hidden'   — resting below the surface, perfectly still, no forces.
    //                This is the bottle's state on load, so the default view
    //                is the plain sea with nothing poking through it.
    //   'rising'   — buoyancy accelerates it up against water drag. Drag is
    //                proportional to velocity, so the ascent naturally
    //                builds speed out of stillness rather than following a
    //                canned curve — the deeper/slower it is, the more force
    //                dominates; as it speeds up, drag catches back up.
    //   'airborne' — once the TOP has cleared the surface: gravity + a light
    //                air drag only. A real ballistic arc — it keeps rising on
    //                momentum, arcs over, and falls back under gravity.
    //   'settling' — the moment it falls back through the surface: a damped
    //                spring pulls the base toward its final resting height
    //                (bottleYOffset, tuned via the "Position Y" GUI control),
    //                so the animation always ends with the bottle parked at
    //                exactly that Y — not a fixed live-wave float.
    //  Velocity (physics.vy) is the ACTUAL integrated velocity, so impact
    //  strength below is earned by the simulation, not read off a timeline.
    // =====================================================================
    // Tuned for a slow, weighty, PREMIUM/Lenis-like emerge — THIRD pass,
    // noticeably slower again than the previous tuning: terminal rise speed
    // is roughly halved once more (~0.9 -> ~0.23 u/s), the surface-tension
    // brake at the interface is stronger and reaches further below the
    // surface so the actual breach — the moment it visibly clears the water
    // — reads as a near-suspended glide rather than a pop-through, and the
    // hidden start is deeper again (more build-up distance at that slower
    // speed). All of it stays a REAL force integrator (not a scripted ease
    // curve), so the extra slowness is earned physically — heavier drag, not
    // a fake blur — and composes with the Lenis-style scroll smoothing above
    // (SCROLL_SMOOTHING) rather than duplicating it. Because the whole
    // launch timeline is baked once (see BAKE_MAX_SECONDS/bakeLaunchTimeline
    // below) and scroll indexes into it by PROPORTION of its total duration,
    // slowing the rise like this also automatically claims a bigger slice of
    // the actual scroll distance for it — not just a bigger real-time delay.
    const physics = {
      state: 'hidden',
      y: 0, // world-space Y of the bottle's BASE (not the object's origin)
      vy: 0,
      hiddenDepth: 0.8, // how far the TOP sits below the surface while hidden (deeper = longer emerge at the slower speed below) — raised from 0.5 for a bit more visible gap between the bottle and the surface in the initial (pre-scroll) framing
      buoyancy: 0.65, // upward accel while submerged (world units/s²) — cut roughly in half again for a near-imperceptibly slow rise
      waterDrag: 2.6, // linear drag opposing motion underwater (terminal ≈ buoyancy/drag ≈ 0.25 u/s) — raised alongside the lighter buoyancy so it stays a controlled crawl, not just floaty
      gravity: 3.0, // downward accel once airborne — unchanged; this is the post-breach arc, not the "coming out" motion being slowed here
      airDrag: 0.3, // linear drag opposing motion in air
      springK: 9, // settle-spring stiffness — softer/slower settle than before
      // Critically/over-damped (critical = 2*sqrt(springK) ≈ 6.0 for unit
      // mass); springC keeps roughly the same over-critical ratio as before
      // (~1.3x critical) so it still glides to rest in one smooth,
      // continuous motion with no overshoot and no mid-animation pause —
      // just slower, because springK itself is lower.
      springC: 7.8,
      // Surface tension: extra drag on the RISE that fades in only in the
      // last stretch before breach (see 'rising' below). Without this, the
      // bottle keeps accelerating right up to the interface and crosses it
      // at close to full speed — which reads as "hitting" the water from
      // underneath rather than gliding through it.
      // DELIBERATELY MILD (was range 1.0 / drag 14 — strong enough to nearly
      // stall the bottle right at the interface): that near-stall, followed
      // by 'airborne' dropping back to just airDrag (0.3) the instant it
      // crosses, created a hard discontinuity in effective drag — reported
      // as the rise looking "slow, then jumpy and fast" right where it
      // breaks the surface. A small brake over a short range keeps the
      // approach continuous (no punch-through) without ever slowing enough
      // to create a release-like jump once past it — the visible speed
      // through the whole submerged->emerged range now stays close to the
      // steady terminal speed above (buoyancy/waterDrag), which is what
      // reads as one smooth, linear glide rather than two different speeds.
      surfaceTensionRange: 0.35, // world units below the surface where the brake starts
      surfaceTensionDrag: 3, // extra drag coefficient at the interface itself
    }

    // A small angular spring gives the hull a bit of roll/tilt wobble on
    // impact instead of rising perfectly upright — two cheap damped
    // oscillators, but it reads as real inertia rather than a rigid prop.
    // Damped a little harder than before (springC 6 -> 8, kick 0.35 -> 0.3)
    // so the wobble reads as a controlled settle rather than a twitchy
    // jiggle now that the rest of the motion is slower/heavier.
    const wobble = { angleX: 0, angleZ: 0, velX: 0, velZ: 0, springK: 40, springC: 8, kick: 0.3 }
    // Splash tuning that isn't a raw shader uniform. The min/max speeds are
    // re-synced to the SLOWER physics above (terminal ≈ 0.25 u/s) so the
    // now much-gentler break-through still earns a real (if soft) splash
    // instead of never crossing minSpeed at all — this is the "sync splash
    // with physics" tie-in.
    const splashParams = {
      energy: 0.5, // scales impact strength mapped from velocity
      minSpeed: 0.05, // velocity that yields a faint splash
      maxSpeed: 0.25, // velocity that yields a full splash (≈ the new terminal rise speed)
    }

    // Places the bottle at its hidden resting depth below whatever the live
    // wave height currently is at (x, z).
    const hiddenBaseY = (surfaceY) => surfaceY - bottleWorldHeight - physics.hiddenDepth

    // =====================================================================
    //  SCROLL SCRUB: the rise/breach/arc/settle motion above is a real force
    //  integrator (buoyancy vs. drag, gravity, a damped settle spring) — great
    //  for a one-shot real-time Play button, but unsafe to drive straight off
    //  scroll: scrolling UP would need these same equations run with a
    //  NEGATIVE timestep, and a damped spring/drag system isn't time-
    //  reversible — damping REMOVES energy going forward, so removing it in
    //  reverse ADDS energy and the spring blows up within a few frames.
    //
    //  So instead the exact same equations are baked ONCE into a fixed-
    //  timestep array of samples (bakeLaunchTimeline, below) — an offline
    //  replay of the same rise, breach, ballistic arc, settle spring and
    //  wobble kicks, still driven by the very same
    //  `physics`/`wobble`/`splashParams` knobs (still live-tunable from the
    //  GUI — any change re-bakes, see
    //  gui.onChange near the GUI setup below). Scrolling then just INDEXES
    //  that array by progress (sampleTimelineAt) instead of re-integrating —
    //  deterministic and perfectly reversible in either scroll direction, and
    //  identical to the original real-time animation when scrubbed forward at
    //  a steady pace. Ocean waves and the splash crown VFX stay on
    //  the real clock (uTime) so the sea keeps living and the splash burst
    //  still reads as a crisp, real-time event whenever the scrub crosses the
    //  breach point (see the animate() loop below).
    // =====================================================================
    const BAKE_DT = 1 / 120 // fixed timestep for the offline bake — independent of display frame rate
    const BAKE_MAX_SECONDS = 60 // safety cap (rise + settle + post-reveal spin duration, GUI-tunable) — raised alongside the slower rise physics above so the bake has room to actually finish the settle/spin/gap tail instead of truncating mid-motion
    // NEW: caps how long the bake waits for the settle spring to reach its
    // tight convergence tolerance (see positionSettled below) before starting
    // the turntable spin / gap rise anyway. A critically-damped spring only
    // asymptotically approaches its target — the last stretch to get within
    // that tolerance can take a couple of extra seconds of barely-visible
    // motion, which (since scroll maps LINEARLY onto this baked timeline)
    // read as a dead pause right before the bottle continues rising with the
    // camera. Capping the wait means the spin/gap phase always picks up
    // while the spring still has real, visible velocity left — one
    // continuous upward flow instead of settle-to-a-stop-then-go.
    const SETTLE_MAX_WAIT = 0.6 // seconds
    let timelineSamples = []
    let timelineDuration = 0
    let timelineBreachTime = -1
    let timelineBreachStrength = 0

    const bakeLaunchTimeline = () => {
      if (!bottleModel) return
      const bx = bottleModel.position.x
      const bz = bottleModel.position.z

      let simState = 'rising'
      let simY = hiddenBaseY(sampleOceanHeight(bx, bz, uniforms, 0))
      let simVy = 0
      const simFlipStartY = simY
      let wobAngleX = 0
      let wobAngleZ = 0
      let wobVelX = 0
      let wobVelZ = 0
      let simSmoothedContact = 0
      let breachTime = -1
      let breachStrength = 0
      let spinStartTime = -1 // simT at which the bottle first settled; -1 = not reached yet
      let settlingStartTime = -1 // simT the 'settling' state was entered; -1 = not reached yet — see SETTLE_MAX_WAIT

      const samples = []
      let simT = 0
      while (simT <= BAKE_MAX_SECONDS) {
        const surfaceY = sampleOceanHeight(bx, bz, uniforms, simT)
        const baseYPrev = simY
        const topYPrev = baseYPrev + bottleWorldHeight

        if (simState === 'hidden') {
          simY = hiddenBaseY(surfaceY)
          simVy = 0
        } else {
          let accel = 0
          if (simState === 'rising') {
            const distToSurface = Math.max(surfaceY - topYPrev, 0)
            const nearSurface = 1 - THREE.MathUtils.smoothstep(distToSurface, 0, physics.surfaceTensionRange)
            const tensionDrag = nearSurface * physics.surfaceTensionDrag
            accel = physics.buoyancy - (physics.waterDrag + tensionDrag) * simVy
          } else if (simState === 'airborne') {
            accel = -physics.gravity - physics.airDrag * simVy
          } else if (simState === 'settling') {
            accel = -physics.springK * (simY - bottleYOffset) - physics.springC * simVy
          }
          simVy += accel * BAKE_DT
          simY += simVy * BAKE_DT
        }

        const baseY = simY
        const topY = baseY + bottleWorldHeight
        const velY = simVy
        const wasRising = simState === 'rising'

        if (simState === 'rising' && topY > surfaceY) {
          simState = 'airborne'
        }
        if (simState === 'airborne' && velY <= 0) {
          simState = 'settling'
          settlingStartTime = simT
          wobVelX += (Math.random() - 0.5) * 0.5 * wobble.kick
          wobVelZ += (Math.random() - 0.5) * 0.5 * wobble.kick
        }

        const contact =
          THREE.MathUtils.smoothstep(topY, surfaceY - 0.05, surfaceY + 0.3) *
          THREE.MathUtils.smoothstep(surfaceY - baseY, -0.05, 0.35)

        if (wasRising && topYPrev <= surfaceY && topY > surfaceY && velY > 0) {
          breachTime = simT
          const s = THREE.MathUtils.clamp(
            (Math.abs(velY) - splashParams.minSpeed) / (splashParams.maxSpeed - splashParams.minSpeed),
            0,
            1
          )
          breachStrength = Math.max(s * splashParams.energy, 0.15)
          wobVelX += (Math.random() - 0.5) * Math.abs(velY) * wobble.kick
          wobVelZ += (Math.random() - 0.5) * Math.abs(velY) * wobble.kick
        }

        const contactTau = 0.12
        simSmoothedContact += (contact - simSmoothedContact) * (1 - Math.exp(-BAKE_DT / contactTau))

        const wobAccelX = -wobble.springK * wobAngleX - wobble.springC * wobVelX
        const wobAccelZ = -wobble.springK * wobAngleZ - wobble.springC * wobVelZ
        wobVelX += wobAccelX * BAKE_DT
        wobVelZ += wobAccelZ * BAKE_DT
        wobAngleX = THREE.MathUtils.clamp(wobAngleX + wobVelX * BAKE_DT, -0.4, 0.4)
        wobAngleZ = THREE.MathUtils.clamp(wobAngleZ + wobVelZ * BAKE_DT, -0.4, 0.4)

        const flipT =
          simState === 'hidden'
            ? 0
            : THREE.MathUtils.clamp((baseY - simFlipStartY) / Math.max(bottleYOffset - simFlipStartY, 0.001), 0, 1)
        const baseRotationX = THREE.MathUtils.lerp(0, 0, flipT)

        const settledByTolerance =
          simState === 'settling' &&
          Math.abs(simY - bottleYOffset) < 0.0015 &&
          Math.abs(simVy) < 0.0015 &&
          Math.abs(wobAngleX) < 0.002 &&
          Math.abs(wobAngleZ) < 0.002 &&
          Math.abs(wobVelX) < 0.01 &&
          Math.abs(wobVelZ) < 0.01
        // Also settled if we've simply been waiting too long — a critically/
        // over-damped spring only asymptotically approaches its target, and
        // waiting for the FULL tight-tolerance convergence above can leave a
        // long, barely-moving tail before the spin/gap rise ever kicks in
        // (see SETTLE_MAX_WAIT). Capping it here means the next phase always
        // starts while the spring still has visible motion left.
        const settledByTimeout =
          simState === 'settling' && settlingStartTime >= 0 && simT - settlingStartTime >= SETTLE_MAX_WAIT
        const positionSettled = settledByTolerance || settledByTimeout
        // Spin starts the instant the bottle physically settles into its
        // resting position (or the wait cap above is reached).
        if (positionSettled && spinStartTime < 0) spinStartTime = simT

        // Turntable spin: LINEAR (constant angular speed, not eased) across
        // `duration` PLUS the gap-rise's own `duration` (see gapParams) —
        // spread over the WHOLE tail, rather than just the initial spin's
        // own duration, so it keeps turning at the same steady rate right up
        // to the moment the gap rise (and the whole sequence) finishes — no
        // freeze/hold partway, no speed-up/slow-down either.
        // `turns` covers the initial "presenting" spin; gapParams.spinTurns
        // adds an extra turn on top, both riding this same constant rate.
        const spinEaseDuration = spinParams.duration + (gapParams.enabled ? gapParams.duration : 0)
        const totalSpinTurns = spinParams.turns + (gapParams.enabled ? gapParams.spinTurns : 0)
        let spinT = 0
        let spinTiltZ = 0
        if (spinParams.enabled && spinStartTime >= 0) {
          const spinProgress = THREE.MathUtils.clamp((simT - spinStartTime) / Math.max(spinEaseDuration, 0.001), 0, 1)
          spinT = spinProgress * totalSpinTurns * Math.PI * 2

          // Side-to-side lean (roll, Z-axis) stays eased (smoothstep) even
          // though the rotation itself is now linear — starts the instant
          // the spin begins, reaches full lean exactly as rotation finishes
          // at the end of the tail.
          const tiltEase = THREE.MathUtils.smoothstep(spinProgress, 0, 1)
          spinTiltZ = tiltEase * spinParams.tiltAmountZ
        }
        const spinFinished = !spinParams.enabled || (spinStartTime >= 0 && simT - spinStartTime >= spinParams.duration)

        // NEW: gap rise — starts at the SAME instant as the turntable spin
        // AND is spread across the SAME spinEaseDuration (not its own
        // gapParams.duration), so the rise and the rotation start together
        // AND finish together — one synced motion instead of the rise
        // wrapping up early while the bottle keeps turning.
        let gapRiseY = 0
        if (gapParams.enabled && spinStartTime >= 0) {
          const gapProgress = THREE.MathUtils.clamp((simT - spinStartTime) / Math.max(spinEaseDuration, 0.001), 0, 1)
          // Ease-OUT (not smoothstep, which eases BOTH ends) — smoothstep has
          // zero derivative right at gapProgress=0, i.e. it starts from rest.
          // With SETTLE_MAX_WAIT capping the wait above, the settle spring
          // can still be moving with real velocity right as this phase
          // begins; starting the rise from rest fought that, reading as a
          // stutter/pause exactly at the handoff. A quadratic ease-out has
          // its strongest velocity at the start (continuing the "coming up"
          // motion seamlessly) and eases only into the finish, so the whole
          // sequence reads as one continuous upward flow.
          const gapEase = 1 - (1 - gapProgress) * (1 - gapProgress)
          gapRiseY = gapEase * gapParams.riseAmount
        }
        const gapFinished = !gapParams.enabled || (spinStartTime >= 0 && simT - spinStartTime >= spinEaseDuration)

        samples.push({
          baseY: baseY + gapRiseY,
          velY,
          rotX: baseRotationX + wobAngleX,
          rotY: spinT,
          rotZ: wobAngleZ + spinTiltZ,
          contact: simSmoothedContact,
          gapRiseY,
        })

        if (positionSettled && spinFinished && gapFinished) break

        simT += BAKE_DT
      }

      timelineSamples = samples
      timelineDuration = Math.max(samples.length - 1, 1) * BAKE_DT
      timelineBreachTime = breachTime
      timelineBreachStrength = breachStrength
    }

    // Samples the baked timeline at a virtual time (seconds), interpolating
    // between the two nearest fixed-step samples — this is the ONLY thing
    // scroll drives at runtime.
    const sampleTimelineAt = (time) => {
      const samples = timelineSamples
      const n = samples.length
      if (n === 0) return null
      const clampedTime = THREE.MathUtils.clamp(time, 0, timelineDuration)
      const idx = clampedTime / BAKE_DT
      const i0 = Math.min(Math.floor(idx), n - 1)
      const i1 = Math.min(i0 + 1, n - 1)
      const frac = idx - i0
      const a = samples[i0]
      const b = samples[i1]
      return {
        baseY: THREE.MathUtils.lerp(a.baseY, b.baseY, frac),
        velY: THREE.MathUtils.lerp(a.velY, b.velY, frac),
        rotX: THREE.MathUtils.lerp(a.rotX, b.rotX, frac),
        rotY: THREE.MathUtils.lerp(a.rotY, b.rotY, frac),
        rotZ: THREE.MathUtils.lerp(a.rotZ, b.rotZ, frac),
        contact: THREE.MathUtils.lerp(a.contact, b.contact, frac),
        gapRiseY: THREE.MathUtils.lerp(a.gapRiseY, b.gapRiseY, frac),
      }
    }

    // Scroll progress (0 at the top of this SECTION, 1 at its bottom) drives
    // the baked timeline above. Measured against sectionRef's own document
    // position rather than the whole page — Seawave is one section among
    // several on HomeV2Page now (after IntroHeroV2), not the entire route —
    // so the sea only starts animating once the user actually scrolls into
    // it, and finishes exactly at the section's own bottom rather than the
    // page's.
    //
    // NEW: smoothed (Lenis-like) scrub. `targetScrollProgress` is the RAW,
    // instant scroll position (now sourced from Lenis itself — see
    // lenisScrollRef above — not window.scrollY/'scroll' events).
    // `scrollProgress` — the value the camera reveal and bottle timeline
    // actually read every frame — is eased toward that target inside
    // animate() via exponential lerp (THREE.MathUtils.lerp, framerate-
    // independent; see SCROLL_SMOOTHING). Previously scrollProgress WAS the
    // raw value, so the whole scrub snapped 1:1 to scroll pixels and read as
    // instant/fast; this decouples "where scroll is" from "where the scene
    // is", so the scene glides/eases toward it instead of teleporting.
    let targetScrollProgress = 0
    let scrollProgress = 0
    // PERF: sectionEl.offsetTop/offsetHeight are layout-dependent — reading
    // them forces the browser to resolve any pending layout. Cached here and
    // refreshed only on resize (see refreshScrollMetrics in handleResize)
    // instead of on every scroll/frame, so updateScrollProgress itself is
    // pure arithmetic (ref read + subtraction) and safe to call unconditionally
    // every animate() tick.
    let cachedSectionTop = 0
    let cachedScrollableDistance = 0
    const refreshScrollMetrics = () => {
      const sectionEl = sectionRef.current
      if (!sectionEl) return
      // offsetTop walks the offsetParent chain to the document, so this
      // stays correct regardless of how deeply nested the section is inside
      // HomeV2Page's own layout.
      cachedSectionTop = sectionEl.offsetTop
      cachedScrollableDistance = sectionEl.offsetHeight - window.innerHeight
    }
    refreshScrollMetrics()
    const updateScrollProgress = () => {
      const scrolledIntoSection = lenisScrollRef.current - cachedSectionTop
      targetScrollProgress =
        cachedScrollableDistance > 0
          ? THREE.MathUtils.clamp(scrolledIntoSection / cachedScrollableDistance, 0, 1)
          : 0
    }
    updateScrollProgress()
    scrollProgress = targetScrollProgress // start in sync so there's no smoothing glide-in from 0 on first paint

    // Fallback ONLY for the no-Lenis case (see lenisActiveRef above) — a
    // plain native 'scroll' listener that keeps lenisScrollRef fed from
    // window.scrollY when nothing else is updating it. Batched the same way
    // the old direct-window.scrollY path was (flag + read once per animate()
    // tick, not once per raw event) so it can't reintroduce forced-layout-
    // on-every-scroll-event even on that fallback path.
    let scrollFallbackDirty = false
    const markScrollFallbackDirty = () => {
      scrollFallbackDirty = true
    }
    window.addEventListener('scroll', markScrollFallbackDirty, { passive: true })

    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(oxygenPublicUrl('/draco/'))

    const ktx2Loader = new KTX2Loader()
    ktx2Loader.setTranscoderPath(oxygenPublicUrl('/basis/'))
    ktx2Loader.detectSupport(renderer)

    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)
    gltfLoader.setKTX2Loader(ktx2Loader)

    gltfLoader.load(
      BOTTLE_MODEL_URL,
      (gltf) => {
        if (disposed) return // effect was cleaned up (e.g. StrictMode double-mount) before the load resolved

        bottleModel = gltf.scene

        // Normalize scale from the model's authored units to a consistent
        // on-screen height, then rest its base on the sea surface (y = 0)
        // and center it over the origin — robust regardless of how the
        // source file was authored/exported.
        const rawBox = new THREE.Box3().setFromObject(bottleModel)
        const rawSize = rawBox.getSize(new THREE.Vector3())
        const scale = BOTTLE_TARGET_HEIGHT / (rawSize.y || 1)
        bottleModel.scale.setScalar(scale)

        const scaledBox = new THREE.Box3().setFromObject(bottleModel)
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
        const scaledSize = scaledBox.getSize(new THREE.Vector3())
        bottleModel.position.x -= scaledCenter.x
        bottleModel.position.z -= scaledCenter.z
        // restingY is the Y that puts the bottle's base exactly at world y=0;
        // physics.y (a world-space base Y) is converted to position.y via
        // `physics.y + bottleRestingY` everywhere below.
        const restingY = -scaledBox.min.y

        // Bottle stays upright/straight throughout — no flip-from-upside-down
        // animation (see baseRotationX in bakeLaunchTimeline below, which now
        // lerps 0 -> 0). Set here too (not just relied on from the first
        // animate() tick) so there's no possible one-frame flash of any other
        // orientation right after load.
        bottleModel.rotation.x = 0

        // NEW: hand the bottle's real dimensions to the interaction system.
        // The waterline radius is the hand-tuned BOTTLE_INTERACTION_RADIUS
        // (kept regardless of the mesh bounds); the influence zone is a few
        // radii out so the reaction stays local.
        bottleRestingY = restingY
        bottleWorldHeight = scaledSize.y
        uniforms.uBottleRadius.value = BOTTLE_INTERACTION_RADIUS
        uniforms.uInfluenceRadius.value = Math.max(BOTTLE_INTERACTION_RADIUS * 6.0, 2.0)

        // NEW: start fully hidden below the LIVE wave surface at this x/z —
        // never at a fixed "resting" position. This is what makes the
        // default view (before Play is ever pressed) show a completely
        // undisturbed sea with nothing poking through it, and it's why
        // pressing Play the first time never causes a jump: the bottle is
        // already sitting exactly where 'rising' will start integrating from.
        const surfaceY0 = sampleOceanHeight(bottleModel.position.x, bottleModel.position.z, uniforms, clock.getElapsedTime())
        physics.state = 'hidden'
        physics.y = hiddenBaseY(surfaceY0)
        bottleModel.position.y = physics.y + bottleRestingY

        // NEW: bake the scroll-scrubbed launch timeline now that the bottle's
        // real dimensions/position are known (see bakeLaunchTimeline above).
        bakeLaunchTimeline()

        // NEW: upgrade every bottle mesh to MeshPhysicalMaterial (only
        // "Silver_Plastic_Logo"/NEW_BASE006 came out of the glTF already
        // upgraded, because it's the only one carrying KHR_materials_clearcoat —
        // GLTFLoader only auto-upgrades materials that declare an extension it
        // needs Physical for). MeshPhysicalMaterial gives every mesh a real
        // clearcoat layer: a second, near-mirror specular lobe on TOP of the
        // base metalness/roughness reflection, so even the dielectric parts
        // (Black_Glossy_Plastic, metalness 0 -> only a faint fresnel glint on
        // MeshStandardMaterial) pick up a strong, clearly visible mirror
        // reflection of the environment instead of just a subtle highlight.
        const upgradeToPhysical = (mat) => {
          if (!mat || !mat.isMeshStandardMaterial) return mat
          if (mat.isMeshPhysicalMaterial) return mat // already physical (clearcoat ext.)
          const physical = new THREE.MeshPhysicalMaterial()
          // IMPORTANT: MeshPhysicalMaterial.prototype.copy() unconditionally
          // copies physical-only fields (clearcoatNormalScale, sheenColor,
          // attenuationColor, ...) that don't exist on a plain
          // MeshStandardMaterial source — e.g. `this.clearcoatNormalScale.copy(
          // source.clearcoatNormalScale)` throws "Cannot read properties of
          // undefined" when source.clearcoatNormalScale is undefined. That
          // exception was being thrown INSIDE bottleModel.traverse(), aborting
          // the rest of the material/envMap setup for the whole bottle silently
          // — the actual cause of "no reflection anywhere on the model".
          // MeshStandardMaterial.prototype.copy only touches fields that exist
          // on both, so call that base implementation directly instead and
          // leave the physical-only fields at MeshPhysicalMaterial's own
          // (safe) constructor defaults.
          THREE.MeshStandardMaterial.prototype.copy.call(physical, mat)
          physical.clearcoat = 1.0
          physical.clearcoatRoughness = 0.08
          mat.dispose()
          return physical
        }

        bottleModel.traverse((child) => {
          if (!child.isMesh) return
          if (Array.isArray(child.material)) {
            child.material = child.material.map(upgradeToPhysical)
          } else {
            child.material = upgradeToPhysical(child.material)
          }
          // Every bottle mesh (not just NEW_BASE006, the base/foot mesh) gets
          // the same liquid-metal treatment now — see applyBottleMaterialTweaks
          // below, called once on load so the whole bottle reads as the same
          // polished mercury the sea is made of, not each mesh's own
          // authored glTF metalness/roughness.
          const isBaseMesh = child.name === 'NEW_BASE006'
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach((mat) => {
            if (!mat || !mat.isMeshStandardMaterial) return
            // NEW: bind the real (PMREM-prefiltered) environment map directly onto
            // the material. Tracked in bottleMaterialsForEnv + applied via
            // applyEnvironmentMap() rather than assigned inline here, because the
            // cube map load and this GLTF load race — whichever finishes first
            // has nothing to assign yet, so the actual assignment happens once
            // below (this load) and again from the cube loader's onLoad (in case
            // it resolves later).
            bottleMaterialsForEnv.push(mat)
            // bottleTweaks.color (see applyBottleMaterialTweaks) is scoped to
            // ONLY this mesh's material — the rest of the bottle keeps its
            // own authored colour, tinted purely by metalness/env reflection.
            if (isBaseMesh) bottleBaseMaterials.push(mat)
          })
        })
        // Covers the case where the environment cube map already finished
        // loading before the bottle did — otherwise applyEnvironmentMap() only
        // ever runs from the cube loader's own onLoad, which would be a no-op
        // by then since bottleMaterialsForEnv was still empty at that point.
        applyEnvironmentMap()

        // NEW: global metalness/roughness/clearcoat override, wired to the
        // "Material" sliders in the Bottle GUI folder below. Applies the same
        // values to every PBR material on the bottle (bottleMaterialsForEnv
        // already collects all of them, chrome base mesh included) — a single
        // set of knobs to reshape the whole bottle's metal look, rather than
        // hunting down each mesh's own material individually.
        const applyBottleMaterialTweaks = () => {
          bottleMaterialsForEnv.forEach((mat) => {
            mat.metalness = bottleTweaks.metalness
            mat.roughness = bottleTweaks.roughness
            if (mat.isMeshPhysicalMaterial) {
              mat.clearcoat = bottleTweaks.clearcoat
              mat.clearcoatRoughness = bottleTweaks.clearcoatRoughness
            }
          })
          // Colour only applies to the NEW_BASE006 mesh — see bottleBaseMaterials.
          bottleBaseMaterials.forEach((mat) => mat.color.set(bottleTweaks.color))
        }
        // BUG FIX: this was previously only wired to the GUI sliders'
        // onChange — never called once up front — so the bottle rendered
        // with whatever metalness/roughness the glTF happened to author
        // (near-0 metalness on the body = flat white plastic) until someone
        // nudged a slider. Call it once now so the tuned liquid-metal
        // defaults above actually take effect on load.
        applyBottleMaterialTweaks()

        scene.add(bottleModel)
        // PERF: the bottle's MeshPhysicalMaterial programs (clearcoat +
        // envMap, one of the heavier shader variants three.js ships) would
        // otherwise only compile lazily on whichever frame first draws them
        // — typically right now, since the model is added and immediately
        // visible (underwater) while the opening camera descent is usually
        // still playing this early after page load. Compiling explicitly
        // here pays that one-time cost in its own call instead of stalling
        // an animation frame. See the matching call in applyEnvironmentMap.
        renderer.compileAsync(scene, camera).catch(() => {})

        bottleFolder = gui.addFolder('Bottle')
        bottleFolder.add(bottleModel.position, 'x', -5, 5, 0.01).name('Position X')
        // Position Y sets the bottle's FINAL resting height once the splash
        // animation settles (see bottleYOffset above) — the hidden/rising/
        // airborne motion is untouched physics; only the settle spring's
        // target moves.
        bottleFolder
          .add(bottleTweaks, 'positionY', -1, 4, 0.01)
          .name('Position Y')
          .onChange((v) => {
            bottleYOffset = v
          })
        bottleFolder.add(bottleModel.position, 'z', -5, 5, 0.01).name('Position Z')
        // Base facing (which side points at the camera at rest) — animate()
        // adds the post-reveal spin below on top of this every frame.
        bottleFolder.add(bottleTweaks, 'facingY', -Math.PI, Math.PI, 0.01).name('Rotation Y')
        bottleFolder
          .add(bottleModel.scale, 'x', scale * 0.5, scale * 2, 0.001)
          .name('Scale')
          .onChange((v) => bottleModel.scale.set(v, v, v))

        const spinFolder = bottleFolder.addFolder('Spin (after reveal)')
        spinFolder.add(spinParams, 'enabled').name('Enabled')
        spinFolder.add(spinParams, 'turns', 0, 4, 0.1).name('Turns')
        spinFolder.add(spinParams, 'duration', 0.5, 12, 0.1).name('Duration (s)')
        spinFolder.add(spinParams, 'tiltAmountZ', 0, 0.6, 0.01).name('Tilt amount Z')

        const gapFolder = bottleFolder.addFolder('Gap (rise from river)')
        gapFolder.add(gapParams, 'enabled').name('Enabled')
        gapFolder.add(gapParams, 'riseAmount', 0, 50, 0.05).name('Rise amount')
        gapFolder.add(gapParams, 'duration', 0.5, 25, 0.1).name('Duration (s)')
        gapFolder.add(gapParams, 'cameraFollow', 0, 1, 0.01).name('Camera follow')
        gapFolder.add(gapParams, 'spinTurns', 0, 4, 0.1).name('Extra spin (turns)')

        // NEW: global material look — see applyBottleMaterialTweaks above.
        const materialFolder = bottleFolder.addFolder('Material')
        materialFolder.add(bottleTweaks, 'metalness', 0, 1, 0.01).name('Metalness').onChange(applyBottleMaterialTweaks)
        materialFolder.add(bottleTweaks, 'roughness', 0, 1, 0.01).name('Roughness').onChange(applyBottleMaterialTweaks)
        materialFolder.add(bottleTweaks, 'clearcoat', 0, 1, 0.01).name('Clearcoat').onChange(applyBottleMaterialTweaks)
        materialFolder
          .add(bottleTweaks, 'clearcoatRoughness', 0, 1, 0.01)
          .name('Clearcoat roughness')
          .onChange(applyBottleMaterialTweaks)
        materialFolder.addColor(bottleTweaks, 'color').name('Color (base mesh)').onChange(applyBottleMaterialTweaks)
      },
      undefined,
      (error) => console.warn('[Seawave] failed to load bottle model', error)
    )

    // =====================================================================
    //  Sky cloud layers. Each authored cloud-bank asset is loaded once and
    //  expanded into several offset/scaled InstancedMesh copies for a
    //  denser, layered sky at effectively zero extra draw-call cost (see
    //  buildCloudInstances below). clouds.glb and plane_clouds.glb pack
    //  their reference textures differently (density+green-key vs. plain
    //  grayscale luminance-on-black), so each gets its own fragment shader,
    //  but both share this instancing/placement machinery and the same
    //  "premium dusk sky" colour grading (shadeCloud in
    //  includes/cloudShading.glsl) so they read as one consistent sky.
    // =====================================================================
    const cloudLayerRefs = [] // { model, uniforms } per loaded layer — read by syncCloudSkyColors, the bloom-hide pass, the per-frame tone sync, and unmount cleanup below

    const syncCloudSkyColors = () => {
      cloudLayerRefs.forEach((ref) => {
        ref.uniforms.uSkyTopColor.value.set(bgParams.topColor)
        ref.uniforms.uSkyHorizonColor.value.set(bgParams.bottomColor)
      })
    }

    // Computes each instance's local (group-relative) matrix from the
    // original single mesh's own authored TRS, nudged along ITS OWN local
    // right/up/forward axes (derived from its authored rotation) by
    // fractions of ITS OWN local size — not raw world units — so offsets
    // scale correctly however a given source asset is exported. `def.fade`
    // (0..1) feeds each instance's aInstanceFade attribute (see
    // clouds/vertex.glsl + both fragment shaders): lower = hazier, pushed
    // toward the sky tone, for a cheap layered atmospheric-depth read.
    const buildCloudInstances = (originalMesh, instanceDefs) => {
      const cloudGeometry = originalMesh.geometry
      cloudGeometry.computeBoundingBox()
      const localSize = new THREE.Vector3()
      cloudGeometry.boundingBox.getSize(localSize)

      const basePos = originalMesh.position.clone()
      const baseQuat = originalMesh.quaternion.clone()
      const baseScale = originalMesh.scale.clone()
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(baseQuat)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuat)
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(baseQuat)
      const spanX = localSize.x * baseScale.x
      const spanY = localSize.y * baseScale.y
      const spanZ = localSize.z * baseScale.z

      const fadeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instanceDefs.length), 1)
      const instanceMat4 = new THREE.Matrix4()
      const instancePos = new THREE.Vector3()
      const instanceScale = new THREE.Vector3()
      const matrices = instanceDefs.map((def, i) => {
        instancePos
          .copy(basePos)
          .addScaledVector(right, def.dx * spanX)
          .addScaledVector(up, def.dy * spanY)
          .addScaledVector(fwd, def.dz * spanZ)
        instanceScale.copy(baseScale).multiplyScalar(def.scale)
        instanceMat4.compose(instancePos, baseQuat, instanceScale)
        fadeAttribute.setX(i, def.fade)
        return instanceMat4.clone()
      })

      return { cloudGeometry, matrices, fadeAttribute }
    }

    // Loads one cloud-bank asset and wires it up exactly like the original
    // single-layer implementation did — same GUI shape, same instancing —
    // just parameterised per layer so a second (or third) asset is one more
    // call instead of a second copy of ~200 lines.
    const createCloudLayer = ({
      url,
      fragmentShader,
      instanceDefs,
      folderLabel,
      defaultHeightMin,
      defaultHeightMax,
      // Starting values for the GUI tweaks below — tuned live via the
      // "Copy values" button in each layer's folder, then baked back in
      // here so the layer starts in that tuned spot instead of at (0,0,0)
      // every reload.
      initialOffset = { x: 0, y: 0, z: 0 },
      initialOpacity = 1.0,
      initialScale = 1.0,
      // Independent per-axis multipliers stacked on top of `scale` (which
      // stays uniform) — let a layer be stretched/squeezed along one axis
      // without affecting the others. Neutral at 1.0.
      initialScaleX = 1.0,
      initialScaleY = 1.0,
      initialSilverStrength = 0.32,
      initialShadowDepth = 0.52,
      // Neutral at 1.0/0.0 — a layer that doesn't pass these renders exactly
      // as before. `solidity` >1 makes the cloud read less transparent
      // (scales the base alpha up before coverage/key/instance-fade gate
      // it); `coolTint` blends the body toward the purple accent colour for
      // a moodier, more blue-violet cast. See shadeCloud in
      // includes/cloudShading.glsl.
      initialSolidity = 1.0,
      initialCoolTint = 0.0,
      // Overrides for the height-gradient sliders, applied after the
      // bounds-derived defaults below — null means "use the model's own
      // computed bounds", same as before this param existed.
      initialHeightMin = null,
      initialHeightMax = null,
      // Parallax: world-unit offset this layer drifts by, scaled by
      // bottleScrollProgress (0 at the start of the bottle's launch
      // sequence, 1 once it's fully risen/spun/settled at the top of its
      // gap-rise) — same driving signal cameraDriftParams already uses for
      // the camera's own "river drift". Default (0,0,0) = no parallax, so a
      // layer that doesn't opt in holds perfectly still, as before.
      parallaxOffset = { x: 0, y: 0, z: 0 },
      // When true, the cloud body reads fully opaque with only the outer
      // silhouette softly feathered into the sky — see uOpaque in
      // clouds/fragment.glsl.
      opaque = false,
    }) => {
      const layerUniforms = {
        uOpacity: { value: initialOpacity },
        uSkyTopColor: { value: new THREE.Color(bgParams.topColor) },
        uSkyHorizonColor: { value: new THREE.Color(bgParams.bottomColor) },
        uHeightMin: { value: defaultHeightMin },
        uHeightMax: { value: defaultHeightMax },
        uSunDirection: { value: uniforms.uSunDirection.value.clone() },
        uSunColor: { value: uniforms.uSunColor.value.clone() },
        uAccentWarm: { value: uniforms.uOrangeColor.value.clone() },
        uAccentCool: { value: uniforms.uPurpleColor.value.clone() },
        uSilverStrength: { value: initialSilverStrength },
        uShadowDepth: { value: initialShadowDepth },
        uSolidity: { value: initialSolidity },
        uCoolTint: { value: initialCoolTint },
        uOpaque: { value: opaque ? 1.0 : 0.0 },
      }
      const ref = {
        model: null,
        uniforms: layerUniforms,
        basePosition: null, // set once the model loads — read by animate()'s parallax update
        tweaks: null,
        parallaxOffset: new THREE.Vector3(parallaxOffset.x, parallaxOffset.y, parallaxOffset.z),
      }
      cloudLayerRefs.push(ref)

      const tweaks = {
        visible: true,
        offsetX: initialOffset.x,
        offsetY: initialOffset.y,
        offsetZ: initialOffset.z,
        opacity: initialOpacity,
        scale: initialScale,
        scaleX: initialScaleX,
        scaleY: initialScaleY,
        silverStrength: layerUniforms.uSilverStrength.value,
        shadowDepth: layerUniforms.uShadowDepth.value,
        solidity: layerUniforms.uSolidity.value,
        coolTint: layerUniforms.uCoolTint.value,
        heightMin: layerUniforms.uHeightMin.value,
        heightMax: layerUniforms.uHeightMax.value,
      }

      gltfLoader.load(
        url,
        (gltf) => {
          if (disposed) return // effect cleaned up before the load resolved

          // Use the model exactly as authored — its own baked position,
          // rotation, and scale — with no transform overrides of ours. The
          // GUI position tweak below is applied as an OFFSET from this
          // authored base position, not a replacement of it.
          const model = gltf.scene

          const originalMesh = model.children.find((child) => child.isMesh)
          if (!originalMesh) {
            console.warn(`[Seawave] ${url} has no mesh to instance`)
            return
          }

          const sourceMaterial = Array.isArray(originalMesh.material) ? originalMesh.material[0] : originalMesh.material
          const map = sourceMaterial?.map ?? null
          if (map) {
            // Reference textures pack DATA (density / luminance / matte),
            // not colour — an sRGB decode on sample would gamma-warp those
            // raw 0..1 values before either fragment shader's thresholds
            // ever see them. Sample as raw linear data instead.
            map.colorSpace = THREE.NoColorSpace
          }
          const cloudMaterial = new THREE.ShaderMaterial({
            vertexShader: cloudsVertex,
            fragmentShader,
            uniforms: {
              uMap: { value: map },
              ...layerUniforms,
            },
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
          })
          sourceMaterial.map = null
          sourceMaterial.dispose()
          if (map && !cloudMaterial.uniforms.uMap.value) {
            map.dispose()
          }

          const { cloudGeometry, matrices, fadeAttribute } = buildCloudInstances(originalMesh, instanceDefs)
          const cloudInstancedMesh = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, instanceDefs.length)
          cloudInstancedMesh.renderOrder = 1
          // Instances are spread well beyond the shared geometry's own local
          // bounds — InstancedMesh's automatic frustum culling only tests
          // that single untransformed bound, so it can wrongly cull visible
          // instances. Trivial vertex count here, so just always draw.
          cloudInstancedMesh.frustumCulled = false
          matrices.forEach((m, i) => cloudInstancedMesh.setMatrixAt(i, m))
          cloudInstancedMesh.instanceMatrix.needsUpdate = true
          cloudGeometry.setAttribute('aInstanceFade', fadeAttribute)

          model.remove(originalMesh)
          model.add(cloudInstancedMesh)
          model.visible = tweaks.visible
          ref.model = model
          ref.tweaks = tweaks

          const basePosition = model.position.clone()
          ref.basePosition = basePosition
          const baseScale = model.scale.clone()
          // Applies the uniform `scale` tweak plus the per-axis `scaleX`/
          // `scaleY` tweaks together — the per-axis multipliers stack on top
          // of scale rather than replacing it, so stretching one axis
          // doesn't undo the overall size tuning.
          const applyModelScale = () => {
            model.scale.set(
              baseScale.x * tweaks.scale * tweaks.scaleX,
              baseScale.y * tweaks.scale * tweaks.scaleY,
              baseScale.z * tweaks.scale
            )
          }
          const bounds = new THREE.Box3().setFromObject(model)
          layerUniforms.uHeightMin.value = bounds.min.y
          layerUniforms.uHeightMax.value = bounds.max.y
          tweaks.heightMin = bounds.min.y
          tweaks.heightMax = bounds.max.y
          if (initialHeightMin !== null) {
            tweaks.heightMin = initialHeightMin
            layerUniforms.uHeightMin.value = initialHeightMin
          }
          if (initialHeightMax !== null) {
            tweaks.heightMax = initialHeightMax
            layerUniforms.uHeightMax.value = initialHeightMax
          }
          syncCloudSkyColors()

          // Apply the initial offset/scale tweaks (see createCloudLayer's
          // initialOffset/initialScale params) so the layer starts at its
          // tuned spot instead of the raw authored position — same maths
          // the offsetX/Y/Z and scale GUI controls below use.
          model.position.set(
            basePosition.x + tweaks.offsetX,
            basePosition.y + tweaks.offsetY,
            basePosition.z + tweaks.offsetZ
          )
          applyModelScale()

          scene.add(model)
          // PERF: same reasoning as the bottle's compileAsync call above —
          // precompile this layer's ShaderMaterial now instead of letting it
          // compile lazily on the first frame it's actually drawn (which,
          // for a layer that loads during the opening camera descent, would
          // otherwise stall that animation).
          renderer.compileAsync(scene, camera).catch(() => {})

          const folder = gui.addFolder(folderLabel)

          // Copy button: same pattern as the top-level "Export values" /
          // splash "Copy splash values" — dumps this layer's own tweaks
          // (position offset, scale, opacity, silver/shadow, height
          // gradient) as JSON to the console + clipboard, so tuned values
          // can be pasted back in as new defaults.
          let cloudExportController
          const exportCloudValues = () => {
            const json = JSON.stringify(tweaks, null, 2)
            console.log(`[Seawave] Exported ${folderLabel} values:\n` + json)
            navigator.clipboard?.writeText(json).catch(() => {})

            if (cloudExportController) {
              cloudExportController.name('Copied to clipboard ✓')
              setTimeout(() => cloudExportController.name('Copy values'), 1200)
            }
          }
          cloudExportController = folder.add({ copy: exportCloudValues }, 'copy').name('Copy values')

          folder
            .add(tweaks, 'visible')
            .name('Visible')
            .onChange((v) => {
              model.visible = v
            })
          folder
            .add(tweaks, 'offsetX', -30, 30, 0.1)
            .name('Position X offset')
            .onChange((v) => {
              model.position.x = basePosition.x + v
            })
          folder
            .add(tweaks, 'offsetY', -30, 30, 0.1)
            .name('Position Y offset')
            .onChange((v) => {
              model.position.y = basePosition.y + v
            })
          folder
            .add(tweaks, 'offsetZ', -30, 30, 0.1)
            .name('Position Z offset')
            .onChange((v) => {
              model.position.z = basePosition.z + v
            })
          folder
            .add(tweaks, 'scale', 0.1, 3, 0.01)
            .name('Scale')
            .onChange(() => {
              applyModelScale()
            })
          folder
            .add(tweaks, 'scaleX', 0.1, 3, 0.01)
            .name('Scale X')
            .onChange(() => {
              applyModelScale()
            })
          folder
            .add(tweaks, 'scaleY', 0.1, 3, 0.01)
            .name('Scale Y')
            .onChange(() => {
              applyModelScale()
            })
          folder
            .add(tweaks, 'opacity', 0, 1, 0.01)
            .name('Opacity')
            .onChange((v) => {
              layerUniforms.uOpacity.value = v
            })
          folder
            .add(tweaks, 'silverStrength', 0, 1, 0.01)
            .name('Silver rim strength')
            .onChange((v) => {
              layerUniforms.uSilverStrength.value = v
            })
          folder
            .add(tweaks, 'shadowDepth', 0, 1, 0.01)
            .name('Shadow depth')
            .onChange((v) => {
              layerUniforms.uShadowDepth.value = v
            })
          folder
            .add(tweaks, 'solidity', 0.5, 2, 0.01)
            .name('Solidity (less transparent)')
            .onChange((v) => {
              layerUniforms.uSolidity.value = v
            })
          folder
            .add(tweaks, 'coolTint', 0, 1, 0.01)
            .name('Cool tint (blue-purple)')
            .onChange((v) => {
              layerUniforms.uCoolTint.value = v
            })
          folder
            .add(tweaks, 'heightMin', bounds.min.y - 20, bounds.max.y + 20, 0.1)
            .name('Height gradient min')
            .onChange((v) => {
              layerUniforms.uHeightMin.value = v
            })
          folder
            .add(tweaks, 'heightMax', bounds.min.y - 20, bounds.max.y + 20, 0.1)
            .name('Height gradient max')
            .onChange((v) => {
              layerUniforms.uHeightMax.value = v
            })
        },
        undefined,
        (error) => console.warn(`[Seawave] failed to load ${url}`, error)
      )
    }

    // clouds.glb authors exactly ONE cloud-bank card. The first entry (all
    // zeros, fade 1) reproduces that original single-card look exactly — a
    // pure addition, not a replacement.
    createCloudLayer({
      url: CLOUDS_MODEL_URL,
      fragmentShader: cloudsFragment,
      opaque: true,
      folderLabel: 'Clouds',
      defaultHeightMin: 10.0,
      defaultHeightMax: 24.0,
      // Tuned live via the GUI + "Copy values" — lifts the band clear of
      // the horizon framing established elsewhere in this scene.
      initialOffset: { x: 18.1, y: 3.9, z: -0.8 },
      // Stretches the band along X/Y for a wider, taller sky presence.
      initialScaleX: 1.58,
      initialScaleY: 1.58,
      // Soft transparent edges with grey internal texture — see
      // clouds/fragment.glsl + includes/cloudShading.glsl.
      initialSolidity: 1.25,
      initialShadowDepth: 0.62,
      initialHeightMin: 11.195139500922386,
      initialHeightMax: 27.457361394796006,
      // Parallax: the nearer/primary band drifts up and slightly back as
      // the bottle rises, reinforcing the sense of ascent — see the
      // bottleScrollProgress-driven update in animate().
      parallaxOffset: { x: 1.5, y: 4.0, z: -3.0 },
      instanceDefs: [
        { dx: 0, dy: 0, dz: 0, scale: 1.0, fade: 1.0 }, // the original authored band
        { dx: -0.55, dy: 0.35, dz: 0.18, scale: 0.85, fade: 0.8 },
        { dx: 0.6, dy: 0.5, dz: -0.12, scale: 0.9, fade: 0.75 },
        { dx: -0.2, dy: -0.4, dz: 0.3, scale: 0.7, fade: 0.9 },
        { dx: 0.3, dy: -0.55, dz: -0.22, scale: 0.65, fade: 0.85 },
        { dx: -0.75, dy: 0.7, dz: -0.05, scale: 1.1, fade: 0.55 },
        { dx: 0.8, dy: 0.75, dz: 0.08, scale: 1.05, fade: 0.5 },
      ],
    })

    // plane_clouds.glb — a second, differently-authored cloud-bank card
    // (its own scattered-puff atlas rather than clouds.glb's connected
    // band), layered in for extra density/variety. Same instancing
    // treatment; its own fragment shader keys the source JPEG's black
    // background to alpha (see planeClouds/fragment.glsl) instead of
    // clouds.glb's green-key matte.
    createCloudLayer({
      url: PLANE_CLOUDS_MODEL_URL,
      fragmentShader: planeCloudsFragment,
      folderLabel: 'Clouds (Plane)',
      defaultHeightMin: 10.0,
      defaultHeightMax: 24.0,
      // Tuned live via the GUI + "Copy values" — pulls this layer down and
      // forward relative to its raw authored position (see plane_clouds.glb's
      // own translation, much higher/further back than clouds.glb's).
      initialOffset: { x: 0, y: -21.2, z: 20.1 },
      // Requested: reduce transparency — this layer previously kept the
      // neutral 1.0 default while "Clouds" was already tuned to 2.0, so it
      // read visibly wispier/see-through by comparison. Matches that value.
      initialSolidity: 2.0,
      // Smaller than the "Clouds" layer's parallaxOffset — this layer sits
      // farther back, so it should visibly drift LESS for the same bottle
      // rise, giving the two layers genuine depth separation rather than
      // moving as one flat backdrop.
      parallaxOffset: { x: 0.8, y: 2.0, z: -1.5 },
      instanceDefs: [
        { dx: 0, dy: 0, dz: 0, scale: 1.0, fade: 0.9 }, // the original authored card
        { dx: -0.6, dy: 0.4, dz: 0.2, scale: 0.8, fade: 0.7 },
        { dx: 0.55, dy: 0.45, dz: -0.15, scale: 0.85, fade: 0.65 },
        { dx: -0.25, dy: -0.5, dz: 0.28, scale: 0.6, fade: 0.8 },
        { dx: 0.35, dy: -0.6, dz: -0.2, scale: 0.55, fade: 0.75 },
      ],
    })

    // --- GUI ---
    const perfData = {
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      programs: 0,
    }
    const gui = new GUI({ title: 'Tweaks', closeFolders: true })
    if (!debugEnabled) gui.hide()
    // NEW: any GUI control that affects the baked launch timeline (physics,
    // wobble, splash energy, or the bottle's final Position Y) needs a
    // re-bake to be reflected in the scroll-scrubbed playback —
    // rather than tracking each one individually, lil-gui's onChange bubbles
    // up from every descendant control, so just re-bake on any change at all.
    // bakeLaunchTimeline() itself is a no-op until the bottle has loaded.
    gui.onChange(() => bakeLaunchTimeline())

    // Export button: reads the live value of every uniform (the controls below
    // mutate them in place, so these reads always reflect what's on screen) and
    // dumps it as JSON to the console + clipboard, so tuned values can be pasted
    // back in as the new defaults above. Same pattern as Scene.jsx's GUI.
    let exportController
    const exportValues = () => {
      const u = uniforms
      const data = {
        background: {
          topColor: bgParams.topColor,
          bottomColor: bgParams.bottomColor,
        },
        environmentMap: {
          enabled: envMapParams.enabled,
          intensity: envMapParams.intensity,
          rotation: envMapParams.rotation,
        },
        bigWaves: {
          uBigWavesElevation: u.uBigWavesElevation.value,
          uBigWavesFrequency: { x: u.uBigWavesFrequency.value.x, y: u.uBigWavesFrequency.value.y },
          uBigWavesSpeed: u.uBigWavesSpeed.value,
          uBigWavesSteepness: u.uBigWavesSteepness.value,
        },
        smallWaves: {
          uSmallWavesElevation: u.uSmallWavesElevation.value,
          uSmallWavesFrequency: u.uSmallWavesFrequency.value,
          uSmallWavesSpeed: u.uSmallWavesSpeed.value,
          uSmallIterations: u.uSmallIterations.value,
        },
        color: {
          uDepthColor: `#${u.uDepthColor.value.getHexString()}`,
          uSurfaceColor: `#${u.uSurfaceColor.value.getHexString()}`,
          uColorOffset: u.uColorOffset.value,
          uColorMultiplier: u.uColorMultiplier.value,
        },
        environment: {
          uSkyColor: `#${u.uSkyColor.value.getHexString()}`,
          uHorizonColor: `#${u.uHorizonColor.value.getHexString()}`,
          uGroundColor: `#${u.uGroundColor.value.getHexString()}`,
          uSkyGradient: u.uSkyGradient.value,
          uGroundGradient: u.uGroundGradient.value,
        },
        sun: {
          uSunColor: `#${u.uSunColor.value.getHexString()}`,
          uSunDirection: { x: u.uSunDirection.value.x, y: u.uSunDirection.value.y, z: u.uSunDirection.value.z },
          uSunIntensity: u.uSunIntensity.value,
          uSunSharpness: u.uSunSharpness.value,
        },
        reflection: {
          uFresnelPower: u.uFresnelPower.value,
          uFresnelBias: u.uFresnelBias.value,
          uSpecularStrength: u.uSpecularStrength.value,
          uShininess: u.uShininess.value,
          uDiffuseStrength: u.uDiffuseStrength.value,
        },
        light: {
          uLightColor: `#${u.uLightColor.value.getHexString()}`,
          uLightPosition: { x: u.uLightPosition.value.x, y: u.uLightPosition.value.y, z: u.uLightPosition.value.z },
          uLightIntensity: u.uLightIntensity.value,
          uMetalShininess: u.uMetalShininess.value,
        },
        bottleLighting: {
          hemi: {
            skyColor: `#${bottleHemiLight.color.getHexString()}`,
            groundColor: `#${bottleHemiLight.groundColor.getHexString()}`,
            intensity: bottleHemiLight.intensity,
            position: { x: bottleHemiLight.position.x, y: bottleHemiLight.position.y, z: bottleHemiLight.position.z },
          },
          key: {
            color: `#${bottleKeyLight.color.getHexString()}`,
            intensity: bottleKeyLight.intensity,
            position: { x: bottleKeyLight.position.x, y: bottleKeyLight.position.y, z: bottleKeyLight.position.z },
          },
          orange: {
            color: `#${bottleOrangeLight.color.getHexString()}`,
            intensity: bottleOrangeLight.intensity,
            position: { x: bottleOrangeLight.position.x, y: bottleOrangeLight.position.y, z: bottleOrangeLight.position.z },
          },
          purple: {
            color: `#${bottlePurpleLight.color.getHexString()}`,
            intensity: bottlePurpleLight.intensity,
            position: { x: bottlePurpleLight.position.x, y: bottlePurpleLight.position.y, z: bottlePurpleLight.position.z },
          },
          cameraBackLight: {
            enabled: cameraLightParams.enabled,
            color: `#${cameraLight.color.getHexString()}`,
            intensity: cameraLightParams.intensity,
            distanceBehind: cameraLightParams.distanceBehind,
          },
        },
      }

      const json = JSON.stringify(data, null, 2)
      console.log('[Seawave] Exported tweak values:\n' + json)
      navigator.clipboard?.writeText(json).catch(() => {})

      if (exportController) {
        exportController.name('Copied to clipboard ✓')
        setTimeout(() => exportController.name('Export values'), 1200)
      }
    }
    exportController = gui.add({ export: exportValues }, 'export').name('Export values')

    // Colors are bound through hex proxies (lil-gui addColor) that write back
    // into the THREE.Color uniforms on change.
    const colorParams = {
      depthColor: `#${uniforms.uDepthColor.value.getHexString()}`,
      surfaceColor: `#${uniforms.uSurfaceColor.value.getHexString()}`,
      sunColor: `#${uniforms.uSunColor.value.getHexString()}`,
      skyColor: `#${uniforms.uSkyColor.value.getHexString()}`,
      horizonColor: `#${uniforms.uHorizonColor.value.getHexString()}`,
      groundColor: `#${uniforms.uGroundColor.value.getHexString()}`,
      lightColor: `#${uniforms.uLightColor.value.getHexString()}`,
      bottleHemiSkyColor: `#${bottleHemiLight.color.getHexString()}`,
      bottleHemiGroundColor: `#${bottleHemiLight.groundColor.getHexString()}`,
      bottleKeyColor: `#${bottleKeyLight.color.getHexString()}`,
      bottleOrangeColor: `#${bottleOrangeLight.color.getHexString()}`,
      bottlePurpleColor: `#${bottlePurpleLight.color.getHexString()}`,
      cameraLightColor: `#${cameraLight.color.getHexString()}`,
    }

    const bigWaves = gui.addFolder('Fluid flow')
    bigWaves.add(uniforms.uBigWavesElevation, 'value', 0, 0.5, 0.001).name('Amplitude')
    bigWaves.add(uniforms.uBigWavesFrequency.value, 'x', 0, 6, 0.01).name('Frequency X')
    bigWaves.add(uniforms.uBigWavesFrequency.value, 'y', 0, 6, 0.01).name('Frequency Y')
    bigWaves.add(uniforms.uBigWavesSpeed, 'value', 0, 3, 0.01).name('Speed')
    bigWaves.add(uniforms.uBigWavesSteepness, 'value', 0, 1, 0.01).name('Flow (X-Z)')

    const smallWaves = gui.addFolder('Surface ripple')
    smallWaves.add(uniforms.uSmallWavesElevation, 'value', 0, 0.3, 0.001).name('Strength')
    smallWaves.add(uniforms.uSmallWavesFrequency, 'value', 0, 10, 0.01).name('Frequency')
    smallWaves.add(uniforms.uSmallWavesSpeed, 'value', 0, 2, 0.01).name('Speed')
    smallWaves.add(uniforms.uSmallIterations, 'value', 0, 6, 1).name('Iterations')

    const bgFolder = gui.addFolder('Scene background')
    bgFolder
      .addColor(bgParams, 'topColor')
      .name('Top')
      .onChange(() => {
        drawBackgroundGradient()
        syncCloudSkyColors()
      })
    bgFolder
      .addColor(bgParams, 'bottomColor')
      .name('Bottom')
      .onChange(() => {
        drawBackgroundGradient()
        syncCloudSkyColors()
      })

    // The real image-based reflections on the bottle (px/nx/py/ny/pz/nz.png,
    // PMREM-prefiltered — see applyEnvironmentMap above). Separate from the
    // "Environment" folder further below, which tunes the SEA's own procedural
    // sky/horizon/ground look, not this cube map.
    const envMapFolder = gui.addFolder('Environment map')
    envMapFolder.add(envMapParams, 'enabled').name('Enabled').onChange(() => applyEnvironmentMap())
    envMapFolder.add(envMapParams, 'intensity', 0, 3, 0.01).name('Intensity').onChange(() => updateEnvMapLook())
    envMapFolder.add(envMapParams, 'rotation', -Math.PI, Math.PI, 0.01).name('Rotation').onChange(() => updateEnvMapLook())

    const colorFolder = gui.addFolder('Metal color')
    colorFolder.addColor(colorParams, 'depthColor').name('Depth').onChange((v) => uniforms.uDepthColor.value.set(v))
    colorFolder.addColor(colorParams, 'surfaceColor').name('Surface').onChange((v) => uniforms.uSurfaceColor.value.set(v))
    colorFolder.add(uniforms.uColorOffset, 'value', -1, 1, 0.01).name('Offset')
    colorFolder.add(uniforms.uColorMultiplier, 'value', 0, 10, 0.01).name('Multiplier')

    const envFolder = gui.addFolder('Environment')
    envFolder.addColor(colorParams, 'skyColor').name('Sky').onChange((v) => uniforms.uSkyColor.value.set(v))
    envFolder.addColor(colorParams, 'horizonColor').name('Horizon').onChange((v) => uniforms.uHorizonColor.value.set(v))
    envFolder.addColor(colorParams, 'groundColor').name('Ground').onChange((v) => uniforms.uGroundColor.value.set(v))
    envFolder.add(uniforms.uSkyGradient, 'value', 0.05, 4, 0.01).name('Sky gradient')
    envFolder.add(uniforms.uGroundGradient, 'value', 0.05, 4, 0.01).name('Ground gradient')

    const sunFolder = gui.addFolder('Sun')
    sunFolder.addColor(colorParams, 'sunColor').name('Color').onChange((v) => {
      uniforms.uSunColor.value.set(v)
      sunHelperLight.color.set(v) // keep the direction-helper arrow the same color as the sun
    })

    // Raw XYZ — only the ratio between components matters (the shader
    // normalizes uSunDirection), but a wide range makes it easy to swing
    // the sun close to any axis without the other two fighting for room.
    const dirXCtrl = sunFolder.add(uniforms.uSunDirection.value, 'x', -20, 20, 0.1).name('Direction X')
    const dirYCtrl = sunFolder.add(uniforms.uSunDirection.value, 'y', -20, 20, 0.1).name('Direction Y')
    const dirZCtrl = sunFolder.add(uniforms.uSunDirection.value, 'z', -20, 20, 0.1).name('Direction Z')

    // Rotation — azimuth (around Y) / elevation (above horizon), the more
    // intuitive way to "spin" the sun. Kept in sync both ways with the raw
    // XYZ controls above: dragging either representation updates the other.
    const sunAngles = { azimuth: 0, elevation: 0 }
    const readAnglesFromDirection = () => {
      const dir = uniforms.uSunDirection.value.clone().normalize()
      sunAngles.azimuth = THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x))
      sunAngles.elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)))
    }
    readAnglesFromDirection()

    const syncFromDirection = () => {
      readAnglesFromDirection()
      azimuthCtrl.updateDisplay()
      elevationCtrl.updateDisplay()
    }
    dirXCtrl.onChange(syncFromDirection)
    dirYCtrl.onChange(syncFromDirection)
    dirZCtrl.onChange(syncFromDirection)

    const applyAnglesToDirection = () => {
      const az = THREE.MathUtils.degToRad(sunAngles.azimuth)
      const el = THREE.MathUtils.degToRad(sunAngles.elevation)
      const len = uniforms.uSunDirection.value.length() || 1
      uniforms.uSunDirection.value
        .set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
        .multiplyScalar(len)
      dirXCtrl.updateDisplay()
      dirYCtrl.updateDisplay()
      dirZCtrl.updateDisplay()
    }
    const azimuthCtrl = sunFolder.add(sunAngles, 'azimuth', -180, 180, 0.1).name('Rotation (Azimuth)').onChange(applyAnglesToDirection)
    const elevationCtrl = sunFolder.add(sunAngles, 'elevation', -90, 90, 0.1).name('Rotation (Elevation)').onChange(applyAnglesToDirection)

    sunFolder.add(uniforms.uSunIntensity, 'value', 0, 20, 0.01).name('Intensity')
    sunFolder.add(uniforms.uSunSharpness, 'value', 1, 1000, 1).name('Sharpness')

    const reflectFolder = gui.addFolder('Reflection')
    reflectFolder.add(uniforms.uFresnelPower, 'value', 0.1, 10, 0.01).name('Fresnel power')
    reflectFolder.add(uniforms.uFresnelBias, 'value', 0, 1, 0.01).name('Fresnel bias')
    reflectFolder.add(uniforms.uSpecularStrength, 'value', 0, 10, 0.01).name('Specular')
    reflectFolder.add(uniforms.uShininess, 'value', 1, 1000, 1).name('Shininess')
    reflectFolder.add(uniforms.uDiffuseStrength, 'value', 0, 1, 0.01).name('Diffuse')

    const lightFolder = gui.addFolder('Metal light')
    lightFolder.addColor(colorParams, 'lightColor').name('Color').onChange((v) => uniforms.uLightColor.value.set(v))
    lightFolder.add(uniforms.uLightPosition.value, 'x', -15, 15, 0.1).name('Position X')
    lightFolder.add(uniforms.uLightPosition.value, 'y', 0, 15, 0.1).name('Position Y')
    lightFolder.add(uniforms.uLightPosition.value, 'z', -15, 15, 0.1).name('Position Z')
    lightFolder.add(uniforms.uLightIntensity, 'value', 0, 5, 0.01).name('Intensity')
    lightFolder.add(uniforms.uMetalShininess, 'value', 1, 500, 1).name('Glint sharpness')

    // Controls for the two real THREE.Light objects that light the bottle
    // (the sea's ShaderMaterial ignores these — see 'Bottle lights' above).
    const bottleLightFolder = gui.addFolder('Bottle lighting')
    const hemiFolder = bottleLightFolder.addFolder('Hemisphere (fill)')
    hemiFolder.addColor(colorParams, 'bottleHemiSkyColor').name('Sky color').onChange((v) => bottleHemiLight.color.set(v))
    hemiFolder
      .addColor(colorParams, 'bottleHemiGroundColor')
      .name('Ground color')
      .onChange((v) => bottleHemiLight.groundColor.set(v))
    hemiFolder.add(bottleHemiLight, 'intensity', 0, 5, 0.01).name('Intensity')
    hemiFolder.add(bottleHemiLight.position, 'x', -15, 15, 0.1).name('Position X')
    hemiFolder.add(bottleHemiLight.position, 'y', -15, 15, 0.1).name('Position Y')
    hemiFolder.add(bottleHemiLight.position, 'z', -15, 15, 0.1).name('Position Z')

    const keyFolder = bottleLightFolder.addFolder('Directional (key)')
    keyFolder.addColor(colorParams, 'bottleKeyColor').name('Color').onChange((v) => bottleKeyLight.color.set(v))
    keyFolder.add(bottleKeyLight, 'intensity', 0, 10, 0.01).name('Intensity')
    keyFolder.add(bottleKeyLight.position, 'x', -15, 15, 0.1).name('Position X')
    keyFolder.add(bottleKeyLight.position, 'y', -15, 15, 0.1).name('Position Y')
    keyFolder.add(bottleKeyLight.position, 'z', -15, 15, 0.1).name('Position Z')

    // NEW: same tweak set for the two coloured accent directional lights.
    const orangeFolder = bottleLightFolder.addFolder('Directional (orange)')
    orangeFolder.addColor(colorParams, 'bottleOrangeColor').name('Color').onChange((v) => bottleOrangeLight.color.set(v))
    orangeFolder.add(bottleOrangeLight, 'intensity', 0, 10, 0.01).name('Intensity')
    orangeFolder.add(bottleOrangeLight.position, 'x', -15, 15, 0.1).name('Position X')
    orangeFolder.add(bottleOrangeLight.position, 'y', -15, 15, 0.1).name('Position Y')
    orangeFolder.add(bottleOrangeLight.position, 'z', -15, 15, 0.1).name('Position Z')

    const purpleFolder = bottleLightFolder.addFolder('Directional (purple)')
    purpleFolder.addColor(colorParams, 'bottlePurpleColor').name('Color').onChange((v) => bottlePurpleLight.color.set(v))
    purpleFolder.add(bottlePurpleLight, 'intensity', 0, 10, 0.01).name('Intensity')
    purpleFolder.add(bottlePurpleLight.position, 'x', -15, 15, 0.1).name('Position X')
    purpleFolder.add(bottlePurpleLight.position, 'y', -15, 15, 0.1).name('Position Y')
    purpleFolder.add(bottlePurpleLight.position, 'z', -15, 15, 0.1).name('Position Z')

    // NEW: camera back light — see cameraLightParams/cameraLight above.
    // Position isn't exposed (it's recomputed every frame from the camera),
    // only the things that actually stay author-controlled.
    const cameraLightFolder = bottleLightFolder.addFolder('Camera back light')
    cameraLightFolder.add(cameraLightParams, 'enabled').name('Enabled')
    cameraLightFolder.addColor(colorParams, 'cameraLightColor').name('Color').onChange((v) => cameraLight.color.set(v))
    cameraLightFolder
      .add(cameraLightParams, 'intensity', 0, 10, 0.01)
      .name('Intensity')
      .onChange((v) => (cameraLight.intensity = v))
    cameraLightFolder.add(cameraLightParams, 'distanceBehind', 0, 15, 0.1).name('Distance behind camera')

    // --- NEW: Splash / bottle-interaction controls ----------------------
    const splashToggles = { interaction: true }
    const splashFolder = gui.addFolder('Splash')
    // NEW: playback is scroll-scrubbed now (see the baked timeline above), so
    // these just move the actual page scroll for a quick GUI preview instead
    // of directly poking the animation state.
    splashFolder
      .add(
        {
          preview: () => {
            const el = sectionRef.current
            if (!el) return
            window.scrollTo({ top: el.offsetTop + el.offsetHeight - window.innerHeight, behavior: 'smooth' })
          },
        },
        'preview'
      )
      .name('▶ Scrub to end')
    splashFolder
      .add(
        {
          reset: () => {
            const el = sectionRef.current
            window.scrollTo({ top: el ? el.offsetTop : 0, behavior: 'smooth' })
          },
        },
        'reset'
      )
      .name('◀ Scrub to start')

    // Copy button: same pattern as the top-level "Export values" — dumps every
    // splash-only knob (surface response, physics/wobble feel) as
    // JSON to the console + clipboard.
    let splashExportController
    const exportSplashValues = () => {
      const data = {
        surface: {
          uInfluenceRadius: uniforms.uInfluenceRadius.value,
          uBottleRadius: uniforms.uBottleRadius.value,
          uFoamElevation: uniforms.uFoamElevation.value,
          uSplashAmplitude: uniforms.uSplashAmplitude.value,
          uRippleStrength: uniforms.uRippleStrength.value,
          uRippleDuration: uniforms.uRippleDuration.value,
          splashEnergy: splashParams.energy,
          uCrownHeight: crownMaterial.uniforms.uCrownHeight.value,
        },
        physics: { ...physics },
        wobble: { kick: wobble.kick, springK: wobble.springK, springC: wobble.springC },
        spin: { ...spinParams },
      }

      const json = JSON.stringify(data, null, 2)
      console.log('[Seawave] Exported splash values:\n' + json)
      navigator.clipboard?.writeText(json).catch(() => {})

      if (splashExportController) {
        splashExportController.name('Copied to clipboard ✓')
        setTimeout(() => splashExportController.name('Copy splash values'), 1200)
      }
    }
    splashExportController = splashFolder.add({ copy: exportSplashValues }, 'copy').name('Copy splash values')
    splashFolder
      .add(splashToggles, 'interaction')
      .name('Interaction on')
      .onChange((v) => (uniforms.uInteractionEnabled.value = v ? 1 : 0))
    splashFolder.add(uniforms.uInfluenceRadius, 'value', 0.5, 6, 0.05).name('Influence radius')
    splashFolder.add(uniforms.uBottleRadius, 'value', 0.05, 2, 0.01).name('Bottle radius')
    splashFolder.add(uniforms.uFoamElevation, 'value', 0, 2, 0.01).name('Foam turbulence')
    splashFolder.add(uniforms.uSplashAmplitude, 'value', 0, 1, 0.01).name('Splash height')
    splashFolder.add(uniforms.uRippleStrength, 'value', 0, 3, 0.01).name('Ripple strength')
    splashFolder.add(uniforms.uRippleDuration, 'value', 0.5, 8, 0.1).name('Ripple duration (s)')
    splashFolder.add(splashParams, 'energy', 0, 2, 0.01).name('Splash energy')
    splashFolder.add(crownMaterial.uniforms.uCrownHeight, 'value', 0, 2, 0.01).name('Crown height')

    // Physics constants — this is what actually shapes the emerge motion now
    // (see the `physics` object above), so tuning "feel" happens here.
    const physicsFolder = splashFolder.addFolder('Physics')
    physicsFolder.add(physics, 'hiddenDepth', 0, 3, 0.05).name('Hidden depth')
    physicsFolder.add(physics, 'buoyancy', 0, 20, 0.1).name('Buoyancy')
    physicsFolder.add(physics, 'waterDrag', 0.1, 10, 0.1).name('Water drag')
    physicsFolder.add(physics, 'gravity', 0, 20, 0.1).name('Gravity')
    physicsFolder.add(physics, 'airDrag', 0, 5, 0.05).name('Air drag')
    physicsFolder.add(physics, 'springK', 1, 80, 1).name('Float spring')
    physicsFolder.add(physics, 'springC', 0, 30, 0.5).name('Float damping')
    physicsFolder.add(physics, 'surfaceTensionRange', 0, 1.5, 0.01).name('Surface brake range')
    physicsFolder.add(physics, 'surfaceTensionDrag', 0, 20, 0.5).name('Surface brake strength')

    const wobbleFolder = splashFolder.addFolder('Wobble')
    wobbleFolder.add(wobble, 'kick', 0, 1.5, 0.01).name('Impact kick')
    wobbleFolder.add(wobble, 'springK', 5, 100, 1).name('Spring')
    wobbleFolder.add(wobble, 'springC', 0, 30, 0.5).name('Damping')

    // --- NEW: Camera controls -------------------------------------------
    // Tweak the ESTABLISHED shot — cameraEndPosition/cameraEndTarget/
    // cameraEndFov (the framing the opening reveal eases INTO, see
    // cameraRevealParams above and the reveal block in animate()). These are
    // no longer camera.position/cameraTarget/camera.fov directly: animate()
    // now overwrites those every frame (lerping from the reveal's start
    // framing), so a slider bound straight to them would get stomped on the
    // very next frame. `.listen()` still keeps the sliders live since
    // cameraEnd* only change when dragged here. The "Log camera" button
    // dumps this established framing so it can be pasted back as defaults.
    const cameraFolder = gui.addFolder('Camera')
    const camPos = cameraFolder.addFolder('Position')
    camPos.add(cameraEndPosition, 'x', -20, 20, 0.001).name('X').listen(debugEnabled)
    camPos.add(cameraEndPosition, 'y', -20, 20, 0.001).name('Y').listen(debugEnabled)
    camPos.add(cameraEndPosition, 'z', -20, 20, 0.001).name('Z').listen(debugEnabled)
    const camTarget = cameraFolder.addFolder('Target (look-at)')
    camTarget.add(cameraEndTarget, 'x', -20, 20, 0.001).name('X').listen(debugEnabled)
    camTarget.add(cameraEndTarget, 'y', -20, 20, 0.001).name('Y').listen(debugEnabled)
    camTarget.add(cameraEndTarget, 'z', -20, 20, 0.001).name('Z').listen(debugEnabled)
    cameraFolder
      .add({ fov: cameraEndFov }, 'fov', 20, 90, 0.1)
      .name('FOV')
      .onChange((v) => {
        cameraEndFov = v
      })
    cameraFolder
      .add(
        {
          log: () => {
            const data = {
              position: { x: cameraEndPosition.x, y: cameraEndPosition.y, z: cameraEndPosition.z },
              target: { x: cameraEndTarget.x, y: cameraEndTarget.y, z: cameraEndTarget.z },
              fov: cameraEndFov,
            }
            console.log('[Seawave] Camera:\n' + JSON.stringify(data, null, 2))
            navigator.clipboard?.writeText(JSON.stringify(data, null, 2)).catch(() => {})
          },
        },
        'log'
      )
      .name('Log camera (→ clipboard)')

    // The opening descent — top-to-bottom Y-only drop into the established
    // shot — plus how much of the total scroll it (and the breach pacing
    // tied to it) consumes.
    const revealFolder = cameraFolder.addFolder('Reveal (opening descent)')
    revealFolder.add(cameraRevealParams, 'enabled').name('Enabled')
    revealFolder.add(cameraRevealParams, 'fraction', 0.02, 0.6, 0.01).name('Scroll fraction')
    revealFolder.add(cameraRevealParams, 'startY', -5, 20, 0.01).name('Start Y')
    // NEW: extra rotation (degrees) held at the start of the descent and
    // eased out to zero by the time the reveal hands off — see
    // cameraRevealParams.rotationX/Y/Z and the quaternion blend in animate().
    revealFolder.add(cameraRevealParams, 'rotationX', -180, 180, 0.1).name('Rotation X (deg)')
    revealFolder.add(cameraRevealParams, 'rotationY', -180, 180, 0.1).name('Rotation Y (deg)')
    revealFolder.add(cameraRevealParams, 'rotationZ', -180, 180, 0.1).name('Rotation Z (deg)')

    // NEW: back-to-front Z dolly, synced to the same descent (see
    // cameraDollyParams) — the camera pushes in toward the bottle as it
    // finishes falling, instead of staying at a fixed Z the whole way down.
    const dollyFolder = revealFolder.addFolder('Dolly (Z: back to front)')
    dollyFolder.add(cameraDollyParams, 'enabled').name('Enabled')
    dollyFolder.add(cameraDollyParams, 'backOffsetZ', 0, 15, 0.05).name('Back offset Z')

    // NEW: the intro descent (see cameraIntroParams) — scroll-driven, same
    // mechanism as the reveal above but its own earlier fraction, layered on
    // top of the reveal without touching its tuned `startY`.
    const introFolder = cameraFolder.addFolder('Intro (scroll)')
    introFolder.add(cameraIntroParams, 'enabled').name('Enabled')
    introFolder.add(cameraIntroParams, 'fromY', -5, 30, 0.01).name('From Y')
    introFolder.add(cameraIntroParams, 'fraction', 0.01, 0.6, 0.01).name('Scroll fraction')

    // NEW: the continuous drift that plays out DURING the bottle sequence
    // (see cameraDriftParams declaration) — how far the camera/target glide
    // by the time the bottle finishes rising/spinning.
    const driftFolder = cameraFolder.addFolder('Drift (during bottle)')
    driftFolder.add(cameraDriftParams, 'enabled').name('Enabled')
    const driftPos = driftFolder.addFolder('Position offset')
    driftPos.add(cameraDriftParams.position, 'x', -5, 5, 0.01).name('X')
    driftPos.add(cameraDriftParams.position, 'y', -5, 5, 0.01).name('Y')
    driftPos.add(cameraDriftParams.position, 'z', -5, 5, 0.01).name('Z')
    const driftTarget = driftFolder.addFolder('Target offset')
    driftTarget.add(cameraDriftParams.target, 'x', -5, 5, 0.01).name('X')
    driftTarget.add(cameraDriftParams.target, 'y', -5, 5, 0.01).name('Y')
    driftTarget.add(cameraDriftParams.target, 'z', -5, 5, 0.01).name('Z')

    const bloomFolder = gui.addFolder('Bloom')
    bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01).name('Strength')
    bloomFolder.add(bloomPass, 'radius', 0, 1, 0.01).name('Radius')
    bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01).name('Threshold')

    const perf = gui.addFolder('Performance')
    perf.add(perfData, 'drawCalls').name('Draw calls').listen(debugEnabled).disable()
    perf.add(perfData, 'triangles').name('Triangles').listen(debugEnabled).disable()
    perf.add(perfData, 'geometries').name('Geometries').listen(debugEnabled).disable()
    perf.add(perfData, 'textures').name('Textures').listen(debugEnabled).disable()
    perf.add(perfData, 'programs').name('Shader programs').listen(debugEnabled).disable()

    const handleResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
      // Keep the bloom composer at HALF the main composer's size — see the
      // PERF note by its creation above. Also resizes bloomPass's internal
      // mip chain (UnrealBloomPass.setSize is called by EffectComposer).
      bloomComposer.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
      // Resize is rare, so an immediate layout read here (via
      // refreshScrollMetrics) is fine — this is the only place these get
      // recomputed now that updateScrollProgress itself no longer touches
      // layout every frame.
      refreshScrollMetrics()
      updateScrollProgress()
    }
    window.addEventListener('resize', handleResize)

    // PERF: dynamic resolution for the opening camera descent specifically —
    // this is the transient, scroll-driven top-to-bottom move (see
    // cameraIntroParams/cameraRevealParams) where the frame drop keeps being
    // reported. The camera's rotation is FROZEN during this move (see the
    // revealEase/introEase quaternion branch below) and only translates in
    // Y — starting high and pointed the same fixed direction as the final
    // close-up shot, which means the heavy mercury sea shader (several pow()/
    // normalize() calls per pixel — see seawave/fragment.glsl) covers very
    // little of the screen at the top of the descent and sweeps up to
    // covering nearly the whole frame by the time it settles into the
    // established shot. That fill-rate ramp is real, GPU-bound, and repeats
    // on every scroll pass — none of the earlier one-time fixes (shader
    // warm-up, ripple early-out, half-res bloom, scroll-listener batching)
    // touch it, because it isn't a one-time cost or wasted work, it's actual
    // pixels the expensive shader has to run for that grow over the course
    // of the move. Rendering at a reduced pixel ratio ONLY while this move is
    // actively playing cuts that fill-rate cost substantially — exactly
    // where it's needed — while the softness is masked by the camera already
    // being in motion; the instant it settles (revealEase>=1 && introEase>=1)
    // resolution snaps back to full for the static, most-scrutinized close-up
    // shot. Only toggled on the rare state CHANGE (not every frame) since
    // setPixelRatio reallocates render targets.
    const DESCENT_PIXEL_RATIO_SCALE = 0.6
    let dynamicResLowRes = false
    const applyRenderResolution = (lowRes) => {
      if (dynamicResLowRes === lowRes) return
      dynamicResLowRes = lowRes
      const pr = lowRes ? BASE_PIXEL_RATIO * DESCENT_PIXEL_RATIO_SCALE : BASE_PIXEL_RATIO
      renderer.setPixelRatio(pr)
      composer.setPixelRatio(pr)
      bloomComposer.setPixelRatio(pr)
    }

    let frameId
    let lastVirtualTime = 0 // previous frame's position in the baked timeline — used to detect a forward crossing of the breach point
    let lastFrameT = 0 // previous frame's clock.getElapsedTime(), used to derive a per-frame delta for the scroll smoothing below (clock.getDelta() isn't used elsewhere so this avoids double-consuming it)
    // See the reverse-scroll gate comment above (REVERSE_GATE_REARM_FRACTION)
    // — one-shot per approach, only re-armed once scroll is back solidly
    // inside the section, so the gate can never fire back-to-back and read
    // as the page being stuck/locked.
    let reverseGateArmed = true
    const clock = new THREE.Clock()
    const animate = () => {
      if (debugEnabled) stats.begin()
      renderer.info.reset() // composer.render() makes several internal render() calls; see autoReset note above

      const t = clock.getElapsedTime()
      uniforms.uTime.value = t

      // No-Lenis fallback (see lenisActiveRef/markScrollFallbackDirty above)
      // — only ever does anything on a route with no <ReactLenis> ancestor;
      // once Lenis is active this block never runs.
      if (!lenisActiveRef.current && scrollFallbackDirty) {
        lenisScrollRef.current = window.scrollY
        scrollFallbackDirty = false
      }
      // --- Reverse-scroll gate (see REVERSE_GATE_EPSILON above) -----------
      // If the user has physically scrolled/flicked back above this
      // section's top edge while the animation hasn't actually finished
      // reversing yet (scrollProgress still above REVERSE_GATE_EPSILON),
      // ease the real Lenis scroll position back to the edge with a LOCKED
      // tween instead of letting it — and IntroHeroV2 behind it — through.
      // No duration/easing passed here deliberately: omitting them makes
      // Lenis fall back to its OWN configured options.duration/options.easing
      // (see <ReactLenis> in HomeV2Page.jsx) — the exact same tween Lenis
      // already uses for every ordinary wheel/touch scroll on this page, so
      // the correction is indistinguishable in pace/character from the
      // user's own forward scrolling rather than a separate, snappier motion
      // bolted on just for this edge case. `lock: true` blocks further
      // wheel/touch from fighting the tween mid-flight and auto-clears
      // itself (lenis's own `reset()`) the instant the tween completes, so
      // there's no separate stop()/start() bookkeeping needed here. Only
      // ever starts a NEW tween when one isn't already running
      // (`!lenisInst.isLocked`) — Lenis's own scrollTo is a cheap
      // synchronous no-op if the target already matches, so this is safe to
      // check unconditionally every frame. Also gated on `reverseGateArmed`
      // (see its declaration above) so this can only ever fire ONCE per
      // approach — re-armed only once scroll is back solidly inside the
      // section — instead of re-triggering every frame the condition still
      // holds, which is what previously read as the page getting stuck.
      const lenisInst = lenisInstanceRef.current
      if (
        cachedScrollableDistance > 0 &&
        lenisScrollRef.current > cachedSectionTop + cachedScrollableDistance * REVERSE_GATE_REARM_FRACTION
      ) {
        reverseGateArmed = true
      }
      if (
        reverseGateArmed &&
        lenisInst &&
        !lenisInst.isLocked &&
        cachedScrollableDistance > 0 &&
        lenisScrollRef.current < cachedSectionTop &&
        scrollProgress > REVERSE_GATE_EPSILON
      ) {
        reverseGateArmed = false
        lenisInst.scrollTo(cachedSectionTop, { lock: true, force: true })
      }

      // Reads lenisScrollRef.current (kept in sync every Lenis tick — see
      // the useLenis subscription above) — no layout reads here (those are
      // cached in refreshScrollMetrics, only re-run on resize), so this is
      // cheap enough to call unconditionally every frame.
      updateScrollProgress()

      // --- NEW: smooth (Lenis-style) scroll scrub -------------------------
      // Ease `scrollProgress` toward the raw `targetScrollProgress` every
      // frame instead of snapping straight to it. Uses exponential-decay
      // lerp (THREE.MathUtils.lerp with a per-frame alpha derived from real
      // elapsed time, not a fixed 0..1 fraction) so the glide feels identical
      // regardless of frame rate — at 30fps or 144fps it covers the same
      // ground in the same amount of real time, just in fewer/more steps.
      // scrollDt is clamped so a paused/backgrounded tab regaining focus
      // doesn't produce one huge alpha=1 jump (which would look like no
      // smoothing at all on that frame).
      // Direction-based rate (see REVERSE_SCROLL_SMOOTHING above): reversing
      // uses its own, slightly snappier constant than forward, but it's the
      // SAME exponential-decay lerp either way — no separate "boundary mode"
      // — so the motion stays one consistent style throughout, just a bit
      // quicker whenever scrollProgress is trending back down.
      const scrollDt = Math.min(t - lastFrameT, 1 / 15)
      lastFrameT = t
      const isReversing = targetScrollProgress < scrollProgress
      const smoothingRate = isReversing ? REVERSE_SCROLL_SMOOTHING : SCROLL_SMOOTHING
      const scrollLerpAlpha = 1 - Math.exp(-smoothingRate * scrollDt)
      scrollProgress = THREE.MathUtils.lerp(scrollProgress, targetScrollProgress, scrollLerpAlpha)

      // --- Opening camera descent -----------------------------------------
      // First `cameraRevealParams.fraction` of the page's scroll eases
      // camera.position.y down from `startY` to the established Y
      // (cameraEndPosition.y) — X/Z and cameraTarget stay fixed at their
      // established values the whole time (a straight top-to-bottom drop,
      // not a pan/re-aim). Reset every frame, same as before, so drift/
      // gap-follow below always layer on top of this instead of accumulating.
      const revealFraction = THREE.MathUtils.clamp(cameraRevealParams.fraction, 0.001, 0.95)
      const revealT = cameraRevealParams.enabled
        ? THREE.MathUtils.clamp(scrollProgress / revealFraction, 0, 1)
        : 1
      const revealEase = THREE.MathUtils.smoothstep(revealT, 0, 1)
      // Intro descent (see cameraIntroParams): scroll-driven, same mechanism
      // as the reveal below but its own (smaller) fraction of total scroll —
      // eases the EFFECTIVE top of the descent from `fromY` down to
      // `cameraRevealParams.startY`. Doesn't touch cameraRevealParams.startY
      // itself, so the scroll-tied reveal below still measures from that
      // tuned resting value once this stage is past its fraction.
      const introFraction = THREE.MathUtils.clamp(cameraIntroParams.fraction, 0.001, 0.95)
      const introT = cameraIntroParams.enabled
        ? THREE.MathUtils.clamp(scrollProgress / introFraction, 0, 1)
        : 1
      const introEase = THREE.MathUtils.smoothstep(introT, 0, 1)
      const effectiveStartY = THREE.MathUtils.lerp(cameraIntroParams.fromY, cameraRevealParams.startY, introEase)
      // Dolly (see cameraDollyParams) — eases Z forward from
      // cameraEndPosition.z + backOffsetZ down to cameraEndPosition.z, using
      // the SAME revealEase as the Y drop below, so the fall and the push-in
      // finish together at the established shot.
      const dollyZ = cameraDollyParams.enabled
        ? THREE.MathUtils.lerp(cameraEndPosition.z + cameraDollyParams.backOffsetZ, cameraEndPosition.z, revealEase)
        : cameraEndPosition.z
      camera.position.set(
        cameraEndPosition.x,
        THREE.MathUtils.lerp(effectiveStartY, cameraEndPosition.y, revealEase),
        dollyZ
      )
      cameraTarget.copy(cameraEndTarget)
      camera.fov = cameraEndFov
      camera.updateProjectionMatrix()
      // Fallback-only mapping, used below when the camera reveal is disabled
      // or the bake hasn't produced a breach yet (see the virtualTime remap
      // further down, which is what actually drives the bottle whenever the
      // reveal IS enabled). The bottle stays still until scrollProgress
      // reaches BOTTLE_START_SCROLL_FRACTION, then the remaining
      // [BOTTLE_START_SCROLL_FRACTION, 1] scroll range remaps to [0, 1].
      const bottleScrollProgress = THREE.MathUtils.clamp(
        (scrollProgress - BOTTLE_START_SCROLL_FRACTION) / (1 - BOTTLE_START_SCROLL_FRACTION),
        0,
        1
      )
      // NEW: "river" drift (see cameraDriftParams declaration) — applied AFTER
      // the camera is reset to the established shot above (so it layers on
      // top of that shot, not instead of it). Scales with bottleScrollProgress, so it's zero right
      // at hand-off and reaches its full offset by the time the bottle
      // sequence finishes — the camera glides for exactly as long as the
      // bottle acts. NOTE: lookAt is called further below, AFTER the bottle
      // sample is read — the gap-rise camera-follow (see gapParams) needs
      // that sample first, so the final look direction accounts for it too.
      if (cameraDriftParams.enabled) {
        camera.position.addScaledVector(cameraDriftParams.position, bottleScrollProgress)
        cameraTarget.addScaledVector(cameraDriftParams.target, bottleScrollProgress)
      }

      // --- SCROLL SCRUB: sample the baked launch timeline -------------------
      // Replaces the old per-frame physics integration: position, rotation
      // and wobble all come straight out of
      // sampleTimelineAt(virtualTime), where virtualTime is driven by scroll
      // progress instead of real elapsed time (see bakeLaunchTimeline above
      // for why the original force-integrated version can't be scrubbed
      // directly). Ocean waves keep animating on the real clock regardless.
      if (bottleModel && timelineSamples.length > 0) {
        const bx = bottleModel.position.x
        const bz = bottleModel.position.z
        // Live wave height at the bottle's XZ — used only so the collar/crown
        // VFX sit on the actual current sea surface; the bottle's own
        // vertical path is scroll-baked and doesn't depend on this.
        const surfaceY = sampleOceanHeight(bx, bz, uniforms, t)

        // ROOT CAUSE of "bottle doesn't visibly start until the camera
        // reaches the established shot": with a single linear scroll->time
        // mapping across the WHOLE baked timeline (rise + breach + arc +
        // settle + spin + gap), the rise only gets whatever share of scroll
        // matches its share of total TIME — and the spin+gap tail alone is
        // ~11s of a ~17s timeline, so the rise/breach (the only visually
        // legible part while the camera reveal is still playing) got
        // squeezed into a small, LATE slice of scroll that lands well past
        // where the reveal finishes. The bottle was moving the whole time —
        // just invisibly, underwater, for most of the reveal.
        //
        // Fix: two segments, anchored so the BREACH (timelineBreachTime)
        // lands at BREACH_LEAD_FRACTION of the way through the reveal's own
        // scroll range (breachScrollTarget) — a bit BEFORE the camera
        // finishes settling into the established shot, not exactly when it
        // stops, so the bottle is already out of the water and visibly
        // moving for the tail of the camera's own motion. The remaining
        // scroll [breachScrollTarget, 1] plays out the arc/settle/spin/gap
        // tail.
        //
        // IMPORTANT: stitched with a cubic Hermite blend (see `hermite`
        // above), not two plain straight lines. Two lines that just happen
        // to meet at the same point can still have very DIFFERENT SLOPES —
        // the rise segment is physically steep (a multi-second rise
        // compressed into a small scroll window) and the tail segment is
        // much shallower (the long spin/gap sequence spread over most of
        // the remaining scroll). That slope mismatch is a velocity
        // discontinuity: the bottle's rise rate would visibly snap to a
        // different speed the instant it crosses the breach point — the
        // glitch/jump reported right at that spot. Blending the tangent at
        // the shared knot (midSlope, the average of both segments' own
        // slopes) keeps position AND rate-of-change continuous through the
        // whole scrub, so the breach reads as one smooth motion, not two
        // lines glued together.
        const breachScrollTarget = revealFraction * BREACH_LEAD_FRACTION
        let virtualTime
        if (timelineDuration <= 0) {
          virtualTime = 0
        } else if (
          cameraRevealParams.enabled &&
          timelineBreachTime > 0 &&
          breachScrollTarget > 0 &&
          breachScrollTarget < 1
        ) {
          const slope1 = timelineBreachTime / breachScrollTarget
          const slope2 = (timelineDuration - timelineBreachTime) / (1 - breachScrollTarget)
          const midSlope = (slope1 + slope2) / 2
          virtualTime =
            scrollProgress <= breachScrollTarget
              ? hermite(scrollProgress, 0, 0, slope1, breachScrollTarget, timelineBreachTime, midSlope)
              : hermite(scrollProgress, breachScrollTarget, timelineBreachTime, midSlope, 1, timelineDuration, slope2)
        } else {
          virtualTime = bottleScrollProgress * timelineDuration
        }
        const sample = sampleTimelineAt(virtualTime)

        // Real-time splash burst: fire exactly once whenever the scrub
        // crosses the breach point moving FORWARD (mirrors the original
        // one-shot "wasRising" guard). The crown shader keys off the
        // real clock (uTime vs uImpactTime), so the burst always plays out as
        // a crisp real-time event no matter how fast the scroll crossed it.
        if (
          uniforms.uInteractionEnabled.value > 0.5 &&
          timelineBreachTime >= 0 &&
          lastVirtualTime < timelineBreachTime &&
          virtualTime >= timelineBreachTime
        ) {
          uniforms.uImpactTime.value = t
          uniforms.uImpactStrength.value = timelineBreachStrength
        } else if (
          // Mirror of the guard above, for the OPPOSITE crossing — scrolling
          // back up past the breach point re-submerges the bottle. Reuses
          // the EXACT same timelineBreachStrength as the forward emerge
          // (no extra scaling either way) so both directions carry identical
          // splash energy — an earlier fixed/scaled-down reentry value read
          // as either much weaker or much stronger than the emerge, instead
          // of the same event played in reverse.
          uniforms.uInteractionEnabled.value > 0.5 &&
          timelineBreachTime >= 0 &&
          lastVirtualTime >= timelineBreachTime &&
          virtualTime < timelineBreachTime
        ) {
          uniforms.uReentryTime.value = t
          uniforms.uReentryStrength.value = timelineBreachStrength
        }
        lastVirtualTime = virtualTime

        // Publish state to all three materials (shared uniform objects).
        uniforms.uBottlePosition.value.set(bx, surfaceY, bz)
        uniforms.uBottleVelocityY.value = sample.velY
        uniforms.uContact.value = sample.contact
        crownMesh.position.set(bx, surfaceY, bz)
        bottleModel.position.y = sample.baseY + bottleRestingY
        bottleModel.rotation.x = sample.rotX
        bottleModel.rotation.y = bottleTweaks.facingY + sample.rotY
        bottleModel.rotation.z = sample.rotZ

        // NEW: camera rig follows the bottle's final gap rise (see
        // gapParams) — position AND target shift by the SAME amount, which
        // keeps the bottle anchored at a fixed point in frame (centered, not
        // drifting) while the camera itself climbs with it. The water still
        // visibly sinks lower in frame as this happens (it doesn't rise),
        // which is what reads as "the gap increasing" on screen. Applied
        // here (not in the earlier reveal/drift block) because it needs
        // sample.gapRiseY, which only exists once the timeline is sampled.
        if (gapParams.enabled) {
          const gapFollow = sample.gapRiseY * gapParams.cameraFollow
          camera.position.y += gapFollow
          cameraTarget.y += gapFollow
        }
      }
      // Single lookAt for the frame, after every camera contribution above
      // (reveal, drift, gap-follow) has had a chance to move position/target
      // — EXCEPT while the opening reveal OR the intro descent is still
      // playing (revealEase < 1 || introEase < 1): both are pure Y-position
      // drops, so the camera's rotation stays frozen at the established
      // framing (cameraEndQuaternion) instead of swiveling to track
      // cameraTarget from each intermediate height.
      const cameraDescending = revealEase < 1 || introEase < 1
      if (cameraDescending) {
        // NEW: reveal rotation (see cameraRevealParams.rotationX/Y/Z) — an
        // extra tilt/pan/roll offset on top of the frozen established
        // orientation, scaled by (1 - revealEase) so it's at its full
        // configured angle right at the start of the descent and eases back
        // to exactly zero by the time revealEase reaches 1 — the handoff to
        // cameraEndQuaternion (and to the normal lookAt branch below) stays
        // discontinuity-free.
        const rotAmount = 1 - revealEase
        if (rotAmount > 0 && (cameraRevealParams.rotationX || cameraRevealParams.rotationY || cameraRevealParams.rotationZ)) {
          revealExtraEuler.set(
            THREE.MathUtils.degToRad(cameraRevealParams.rotationX) * rotAmount,
            THREE.MathUtils.degToRad(cameraRevealParams.rotationY) * rotAmount,
            THREE.MathUtils.degToRad(cameraRevealParams.rotationZ) * rotAmount,
            'XYZ'
          )
          revealExtraQuaternion.setFromEuler(revealExtraEuler)
          camera.quaternion.copy(cameraEndQuaternion).multiply(revealExtraQuaternion)
        } else {
          camera.quaternion.copy(cameraEndQuaternion)
        }
      } else {
        camera.lookAt(cameraTarget)
      }
      // PERF: see applyRenderResolution's definition above — only touches
      // the renderer/composers on the rare true/false state change.
      applyRenderResolution(cameraDescending)

      // NEW: camera back light — recompute AFTER lookAt, once camera.position/
      // cameraTarget are both final for this frame. Sits `distanceBehind`
      // world units behind the camera along its OWN view direction and
      // points at the same spot the camera is looking at, so it reads as a
      // light mounted on/near the camera rather than one fixed in the scene.
      if (cameraLightParams.enabled) {
        cameraLightViewDir.subVectors(cameraTarget, camera.position).normalize()
        cameraLight.position
          .copy(camera.position)
          .addScaledVector(cameraLightViewDir, -cameraLightParams.distanceBehind)
        cameraLight.target.position.copy(cameraTarget)
        cameraLight.target.updateMatrixWorld()
        cameraLightHelper.update()
      }

      // Keep the sun-direction helper arrow following uSunDirection,
      // however it was last changed (raw XYZ or rotation sliders).
      sunHelperLight.position.copy(uniforms.uSunDirection.value).normalize().multiplyScalar(6)
      sunHelper.update()

      // NEW: feed the two accent lights into the sea shader so they glint and
      // reflect in the mercury like the sun (they still light the bottle as
      // real lights too). Direction toward the light = its position (the
      // light's target is the origin). Keep their helpers in sync as well.
      uniforms.uOrangeDirection.value.copy(bottleOrangeLight.position)
      uniforms.uOrangeColor.value.copy(bottleOrangeLight.color)
      uniforms.uOrangeIntensity.value = bottleOrangeLight.intensity
      uniforms.uPurpleDirection.value.copy(bottlePurpleLight.position)
      uniforms.uPurpleColor.value.copy(bottlePurpleLight.color)
      uniforms.uPurpleIntensity.value = bottlePurpleLight.intensity
      orangeHelper.update()
      purpleHelper.update()
      coatLightHelper.update()

      // Keep cloud tones in sync with the live sea/sky lighting, for every
      // loaded cloud layer.
      cloudLayerRefs.forEach((ref) => {
        ref.uniforms.uSunDirection.value.copy(uniforms.uSunDirection.value)
        ref.uniforms.uSunColor.value.copy(uniforms.uSunColor.value)
        ref.uniforms.uAccentWarm.value.copy(uniforms.uOrangeColor.value)
        ref.uniforms.uAccentCool.value.copy(uniforms.uPurpleColor.value)
      })

      // NEW: clouds start invisible on first paint and fade smoothly in as
      // the opening camera descent (see cameraRevealParams/cameraIntroParams
      // above) settles into the established shot — reuses `revealEase`
      // (already the exact 0->1 eased progress driving the camera's own Y
      // move this frame) rather than a second, separately-timed fade, so the
      // clouds' reveal pace always matches the camera's descent pace exactly,
      // including scrubbing back up (revealEase -> 0 hides them again).
      // ref.tweaks.opacity is the GUI-tuned target/max opacity for the
      // layer; multiplying by revealEase gates it down to 0 at the top of
      // the page without touching that tuned value.
      cloudLayerRefs.forEach((ref) => {
        if (!ref.tweaks) return
        ref.uniforms.uOpacity.value = ref.tweaks.opacity * revealEase
      })

      // Cloud parallax: as the bottle rises through its launch sequence
      // (bottleScrollProgress 0 -> 1, the same signal cameraDriftParams
      // uses for the camera's own drift), each layer drifts toward its own
      // parallaxOffset. Different layers use different offsets (see the
      // createCloudLayer calls below), so the sky reads as several depths
      // moving at different rates rather than one flat backdrop — the
      // actual parallax cue. Position is fully recomputed from
      // basePosition + the live GUI offset each frame (not accumulated),
      // so this can't drift and stays perfectly in sync with manual offset
      // tweaking and with scrolling back down (bottleScrollProgress -> 0
      // smoothly undoes it, same as every other scroll-baked motion here).
      cloudLayerRefs.forEach((ref) => {
        if (!ref.model || !ref.basePosition || !ref.tweaks) return
        ref.model.position.set(
          ref.basePosition.x + ref.tweaks.offsetX + ref.parallaxOffset.x * bottleScrollProgress,
          ref.basePosition.y + ref.tweaks.offsetY + ref.parallaxOffset.y * bottleScrollProgress,
          ref.basePosition.z + ref.tweaks.offsetZ + ref.parallaxOffset.z * bottleScrollProgress
        )
      })

      // Render bloom with the clouds hidden so they never contribute bright
      // pixels to (or receive a glow from) the bloom extraction, then
      // restore whatever visibility the user's gui toggle had set before
      // the main composer draws the normal, un-bloomed clouds on top.
      const cloudsVisibility = cloudLayerRefs.map((ref) => ref.model?.visible ?? false)
      cloudLayerRefs.forEach((ref) => {
        if (ref.model) ref.model.visible = false
      })
      try {
        bloomComposer.render()
      } finally {
        cloudLayerRefs.forEach((ref, i) => {
          if (ref.model) ref.model.visible = cloudsVisibility[i]
        })
      }
      composer.render()

      if (debugEnabled) {
        perfData.drawCalls = renderer.info.render.calls
        perfData.triangles = renderer.info.render.triangles
        perfData.geometries = renderer.info.memory.geometries
        perfData.textures = renderer.info.memory.textures
        perfData.programs = renderer.info.programs?.length ?? 0
        stats.end()
      }
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      // Safety net for the reverse-scroll gate above: if unmount/navigation
      // happens mid-correction-tween, clear Lenis's lock rather than leaving
      // the page unable to accept wheel/touch input. stop() -> start() is a
      // clean way to force isLocked back to false (stop()'s internal reset()
      // clears it) without leaving Lenis itself stopped afterward.
      if (lenisInstanceRef.current?.isLocked) {
        lenisInstanceRef.current.stop()
        lenisInstanceRef.current.start()
      }
      geometry.dispose()
      material.dispose()
      environmentMap?.dispose()
      bgGradientTexture.dispose()
      pmremGenerator.dispose() // safe even if the load callback already disposed it

      // NEW: splash systems
      crownGeometry.dispose()
      crownMaterial.dispose()

      if (bottleModel) {
        bottleModel.traverse((child) => {
          if (!child.isMesh) return
          child.geometry?.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach((mat) => {
            mat.map?.dispose()
            mat.dispose()
          })
        })
      }
      cloudLayerRefs.forEach((ref) => {
        if (!ref.model) return
        ref.model.traverse((child) => {
          if (!child.isMesh) return
          child.geometry?.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach((mat) => {
            mat.uniforms?.uMap?.value?.dispose()
            mat.map?.dispose()
            mat.dispose()
          })
        })
      })
      dracoLoader.dispose()
      ktx2Loader.dispose()

      sunHelper.dispose()
      orangeHelper.dispose()
      purpleHelper.dispose()
      coatLightHelper.dispose()
      cameraLightHelper.dispose()

      // Scroll now comes from lenisScrollRef, kept in sync by the useLenis
      // subscription above (cleaned up by React/useLenis itself) — this
      // just removes the no-Lenis fallback listener (see lenisActiveRef).
      window.removeEventListener('scroll', markScrollFallbackDirty)

      bloomPass.dispose()
      bloomMixPass.material.dispose()
      outputPass.dispose()
      composer.dispose()
      bloomComposer.dispose()
      renderer.dispose()
      gui.destroy()
      if (stats.dom.parentNode === document.body) {
        document.body.removeChild(stats.dom)
      }
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    // Normal-flow section, SCROLL_HEIGHT_VH tall — this is what gives the
    // page somewhere to scroll while the canvas below stays pinned. Scroll
    // position through it drives the baked bottle-launch timeline (see
    // bakeLaunchTimeline/scrollProgress in the effect above). Tune
    // SCROLL_HEIGHT_VH to make the scrub feel faster/slower relative to
    // scroll distance.
    <div ref={sectionRef} style={{ position: 'relative', width: '100%', height: `${SCROLL_HEIGHT_VH}vh` }}>
      {/* Sticky, not fixed: scrolls in as a normal block at the top of the
          section above, pins at the viewport top once it gets there, then
          unsticks and scrolls away with the rest of the section — same
          pattern as SceneV2 (see Scene.v2.css). This is what keeps IntroHeroV2
          fully visible until the user actually scrolls down into this
          section, instead of the sea covering it immediately on mount. */}
      <div
        ref={mountRef}
        style={{ position: 'sticky', top: 0, width: '100%', height: '100vh', overflow: 'hidden' }}
      />
    </div>
  )
}

export default Seawave
