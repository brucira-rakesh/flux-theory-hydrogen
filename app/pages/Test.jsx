import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import GUI from 'lil-gui'

// Two flat planes stacked vertically, each textured with a /textures/test image
// set and viewed through an orthographic camera pointed straight at them.
// Orthographic = no perspective distortion, so they read as flat 2D images.
// Each plane gets its own cursor-driven reveal mask + temporal trail; a single
// cursor light follows the raycast hit across whichever plane it's over.

const TEXTURE_BASE = '/textures/test/'
const NOISE_URL = `${TEXTURE_BASE}perlinnoise.jpg`

// The stacked image sets, top-to-bottom. Each is loaded and driven identically
// through createMaskedPlane() below, so both get the exact same effect.
const IMAGE_SETS = [
  {
    label: '1',
    albedo: `${TEXTURE_BASE}baseimage.jpg`,
    normal: `${TEXTURE_BASE}normalmap.jpg`,
    metalness: `${TEXTURE_BASE}metalness.jpg`,
    // Per-plane mask/trail tuning (overrides the shared defaults below).
    radius: 0.3,
    softness: 0.16,
    noiseScale: 0.5,
    noiseSpeed: 0.02,
    persistence: 0.4,
  },
  {
    label: '2',
    albedo: `${TEXTURE_BASE}FTbaseimage.png`,
    normal: `${TEXTURE_BASE}FTnormalmap.png`,
    metalness: `${TEXTURE_BASE}FTmetalness.png`,
    radius: 0.22,
    softness: 0.13,
    noiseScale: 3,
    noiseSpeed: 0.05,
    persistence: 0.27,
  },
]

const FRUSTUM_HEIGHT = 2.2 // world units the two stacked planes are fit into

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

// Temporal trail: the reveal is stamped into a ping-pong render target every
// frame and multiplied by an exponential decay, so wherever the cursor has been
// keeps glowing and fades out organically instead of snapping to the cursor.
// TRAIL_RESOLUTION is the square buffer size in UV space (matches the plane's
// map UVs 1:1). TRAIL_PERSISTENCE is the decay time constant in seconds —
// higher = longer-lived trail.
const TRAIL_RESOLUTION = 1024
const TRAIL_PERSISTENCE = 0.27

// Cursor-following point light: the dominant light in the scene, sitting
// just in front of the planes at the raycasted cursor position and moving
// with it every frame. A low-intensity ambient light is kept alongside it
// purely so the rest of the image stays dimly visible outside its falloff.
const CURSOR_LIGHT_HEIGHT = 1.2 // world units in front of the planes (+Z)
const CURSOR_LIGHT_INTENSITY = 2
const CURSOR_LIGHT_DECAY = 6
const AMBIENT_LIGHT_INTENSITY = 3

// Injected once, right after three's own <common> chunk, into whichever
// built-in material fragment shader we patch via onBeforeCompile.
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
  // Accumulated trail buffer (see the ping-pong render target below): its .r
  // channel holds the persistent, fading reveal amount per UV.
  uniform sampler2D uTrailMap;
`

// Injected right after <metalnessmap_fragment>, so `metalnessFactor` already
// holds `metalness * metalnessMap.b` and `vMapUv` (three's own UV varying)
// is in scope. The base albedo/normal shading is untouched and always fully
// opaque — only the metallic contribution is masked by cursor position.
// uMaskActive is 0 until the cursor has actually raycast onto the plane, so
// the image reads as plain (non-metallic) baseimage by default, and the
// metallic sheen only appears in an organic blob following the cursor.
const MASK_APPLY_GLSL = /* glsl */ `
  {
    vec2 maskUv = vMapUv - uMaskCenter;
    maskUv.x *= uUvAspect;
    // Animated edge noise: the sample point drifts over time so the blob's
    // boundary shimmers organically. Only the radius is perturbed — the
    // smoothstep softness band below is deliberately left untouched.
    vec2 noiseUv = vMapUv * uNoiseScale + vec2(uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7);
    float edgeNoise = texture2D(uNoiseMap, noiseUv).r - 0.5;
    // Edge distortion only appears with cursor velocity (uEdgeNoiseAmount).
    float radius = uMaskRadius + edgeNoise * uNoiseStrength * uEdgeNoiseAmount;
    float dist = length(maskUv);
    float revealMask = 1.0 - smoothstep(radius - uMaskSoftness, radius + uMaskSoftness, dist);
    // Existing crisp head at the cursor (unchanged calculation) ...
    float head = mix(0.0, revealMask, uMaskActive);
    // ... combined with the accumulated, fading trail behind it. The trail is
    // stamped with this exact same formula, so head and tail blend seamlessly.
    float trail = texture2D(uTrailMap, vMapUv).r;
    float metalMask = max(head, trail);
    metalnessFactor *= metalMask;
  }
`

// --- trail accumulation pass -------------------------------------------------
// A full-screen quad that decays the previous trail buffer and stamps the
// current cursor blob. position is already in clip space (-1..1) for a 2x2
// quad, so no camera matrix is needed; uv (0..1) maps 1:1 to the plane's map UVs
// and to uMaskCenter, so the stamp lives in the exact same space as the mask.
const TRAIL_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// The stamp reuses the EXACT mask formula from MASK_APPLY_GLSL (noise-perturbed
// soft radius via smoothstep), but measures distance to the SEGMENT from the
// previous cursor position to the current one. That capsule stamp fills the gap
// between frames on fast moves, so the trail stays continuous with no dotted
// segments. max(decayedPrev, stamp) keeps a full-intensity head while older
// areas fade, giving the wet-paint / liquid-reveal persistence.
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
      // Closest point on the segment prev->current, in the same aspect-corrected
      // UV space the main shader uses, so the blob stays circular on screen.
      vec2 pa = vUv - uPrevMaskCenter; pa.x *= uUvAspect;
      vec2 ba = uMaskCenter - uPrevMaskCenter; ba.x *= uUvAspect;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      float dist = length(pa - ba * h);

      // Identical animated edge noise + soft radius as the main mask shader.
      vec2 noiseUv = vUv * uNoiseScale + vec2(uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7);
      float edgeNoise = texture2D(uNoiseMap, noiseUv).r - 0.5;
      float radius = uMaskRadius + edgeNoise * uNoiseStrength * uEdgeNoiseAmount;
      stamp = 1.0 - smoothstep(radius - uMaskSoftness, radius + uMaskSoftness, dist);
    }

    gl_FragColor = vec4(max(decayed, stamp), 0.0, 0.0, 1.0);
  }
`

export default function Test() {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x161616)

    const aspect = container.clientWidth / container.clientHeight
    const camera = new THREE.OrthographicCamera(
      (-FRUSTUM_HEIGHT * aspect) / 2,
      (FRUSTUM_HEIGHT * aspect) / 2,
      FRUSTUM_HEIGHT / 2,
      -FRUSTUM_HEIGHT / 2,
      0.1,
      10,
    )
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)

    const gui = new GUI({ title: 'Test Tweaks' })

    // Values that aren't a direct three.js object property (cursorLightHeight
    // is just a number read inside handlePointerMove) live here so the GUI
    // has a plain object to bind to.
    const params = { cursorLightHeight: CURSOR_LIGHT_HEIGHT }

    // Dominant light: starts centered and is moved to the raycasted cursor
    // position (on whichever plane is hovered) in handlePointerMove below.
    const cursorLight = new THREE.PointLight(
      0xffffff,
      CURSOR_LIGHT_INTENSITY,
      0,
      CURSOR_LIGHT_DECAY,
    )
    cursorLight.position.set(0, 0, params.cursorLightHeight)
    scene.add(cursorLight)

    // Flat, directionless fill so the images don't go fully black outside
    // the cursor light's falloff — deliberately subtle, not a key light.
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY)
    scene.add(ambientLight)

    const lightingFolder = gui.addFolder('Lighting')
    lightingFolder.add(params, 'cursorLightHeight', 0.1, 10, 0.05).name('Cursor Light Height')
    lightingFolder.add(cursorLight, 'intensity', 0, 50, 0.1).name('Cursor Light Intensity')
    lightingFolder.add(cursorLight, 'decay', 0, 10, 0.1).name('Cursor Light Decay')
    lightingFolder.add(ambientLight, 'intensity', 0, 3, 0.01).name('Ambient Intensity')

    const textureLoader = new THREE.TextureLoader()
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

    // Shared perlin noise for the mask edge + trail stamp of both planes.
    const noiseMap = textureLoader.load(NOISE_URL)
    noiseMap.wrapS = noiseMap.wrapT = THREE.RepeatWrapping
    noiseMap.anisotropy = maxAnisotropy

    // Shared unit plane geometry (each mesh is scaled/positioned per-plane) and
    // a shared clip-space camera for the trail passes (the trail vertex shader
    // ignores it, so one stateless camera serves every plane).
    const geometry = new THREE.PlaneGeometry(1, 1)
    const trailCamera = new THREE.Camera()

    // Two half-float targets are ping-ponged (read one, write the other) so the
    // buffer can feed back into itself each frame without a read/write hazard.
    // Half-float (not 8-bit) keeps the exponential decay smooth with no banding.
    const trailRTSettings = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }

    // --- one masked, trailed plane -------------------------------------------
    // Everything a single image needs: material (with the mask shader patch),
    // its own ping-pong trail buffers + stamp pass, and its GUI folders. Two of
    // these are created below, so both images get the identical effect.
    const createMaskedPlane = ({
      label,
      albedo,
      normal,
      metalness,
      radius,
      softness,
      noiseScale,
      noiseSpeed,
      persistence,
    }) => {
      // Resolve this plane's config: per-set overrides fall back to the shared
      // module defaults. noiseStrength / follow-ease / velocity gain are the
      // same on both planes, so they come straight from the constants.
      const cfg = {
        radius: radius ?? MASK_RADIUS,
        softness: softness ?? MASK_SOFTNESS,
        noiseScale: noiseScale ?? MASK_NOISE_SCALE,
        noiseStrength: MASK_NOISE_STRENGTH,
        noiseSpeed: noiseSpeed ?? MASK_NOISE_SPEED,
        persistence: persistence ?? TRAIL_PERSISTENCE,
        follow: MASK_FOLLOW_EASE,
        velocityGain: MASK_VELOCITY_GAIN,
      }

      const albedoMap = textureLoader.load(albedo)
      albedoMap.colorSpace = THREE.SRGBColorSpace
      const normalMap = textureLoader.load(normal)
      const metalnessMap = textureLoader.load(metalness)
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
        // Material folder; raising it spreads the point light's highlight into a
        // softer sheen if the specular hotspot under the cursor reads too bright.
        roughness: 0.4,
      })

      const materialFolder = gui.addFolder(`Material ${label}`)
      materialFolder.add(material, 'roughness', 0, 1, 0.01)
      materialFolder.add(material, 'metalness', 0, 1, 0.01)

      // This plane's own ping-pong trail buffers, cleared to empty (no reveal).
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
          uMaskRadius: { value: cfg.radius },
          uMaskSoftness: { value: cfg.softness },
          uNoiseScale: { value: cfg.noiseScale },
          uNoiseStrength: { value: cfg.noiseStrength },
          uUvAspect: { value: 1 },
          uDecay: { value: 1 },
          uTime: { value: 0 },
          uNoiseSpeed: { value: cfg.noiseSpeed },
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

      const trailParams = { persistence: cfg.persistence }
      const trailFolder = gui.addFolder(`Trail ${label}`)
      trailFolder.add(trailParams, 'persistence', 0.05, 2, 0.01).name('Persistence (s)')

      // Cursor-follow easing, plus the target the (eased) mask center chases.
      const easeParams = { follow: cfg.follow }
      const targetMaskCenter = new THREE.Vector2(0.5, 0.5)

      // Velocity-driven edge noise: a low-passed measure of how fast the mask
      // center is moving, mapped to how much the edge distorts.
      const velParams = { gain: cfg.velocityGain }
      let velocitySmoothed = 0

      // Extend the built-in (well-tested) standard material shader rather than
      // writing a full custom one: patch in mask uniforms after <common>, and
      // apply the mask to metalnessFactor right after it's read from the map.
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uNoiseMap = { value: noiseMap }
        shader.uniforms.uMaskCenter = { value: new THREE.Vector2(0.5, 0.5) }
        shader.uniforms.uMaskRadius = { value: cfg.radius }
        shader.uniforms.uMaskSoftness = { value: cfg.softness }
        shader.uniforms.uNoiseScale = { value: cfg.noiseScale }
        shader.uniforms.uNoiseStrength = { value: cfg.noiseStrength }
        shader.uniforms.uUvAspect = { value: 1 }
        shader.uniforms.uMaskActive = { value: 0 }
        shader.uniforms.uTime = { value: 0 }
        shader.uniforms.uNoiseSpeed = { value: cfg.noiseSpeed }
        shader.uniforms.uEdgeNoiseAmount = { value: 0 }
        shader.uniforms.uTrailMap = { value: trailRTA.texture }

        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${MASK_UNIFORMS_GLSL}`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${MASK_APPLY_GLSL}`)

        material.userData.shader = shader

        // Uniforms only exist once compiled, so the Mask folder is built here,
        // bound directly to the live { value } uniform objects — moving a
        // slider mutates .value in place, no extra sync code needed.
        const maskFolder = gui.addFolder(`Mask ${label}`)
        maskFolder.add(shader.uniforms.uMaskRadius, 'value', 0, 3, 0.01).name('Radius')
        maskFolder.add(shader.uniforms.uMaskSoftness, 'value', 0, 2, 0.01).name('Softness')
        maskFolder.add(shader.uniforms.uNoiseScale, 'value', 0.5, 20, 0.1).name('Noise Scale')
        maskFolder.add(shader.uniforms.uNoiseStrength, 'value', 0, 2, 0.01).name('Noise Strength')
        maskFolder.add(shader.uniforms.uNoiseSpeed, 'value', 0, 0.5, 0.005).name('Noise Speed')
        maskFolder.add(easeParams, 'follow', 0, 0.4, 0.005).name('Follow Ease (s)')
        maskFolder.add(velParams, 'gain', 0, 5, 0.05).name('Edge Velocity')
      }

      const mesh = new THREE.Mesh(geometry, material)

      let wasActive = false

      // Fit the image (preserving its aspect) inside a region of the frustum,
      // centered at centerY. Safe to call every frame — a no-op once sized.
      const fit = (regionWidth, regionHeight, centerY) => {
        const img = albedoMap.image
        if (!img || !img.width || !img.height) return
        const imageAspect = img.width / img.height
        if (imageAspect > regionWidth / regionHeight) {
          mesh.scale.set(regionWidth, regionWidth / imageAspect, 1)
        } else {
          mesh.scale.set(regionHeight * imageAspect, regionHeight, 1)
        }
        mesh.position.set(0, centerY, 0)

        // Keep the mask's radius circular (not stretched by the image's own
        // aspect ratio) by correcting the x-axis distance in the shader.
        if (material.userData.shader) {
          material.userData.shader.uniforms.uUvAspect.value = imageAspect
        }
      }

      // Point the mask at a UV (cursor over this plane) or switch it off.
      const setMask = (uv) => {
        if (!material.userData.shader) return
        const u = material.userData.shader.uniforms
        if (uv) {
          // Only the TARGET jumps to the cursor; the actual mask center eases
          // toward it every frame (see update()), for a smooth trailing follow.
          targetMaskCenter.copy(uv)
          u.uMaskActive.value = 1
        } else {
          u.uMaskActive.value = 0
        }
      }

      // Advance this plane per frame: ease the mask toward the cursor, drive the
      // animated edge noise, then decay the trail buffer and stamp the new blob.
      const update = (dt, elapsed) => {
        const shader = material.userData.shader
        if (!shader) return
        const u = shader.uniforms
        const su = stampMaterial.uniforms

        // Animated edge noise: feeding both shaders the same elapsed time keeps
        // the live head and its freshly-stamped tail edge identical (no seam).
        u.uTime.value = elapsed
        su.uTime.value = elapsed
        su.uNoiseSpeed.value = u.uNoiseSpeed.value

        // Ease the mask center toward the cursor target, frame-rate independent
        // (alpha = 1 - exp(-dt / tau)). Snap on re-enter (or tau ~ 0) so the mask
        // never sweeps across from wherever it last was. Along the way, measure
        // how far the center moved this frame to drive the velocity edge noise.
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
            // Aspect-corrected displacement, so speed reads uniform on screen.
            const dxu = (u.uMaskCenter.value.x - prevX) * u.uUvAspect.value
            const dyu = u.uMaskCenter.value.y - prevY
            moved = Math.hypot(dxu, dyu)
          }
        }

        // Low-pass the per-frame speed, then map it to the edge-noise amount so a
        // still cursor gives a clean edge and fast motion a turbulent one. Both
        // shaders get the same value, so the head and its stamped tail agree.
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

        // Mirror the (GUI-tunable) mask shape into the stamp so the painted
        // trail and the live main-shader head share one identical footprint.
        su.uMaskRadius.value = u.uMaskRadius.value
        su.uMaskSoftness.value = u.uMaskSoftness.value
        su.uNoiseScale.value = u.uNoiseScale.value
        su.uNoiseStrength.value = u.uNoiseStrength.value
        su.uUvAspect.value = u.uUvAspect.value
        su.uMaskCenter.value.copy(u.uMaskCenter.value)
        su.uMaskActive.value = u.uMaskActive.value

        // On the frame the cursor re-enters, collapse the segment to a point so
        // we don't paint a streak from wherever it last left the artwork.
        if (active && !wasActive) su.uPrevMaskCenter.value.copy(u.uMaskCenter.value)
        wasActive = active

        // Exponential (organic) decay, frame-rate independent.
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

        // Remember this frame's position as next frame's segment start.
        su.uPrevMaskCenter.value.copy(u.uMaskCenter.value)
      }

      const getValues = () => {
        const values = {
          label,
          material: { roughness: material.roughness, metalness: material.metalness },
          trail: { persistence: trailParams.persistence },
        }
        if (material.userData.shader) {
          const u = material.userData.shader.uniforms
          values.mask = {
            radius: u.uMaskRadius.value,
            softness: u.uMaskSoftness.value,
            noiseScale: u.uNoiseScale.value,
            noiseStrength: u.uNoiseStrength.value,
            noiseSpeed: u.uNoiseSpeed.value,
          }
          values.ease = { follow: easeParams.follow }
          values.velocity = { gain: velParams.gain }
        }
        return values
      }

      const dispose = () => {
        material.dispose()
        albedoMap.dispose()
        normalMap.dispose()
        metalnessMap.dispose()
        trailRTA.dispose()
        trailRTB.dispose()
        stampMaterial.dispose()
        trailQuad.geometry.dispose()
      }

      return { mesh, fit, setMask, update, getValues, dispose }
    }

    // Top plane = first image set, bottom plane = second (the FT textures).
    const planes = IMAGE_SETS.map(createMaskedPlane)
    planes.forEach((p) => scene.add(p.mesh))
    const meshes = planes.map((p) => p.mesh)

    // --- cursor-driven mask position, via raycasting onto both planes ---------
    const raycaster = new THREE.Raycaster()
    const pointerNDC = new THREE.Vector2()
    const raycastHits = []

    const handlePointerMove = (event) => {
      const rect = container.getBoundingClientRect()
      pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointerNDC, camera)
      raycastHits.length = 0
      raycaster.intersectObjects(meshes, false, raycastHits)

      const hit = raycastHits.length > 0 ? raycastHits[0] : null

      if (hit) {
        // Both planes are unrotated and lie flat at world Z = 0, so any point on
        // either surface has world Z = 0 — offset straight up the Z axis to put
        // the light in front of the surface at that same X/Y.
        cursorLight.position.set(hit.point.x, hit.point.y, params.cursorLightHeight)
      }

      // Route the hit to its plane; the other plane's mask switches off (its
      // trail keeps decaying on its own). If the cursor is over the canvas but
      // outside both letterboxed images, every mask switches off.
      planes.forEach((p) => {
        const onThis = hit && hit.object === p.mesh && hit.uv
        p.setMask(onThis ? hit.uv : null)
      })
    }

    const handlePointerLeave = () => {
      planes.forEach((p) => p.setMask(null))
    }

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerleave', handlePointerLeave)

    const handleResize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      const newAspect = width / height
      camera.left = (-FRUSTUM_HEIGHT * newAspect) / 2
      camera.right = (FRUSTUM_HEIGHT * newAspect) / 2
      camera.top = FRUSTUM_HEIGHT / 2
      camera.bottom = -FRUSTUM_HEIGHT / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    let animationFrameId
    let elapsed = 0
    const clock = new THREE.Clock()

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      // Split the frustum into a top and bottom half, one image per half.
      const regionWidth = camera.right - camera.left
      const regionHeight = FRUSTUM_HEIGHT / 2
      planes[0].fit(regionWidth, regionHeight, regionHeight / 2)
      planes[1].fit(regionWidth, regionHeight, -regionHeight / 2)

      // Clamp dt so a backgrounded tab doesn't jump the easing / wipe the trails
      // on refocus, then advance every plane (easing, animated noise, trail)
      // with the same real elapsed time.
      const dt = Math.min(clock.getDelta(), 0.05)
      elapsed += dt
      planes.forEach((p) => p.update(dt, elapsed))

      renderer.render(scene, camera)
    }
    animate()

    // Copy Values button: reads whatever is currently live on screen (the
    // controls above mutate these objects/uniforms in place) and copies it
    // as JSON to the console + clipboard, so tuned numbers can be pasted
    // back in as the new defaults at the top of this file.
    let copyController
    const copyValues = () => {
      const data = {
        lighting: {
          cursorLightHeight: params.cursorLightHeight,
          cursorLightIntensity: cursorLight.intensity,
          cursorLightDecay: cursorLight.decay,
          ambientIntensity: ambientLight.intensity,
        },
        planes: planes.map((p) => p.getValues()),
      }

      const json = JSON.stringify(data, null, 2)
      console.log('[Test] Copied tweak values:\n' + json)
      navigator.clipboard?.writeText(json).catch(() => {})

      if (copyController) {
        copyController.name('Copied to clipboard ✓')
        setTimeout(() => copyController.name('Copy Values'), 1200)
      }
    }
    copyController = gui.add({ copy: copyValues }, 'copy').name('Copy Values')

    return () => {
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerLeave)
      cancelAnimationFrame(animationFrameId)

      gui.destroy()
      renderer.dispose()
      geometry.dispose()
      noiseMap.dispose()
      planes.forEach((p) => p.dispose())

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />
}
