import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import GUI from 'lil-gui'
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl'

// A single flat plane textured with the footer artwork (base / normal / metalness),
// viewed through an orthographic camera pointed straight at it so it reads as a flat
// 2D image — the Three.js replacement for the old <img className="ft-scene__img" />.
//
// The plane is "cover"-fit into its container (fills the frame, cropping overflow,
// like the original object-fit: cover), and the metallic contribution is masked to
// a soft, noise-edged blob that follows the cursor with a fading temporal trail.
// Ported from src/pages/Test.jsx (the two-plane tuning sandbox) down to one plane.

const TEXTURE_BASE = oxygenPublicUrl('/textures/test/')
const NOISE_URL = `${TEXTURE_BASE}perlinnoise.jpg`

// Downscaled from the original 2880x1645 sources (FTbaseimage.png / FTnormalmap.png /
// FTmetalness.png) to 1920x1097 — the footer's Figma spec is 1440x559, so the
// originals were ~2x oversized for any display size. GPU texture upload cost is
// driven by decoded pixel count, not file size, so this cuts the upload work (and
// the one-time warm-up cost in FooterScene's warm-up pass, see below) by more than
// half with no visible quality loss at the footer's on-screen size.
const ALBEDO_URL = `${TEXTURE_BASE}FTbaseimage-1920.png`
const NORMAL_URL = `${TEXTURE_BASE}FTnormalmap-1920.png`
const METALNESS_URL = `${TEXTURE_BASE}FTmetalness-1920.png`

const FRUSTUM_HEIGHT = 2 // world units of vertical view; the plane covers the frame

// Stone backdrop behind the plane — matches --ft-stone (#cacaca) so any sub-pixel
// gap at the crop edge blends into the CSS footer background.
const BACKGROUND_COLOR = 0xcacaca

// Organic reveal mask: a soft circular radius around the cursor, its boundary
// pushed in/out per-angle by the Perlin noise texture so the edge reads as an
// irregular blob rather than a perfect circle.
const MASK_RADIUS = 0.22
const MASK_SOFTNESS = 0.13
const MASK_NOISE_SCALE = 3.0 // higher = finer, more detailed edge noise
const MASK_NOISE_STRENGTH = 0.1
const MASK_NOISE_SPEED = 0.05 // how fast the edge noise drifts/animates over time
const MASK_FOLLOW_EASE = 0.12 // seconds; cursor-follow easing time constant (0 = instant)
// Edge noise is gated by cursor velocity: still cursor = clean edge, fast = turbulent.
const MASK_VELOCITY_GAIN = 0.9 // maps cursor speed (UV/sec) to edge-noise amount [0..1]
const MASK_VELOCITY_SMOOTH = 0.08 // seconds; low-pass smoothing on the measured speed

// Temporal trail: the reveal is stamped into a ping-pong render target every frame
// and multiplied by an exponential decay, so wherever the cursor has been keeps
// glowing and fades out organically instead of snapping to the cursor.
const TRAIL_RESOLUTION = 1024
const TRAIL_PERSISTENCE = 0.27

// Cursor-following point light: the dominant light, sitting just in front of the
// plane at the raycasted cursor position and moving with it every frame. A subtle
// ambient light keeps the rest of the artwork dimly visible outside its falloff.
const CURSOR_LIGHT_HEIGHT = 1.2 // world units in front of the plane (+Z)
const CURSOR_LIGHT_INTENSITY = 2
const CURSOR_LIGHT_DECAY = 6
const AMBIENT_LIGHT_INTENSITY = 3

// Injected once, right after three's own <common> chunk, into the standard
// material fragment shader we patch via onBeforeCompile.
const MASK_UNIFORMS_GLSL = /* glsl */ `
  uniform sampler2D uNoiseMap;
  uniform vec2 uMaskCenter;
  uniform float uMaskRadius;
  uniform float uMaskSoftness;
  uniform float uNoiseScale;
  uniform float uNoiseStrength;
  uniform float uUvAspect;
  uniform float uMaskActive;
  uniform float uTime;       // elapsed seconds, drives the animated edge noise
  uniform float uNoiseSpeed; // edge-noise drift speed
  uniform float uEdgeNoiseAmount; // velocity-driven edge distortion [0..1]
  uniform sampler2D uTrailMap; // accumulated, fading reveal amount per UV (.r)
`

// Injected right after <metalnessmap_fragment>, so `metalnessFactor` already holds
// `metalness * metalnessMap.b` and `vMapUv` is in scope. The base albedo/normal
// shading is untouched — only the metallic contribution is masked by cursor position.
// uMaskActive is 0 until the cursor raycasts onto the plane, so the artwork reads as
// plain (non-metallic) stone by default and the metallic sheen only appears in an
// organic blob following the cursor.
const MASK_APPLY_GLSL = /* glsl */ `
  {
    vec2 maskUv = vMapUv - uMaskCenter;
    maskUv.x *= uUvAspect;
    vec2 noiseUv = vMapUv * uNoiseScale + vec2(uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7);
    float edgeNoise = texture2D(uNoiseMap, noiseUv).r - 0.5;
    float radius = uMaskRadius + edgeNoise * uNoiseStrength * uEdgeNoiseAmount;
    float dist = length(maskUv);
    float revealMask = 1.0 - smoothstep(radius - uMaskSoftness, radius + uMaskSoftness, dist);
    float head = mix(0.0, revealMask, uMaskActive);
    float trail = texture2D(uTrailMap, vMapUv).r;
    float metalMask = max(head, trail);
    metalnessFactor *= metalMask;
  }
`

// --- trail accumulation pass -------------------------------------------------
// A full-screen quad that decays the previous trail buffer and stamps the current
// cursor blob. position is already in clip space (-1..1) for a 2x2 quad, so no
// camera matrix is needed; uv (0..1) maps 1:1 to the plane's map UVs and uMaskCenter.
const TRAIL_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// The stamp reuses the EXACT mask formula from MASK_APPLY_GLSL, but measures distance
// to the SEGMENT from the previous cursor position to the current one. That capsule
// stamp fills the gap between frames on fast moves so the trail stays continuous.
// max(decayedPrev, stamp) keeps a full-intensity head while older areas fade.
const TRAIL_FRAGMENT_GLSL = /* glsl */ `
  uniform sampler2D uPrevTrail;   // last frame's trail buffer (ping-pong source)
  uniform sampler2D uNoiseMap;    // same perlin noise as the mask, for the edge
  uniform vec2 uMaskCenter;       // current cursor UV
  uniform vec2 uPrevMaskCenter;   // cursor UV last frame (tail start of segment)
  uniform float uMaskActive;      // 1 while the cursor is on the plane, else 0
  uniform float uMaskRadius;      // mirrored from the main mask (GUI-tunable)
  uniform float uMaskSoftness;
  uniform float uNoiseScale;
  uniform float uNoiseStrength;
  uniform float uUvAspect;
  uniform float uDecay;           // per-frame persistence, exp(-dt / persistence)
  uniform float uTime;            // elapsed seconds (matches the main shader)
  uniform float uNoiseSpeed;      // edge-noise drift speed (matches the main shader)
  uniform float uEdgeNoiseAmount; // velocity-driven edge distortion (matches main)
  varying vec2 vUv;

  void main() {
    float decayed = texture2D(uPrevTrail, vUv).r * uDecay;

    float stamp = 0.0;
    if (uMaskActive > 0.5) {
      vec2 pa = vUv - uPrevMaskCenter; pa.x *= uUvAspect;
      vec2 ba = uMaskCenter - uPrevMaskCenter; ba.x *= uUvAspect;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      float dist = length(pa - ba * h);

      vec2 noiseUv = vUv * uNoiseScale + vec2(uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7);
      float edgeNoise = texture2D(uNoiseMap, noiseUv).r - 0.5;
      float radius = uMaskRadius + edgeNoise * uNoiseStrength * uEdgeNoiseAmount;
      stamp = 1.0 - smoothstep(radius - uMaskSoftness, radius + uMaskSoftness, dist);
    }

    gl_FragColor = vec4(max(decayed, stamp), 0.0, 0.0, 1.0);
  }
`

export default function FooterScene({ showGui = false }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // The CSS aspect-ratio box can be 0px tall for a frame before layout settles;
    // fall back to a sane size so the camera/renderer never divide by zero.
    const getSize = () => ({
      width: container.clientWidth || 1,
      height: container.clientHeight || 1,
    })

    let { width, height } = getSize()

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setSize(width, height)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BACKGROUND_COLOR)

    const camera = new THREE.OrthographicCamera(
      (-FRUSTUM_HEIGHT * (width / height)) / 2,
      (FRUSTUM_HEIGHT * (width / height)) / 2,
      FRUSTUM_HEIGHT / 2,
      -FRUSTUM_HEIGHT / 2,
      0.1,
      10,
    )
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)

    const gui = showGui ? new GUI({ title: 'Footer Tweaks' }) : null

    // cursorLightHeight isn't a direct three.js property (it's read in
    // handlePointerMove), so it lives on a plain params object the GUI can bind to.
    const params = { cursorLightHeight: CURSOR_LIGHT_HEIGHT }

    // Dominant light: starts centered, moved to the raycasted cursor position below.
    const cursorLight = new THREE.PointLight(
      0xffffff,
      CURSOR_LIGHT_INTENSITY,
      0,
      CURSOR_LIGHT_DECAY,
    )
    cursorLight.position.set(0, 0, params.cursorLightHeight)
    scene.add(cursorLight)

    // Flat fill so the artwork doesn't go fully black outside the cursor light.
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY)
    scene.add(ambientLight)

    if (gui) {
      const lightingFolder = gui.addFolder('Lighting')
      lightingFolder.add(params, 'cursorLightHeight', 0.1, 10, 0.05).name('Cursor Light Height')
      lightingFolder.add(cursorLight, 'intensity', 0, 50, 0.1).name('Cursor Light Intensity')
      lightingFolder.add(cursorLight, 'decay', 0, 10, 0.1).name('Cursor Light Decay')
      lightingFolder.add(ambientLight, 'intensity', 0, 3, 0.01).name('Ambient Intensity')
    }

    const textureLoader = new THREE.TextureLoader()
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

    // Shader compilation (the onBeforeCompile patch below) and the GPU's first
    // texture upload are both deferred by WebGL to the first real draw call.
    // Left alone, that first draw call lands exactly when the IntersectionObserver
    // below fires — i.e. mid-scroll, right as the footer reaches the viewport —
    // and the two multi-megabyte PNGs (base image + normal map) plus a custom
    // shader compile show up as a single frame that takes hundreds of ms (the
    // reported 1fps stall). scheduleWarmUp() (defined further down) pays that
    // cost once every texture has decoded, at browser idle time, while the
    // canvas is still visibility:hidden — so it's invisible and off the scroll path.
    let texturesLoaded = 0
    const TEXTURE_COUNT = 4
    const onTextureLoaded = () => {
      texturesLoaded += 1
      if (texturesLoaded === TEXTURE_COUNT) scheduleWarmUp()
    }

    // Perlin noise shared by the mask edge and the trail stamp.
    const noiseMap = textureLoader.load(NOISE_URL, onTextureLoaded)
    noiseMap.wrapS = noiseMap.wrapT = THREE.RepeatWrapping
    noiseMap.anisotropy = maxAnisotropy

    const albedoMap = textureLoader.load(ALBEDO_URL, onTextureLoaded)
    albedoMap.colorSpace = THREE.SRGBColorSpace
    const normalMap = textureLoader.load(NORMAL_URL, onTextureLoaded)
    const metalnessMap = textureLoader.load(METALNESS_URL, onTextureLoaded)
    ;[albedoMap, normalMap, metalnessMap].forEach((tex) => {
      tex.anisotropy = maxAnisotropy
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    })

    const material = new THREE.MeshStandardMaterial({
      map: albedoMap,
      normalMap,
      metalnessMap,
      metalness: 0.97,
      // Lower roughness = glossier metal (tighter specular). Tune live in the
      // Material folder; raising it softens the highlight under the cursor.
      roughness: 0.4,
    })

    if (gui) {
      const materialFolder = gui.addFolder('Material')
      materialFolder.add(material, 'roughness', 0, 1, 0.01)
      materialFolder.add(material, 'metalness', 0, 1, 0.01)
    }

    const geometry = new THREE.PlaneGeometry(1, 1)
    const trailCamera = new THREE.Camera()

    // Two half-float targets are ping-ponged (read one, write the other) so the
    // buffer can feed back into itself each frame without a read/write hazard.
    const trailRTSettings = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
    let trailRTA = new THREE.WebGLRenderTarget(TRAIL_RESOLUTION, TRAIL_RESOLUTION, trailRTSettings)
    let trailRTB = new THREE.WebGLRenderTarget(TRAIL_RESOLUTION, TRAIL_RESOLUTION, trailRTSettings)
    ;[trailRTA, trailRTB].forEach((rt) => {
      renderer.setRenderTarget(rt)
      renderer.setClearColor(0x000000, 1)
      renderer.clear()
    })
    renderer.setRenderTarget(null)

    const stampMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrevTrail: { value: null },
        uNoiseMap: { value: noiseMap },
        uMaskCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uPrevMaskCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uMaskActive: { value: 0 },
        uMaskRadius: { value: MASK_RADIUS },
        uMaskSoftness: { value: MASK_SOFTNESS },
        uNoiseScale: { value: MASK_NOISE_SCALE },
        uNoiseStrength: { value: MASK_NOISE_STRENGTH },
        uUvAspect: { value: 1 },
        uDecay: { value: 1 },
        uTime: { value: 0 },
        uNoiseSpeed: { value: MASK_NOISE_SPEED },
        uEdgeNoiseAmount: { value: 0 },
      },
      vertexShader: TRAIL_VERTEX_GLSL,
      fragmentShader: TRAIL_FRAGMENT_GLSL,
    })

    // Minimal off-screen scene: one clip-space quad running the stamp shader.
    const trailScene = new THREE.Scene()
    const trailQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stampMaterial)
    trailQuad.frustumCulled = false
    trailScene.add(trailQuad)

    const trailParams = { persistence: TRAIL_PERSISTENCE }
    // Cursor-follow easing + the target the (eased) mask center chases.
    const easeParams = { follow: MASK_FOLLOW_EASE }
    const targetMaskCenter = new THREE.Vector2(0.5, 0.5)
    // Velocity-driven edge noise: low-passed measure of the mask center's speed.
    const velParams = { gain: MASK_VELOCITY_GAIN }
    let velocitySmoothed = 0

    if (gui) {
      const trailFolder = gui.addFolder('Trail')
      trailFolder.add(trailParams, 'persistence', 0.05, 2, 0.01).name('Persistence (s)')
    }

    // Extend the built-in standard material shader rather than writing a full custom
    // one: patch in mask uniforms after <common>, and apply the mask to
    // metalnessFactor right after it's read from the map.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNoiseMap = { value: noiseMap }
      shader.uniforms.uMaskCenter = { value: new THREE.Vector2(0.5, 0.5) }
      shader.uniforms.uMaskRadius = { value: MASK_RADIUS }
      shader.uniforms.uMaskSoftness = { value: MASK_SOFTNESS }
      shader.uniforms.uNoiseScale = { value: MASK_NOISE_SCALE }
      shader.uniforms.uNoiseStrength = { value: MASK_NOISE_STRENGTH }
      shader.uniforms.uUvAspect = { value: 1 }
      shader.uniforms.uMaskActive = { value: 0 }
      shader.uniforms.uTime = { value: 0 }
      shader.uniforms.uNoiseSpeed = { value: MASK_NOISE_SPEED }
      shader.uniforms.uEdgeNoiseAmount = { value: 0 }
      shader.uniforms.uTrailMap = { value: trailRTA.texture }

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${MASK_UNIFORMS_GLSL}`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${MASK_APPLY_GLSL}`)

      material.userData.shader = shader

      if (gui) {
        // Uniforms only exist once compiled, so the Mask folder is built here,
        // bound directly to the live { value } uniform objects.
        const maskFolder = gui.addFolder('Mask')
        maskFolder.add(shader.uniforms.uMaskRadius, 'value', 0, 3, 0.01).name('Radius')
        maskFolder.add(shader.uniforms.uMaskSoftness, 'value', 0, 2, 0.01).name('Softness')
        maskFolder.add(shader.uniforms.uNoiseScale, 'value', 0.5, 20, 0.1).name('Noise Scale')
        maskFolder.add(shader.uniforms.uNoiseStrength, 'value', 0, 2, 0.01).name('Noise Strength')
        maskFolder.add(shader.uniforms.uNoiseSpeed, 'value', 0, 0.5, 0.005).name('Noise Speed')
        maskFolder.add(easeParams, 'follow', 0, 0.4, 0.005).name('Follow Ease (s)')
        maskFolder.add(velParams, 'gain', 0, 5, 0.05).name('Edge Velocity')
      }
    }

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    let wasActive = false

    // "Cover"-fit the image into the full frustum (fill, cropping overflow) —
    // matches the original object-fit: cover. Safe to call every frame.
    const fit = () => {
      const img = albedoMap.image
      if (!img || !img.width || !img.height) return
      const imageAspect = img.width / img.height
      const frustumWidth = camera.right - camera.left
      const frustumHeight = camera.top - camera.bottom
      if (imageAspect > frustumWidth / frustumHeight) {
        // Image wider than the frame: match height, let width overflow (crop sides).
        mesh.scale.set(frustumHeight * imageAspect, frustumHeight, 1)
      } else {
        // Image taller than the frame: match width, let height overflow (crop top/bottom).
        mesh.scale.set(frustumWidth, frustumWidth / imageAspect, 1)
      }

      // Keep the mask circular (not stretched by the image's aspect) via the
      // x-axis distance correction in the shader. The plane's scale.x/scale.y
      // ratio equals imageAspect in both branches above.
      if (material.userData.shader) {
        material.userData.shader.uniforms.uUvAspect.value = imageAspect
      }
    }

    // Point the mask at a UV (cursor over the plane) or switch it off.
    const setMask = (uv) => {
      if (!material.userData.shader) return
      const u = material.userData.shader.uniforms
      if (uv) {
        // Only the TARGET jumps to the cursor; the actual mask center eases toward
        // it every frame (see update()), for a smooth trailing follow.
        targetMaskCenter.copy(uv)
        u.uMaskActive.value = 1
      } else {
        u.uMaskActive.value = 0
      }
    }

    // Advance per frame: ease the mask toward the cursor, drive the animated edge
    // noise, then decay the trail buffer and stamp the new blob.
    const update = (dt, elapsed) => {
      const shader = material.userData.shader
      if (!shader) return
      const u = shader.uniforms
      const su = stampMaterial.uniforms

      u.uTime.value = elapsed
      su.uTime.value = elapsed
      su.uNoiseSpeed.value = u.uNoiseSpeed.value

      const active = u.uMaskActive.value > 0.5
      let moved = 0
      let snapped = false
      if (active) {
        if (!wasActive) {
          u.uMaskCenter.value.copy(targetMaskCenter) // snap in; don't count as velocity
          snapped = true
        } else {
          const prevX = u.uMaskCenter.value.x
          const prevY = u.uMaskCenter.value.y
          if (easeParams.follow <= 0.0001) {
            u.uMaskCenter.value.copy(targetMaskCenter)
          } else {
            const alpha = 1 - Math.exp(-dt / easeParams.follow)
            u.uMaskCenter.value.lerp(targetMaskCenter, alpha)
          }
          const dxu = (u.uMaskCenter.value.x - prevX) * u.uUvAspect.value
          const dyu = u.uMaskCenter.value.y - prevY
          moved = Math.hypot(dxu, dyu)
        }
      }

      if (snapped) {
        velocitySmoothed = 0
      } else {
        const speed = dt > 0 ? moved / dt : 0
        const vAlpha = 1 - Math.exp(-dt / MASK_VELOCITY_SMOOTH)
        velocitySmoothed += (speed - velocitySmoothed) * vAlpha
      }
      const edgeAmount = Math.min(velocitySmoothed * velParams.gain, 1)
      u.uEdgeNoiseAmount.value = edgeAmount
      su.uEdgeNoiseAmount.value = edgeAmount

      // Mirror the (GUI-tunable) mask shape into the stamp so the painted trail and
      // the live main-shader head share one identical footprint.
      su.uMaskRadius.value = u.uMaskRadius.value
      su.uMaskSoftness.value = u.uMaskSoftness.value
      su.uNoiseScale.value = u.uNoiseScale.value
      su.uNoiseStrength.value = u.uNoiseStrength.value
      su.uUvAspect.value = u.uUvAspect.value
      su.uMaskCenter.value.copy(u.uMaskCenter.value)
      su.uMaskActive.value = u.uMaskActive.value

      // On the frame the cursor re-enters, collapse the segment to a point so we
      // don't paint a streak from wherever it last left the artwork.
      if (active && !wasActive) su.uPrevMaskCenter.value.copy(u.uMaskCenter.value)
      wasActive = active

      su.uDecay.value = Math.exp(-dt / trailParams.persistence)

      // Ping-pong: read A, write B, feed B to the main material, then swap.
      su.uPrevTrail.value = trailRTA.texture
      renderer.setRenderTarget(trailRTB)
      renderer.render(trailScene, trailCamera)
      renderer.setRenderTarget(null)

      u.uTrailMap.value = trailRTB.texture
      const swap = trailRTA
      trailRTA = trailRTB
      trailRTB = swap

      su.uPrevMaskCenter.value.copy(u.uMaskCenter.value)
    }

    // Pays the one-time shader-compile + texture-upload cost described above.
    // Renders a real frame (compiling the main material's patched shader and the
    // trail stamp's ShaderMaterial, and uploading every bound texture to the GPU)
    // while renderer.domElement is still visibility:hidden, so nothing is visibly
    // painted — this only warms the GPU state ahead of the scroll-triggered reveal.
    let disposed = false
    let warmedUp = false
    let warmUpHandle = null
    let cancelWarmUp = () => {}
    const runWarmUp = () => {
      warmUpHandle = null
      if (disposed || warmedUp) return
      warmedUp = true
      fit()
      renderer.setRenderTarget(trailRTB)
      renderer.render(trailScene, trailCamera)
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)
    }
    const scheduleWarmUp = () => {
      if (disposed || warmedUp) return
      if (typeof window.requestIdleCallback === 'function') {
        warmUpHandle = window.requestIdleCallback(runWarmUp, { timeout: 2000 })
        cancelWarmUp = () => window.cancelIdleCallback(warmUpHandle)
      } else {
        warmUpHandle = setTimeout(runWarmUp, 200)
        cancelWarmUp = () => clearTimeout(warmUpHandle)
      }
    }

    // --- cursor-driven mask position, via raycasting onto the plane -----------
    const raycaster = new THREE.Raycaster()
    const pointerNDC = new THREE.Vector2()
    const raycastHits = []

    const handlePointerMove = (event) => {
      const rect = container.getBoundingClientRect()
      pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointerNDC, camera)
      raycastHits.length = 0
      raycaster.intersectObject(mesh, false, raycastHits)
      const hit = raycastHits.length > 0 ? raycastHits[0] : null

      if (hit) {
        // The plane is unrotated at world Z = 0, so offset straight up the Z axis
        // to put the light in front of the surface at that same X/Y.
        cursorLight.position.set(hit.point.x, hit.point.y, params.cursorLightHeight)
        setMask(hit.uv || null)
      } else {
        setMask(null)
      }
    }

    const handlePointerLeave = () => setMask(null)

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerleave', handlePointerLeave)

    const applySize = () => {
      const size = getSize()
      width = size.width
      height = size.height
      const aspect = width / height
      camera.left = (-FRUSTUM_HEIGHT * aspect) / 2
      camera.right = (FRUSTUM_HEIGHT * aspect) / 2
      camera.top = FRUSTUM_HEIGHT / 2
      camera.bottom = -FRUSTUM_HEIGHT / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    // ResizeObserver over window 'resize' — the footer's height comes from a CSS
    // aspect-ratio box, which changes on layout shifts the window event misses.
    const resizeObserver = new ResizeObserver(applySize)
    resizeObserver.observe(container)

    let animationFrameId = null
    let elapsed = 0
    const clock = new THREE.Clock()

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      fit()

      // Clamp dt so a resumed loop (see the visibility gate below) or a
      // backgrounded tab doesn't jump the easing / wipe the trail on refocus.
      const dt = Math.min(clock.getDelta(), 0.05)
      elapsed += dt
      update(dt, elapsed)

      renderer.render(scene, camera)
    }

    const startLoop = () => {
      if (animationFrameId !== null) return
      clock.getDelta() // drop the idle gap so the resumed frame's dt stays small
      animationFrameId = requestAnimationFrame(animate)
    }

    const stopLoop = () => {
      if (animationFrameId === null) return
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    // Only render — and only let the canvas paint — while the footer is at or near
    // the viewport. Off-screen, the loop is paused and the canvas is hidden. This
    // saves GPU, but the real reason is the reported "footer glimpse": this canvas
    // sits at z-index 2 (above the fixed Scene canvas at z-index 0), and a
    // perpetually-animating high-z compositor layer can be flashed for a frame by
    // the browser during fast scrolling. A hidden canvas can't paint, so it can't
    // flash. rootMargin starts it a full screen early so it's drawn before it
    // actually scrolls in.
    renderer.domElement.style.visibility = 'hidden'
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          renderer.domElement.style.visibility = 'visible'
          startLoop()
        } else {
          stopLoop()
          renderer.domElement.style.visibility = 'hidden'
        }
      },
      { rootMargin: '100% 0px' },
    )
    visibilityObserver.observe(container)

    // Copy Values button: reads whatever is currently live (the controls mutate
    // these objects/uniforms in place) and copies it as JSON to the console +
    // clipboard, so tuned numbers can be pasted back as the new defaults above.
    let copyController
    if (gui) {
      const copyValues = () => {
        const shader = material.userData.shader
        const data = {
          lighting: {
            cursorLightHeight: params.cursorLightHeight,
            cursorLightIntensity: cursorLight.intensity,
            cursorLightDecay: cursorLight.decay,
            ambientIntensity: ambientLight.intensity,
          },
          material: { roughness: material.roughness, metalness: material.metalness },
          trail: { persistence: trailParams.persistence },
          mask: shader
            ? {
                radius: shader.uniforms.uMaskRadius.value,
                softness: shader.uniforms.uMaskSoftness.value,
                noiseScale: shader.uniforms.uNoiseScale.value,
                noiseStrength: shader.uniforms.uNoiseStrength.value,
                noiseSpeed: shader.uniforms.uNoiseSpeed.value,
                follow: easeParams.follow,
                velocityGain: velParams.gain,
              }
            : null,
        }
        const json = JSON.stringify(data, null, 2)
        console.log('[FooterScene] Copied tweak values:\n' + json)
        navigator.clipboard?.writeText(json).catch(() => {})
        if (copyController) {
          copyController.name('Copied to clipboard ✓')
          setTimeout(() => copyController.name('Copy Values'), 1200)
        }
      }
      copyController = gui.add({ copy: copyValues }, 'copy').name('Copy Values')
    }

    return () => {
      disposed = true
      cancelWarmUp()
      visibilityObserver.disconnect()
      resizeObserver.disconnect()
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerLeave)
      stopLoop()

      gui?.destroy()
      renderer.dispose()
      geometry.dispose()
      noiseMap.dispose()
      material.dispose()
      albedoMap.dispose()
      normalMap.dispose()
      metalnessMap.dispose()
      trailRTA.dispose()
      trailRTB.dispose()
      stampMaterial.dispose()
      trailQuad.geometry.dispose()

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [showGui])

  return <div ref={containerRef} className="ft-scene__canvas" aria-hidden="true" />
}
