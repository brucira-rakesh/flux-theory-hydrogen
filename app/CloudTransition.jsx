import { useEffect, useRef } from 'react'
import { useLenis } from 'lenis/react'
import { prefersReducedMotion } from './hooks/useSpotlight'
import './CloudTransition.css'

// Premium cloud wipe that masks the hand-off between <Seawave/> and <SceneV2/>.
//
// Both of those are normal-flow sections whose 100vh canvases are `position:
// sticky` (see Scene.v2.css + Seawave's return): as the shared boundary between
// them crosses the viewport, the Seawave canvas slides up and out while the
// SceneV2 canvas slides up and in — a visible seam sweeps down the screen. This
// overlay hides that seam behind a volumetric cloud bank that billows in,
// fully white-outs the screen exactly when the two canvases are mid-swap, then
// parts to reveal SceneV2.
//
// Deliberately its OWN tiny raw-WebGL context (a single full-screen quad — the
// same `aPosition` fullscreen-quad convention as the reference vertex shader),
// NOT a Three.js scene: it must sit ABOVE both existing WebGLRenderers without
// sharing or disturbing their state, cost nothing while idle, and stay a pure
// pointer-events:none visual.
//
// The middle of the section is ordinary scroll-scrubbed coverage (derived
// from scroll position via the same Lenis tick everything else on the page
// reads), but BOTH ends of the actual hand-off are fully automatic, on a
// timer, not tied to scroll at all: the instant the marker crosses the
// forward trigger line (see AUTOPLAY_TRIGGER_MARKER_VH — the moment
// Seawave's bottle-launch timeline finishes settling) or the reverse
// boundary crossing further down, the page is frozen in place, coverage
// fades IN over AUTO_IN_MS, the page is then teleported under that full
// white-out to the far side, and coverage fades back OUT over AUTO_OUT_MS to
// reveal it — a reveal over a STATIONARY frame, never a moving one. From the
// moment either trigger fires, no further scrolling changes anything until
// that sequence completes on its own; the two directions share the exact
// same phase machine (see `autoRef`), so their pacing/feel matches exactly.
//
// `boundaryRef` is a zero-height marker sitting in the flow exactly between the
// two sections (see HomeV2Page) — its viewport-space top IS the seam position.

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform float uProgress;   // 0 = clear, 1 = full white-out
uniform vec2  uResolution;

// --- value-noise fbm ---------------------------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

  // Subtle zoom-out as coverage rises so it reads like drifting INTO the bank
  // rather than clouds simply fading up in place.
  p *= mix(1.35, 0.92, uProgress);

  float t = uTime * 0.03;
  float clouds  = fbm(p * 2.6 + vec2(t, t * 0.4));
  clouds       += 0.35 * fbm(p * 5.5 - vec2(t * 1.3, t * 0.7));
  clouds /= 1.35;

  // Raise the whole field by coverage; the -1.0 bias keeps it fully
  // transparent at rest (uProgress = 0) so nothing shows outside the wipe.
  float density = smoothstep(0.0, 0.55, clouds + uProgress * 1.9 - 1.0);

  // Guaranteed opaque core near the peak so the canvas swap seam can never
  // peek through, however the noise field happens to fall that frame.
  density = max(density, smoothstep(0.72, 1.0, uProgress));

  // Cool overcast white, brighter in the thick cores.
  vec3 col = mix(vec3(0.80, 0.84, 0.93), vec3(1.0), density);

  gl_FragColor = vec4(col, density);
}
`

// Coverage as a function of the seam's viewport-space position. Peaks (full
// cover) while the seam sits just below the viewport — where the canvas swap
// is about to become visible — and ramps to 0 well before/after so the clouds
// gather and disperse gradually. All distances are in viewport heights.
const PLATEAU = 0.25 // half-height of the guaranteed-full-cover band
const RAMP = 0.45 // fade distance on each side of the plateau
// Center the coverage bump this many viewport-heights above the boundary
// marker (i.e. below the viewport, on the Seawave side). Set to PLATEAU+RAMP
// so coverage returns to EXACTLY 0 when the marker reaches the viewport top
// (markerTop = 0) — the moment SceneV2 pins with Scene One resting at FRONT.
// That's what lets the auto-complete (below) snap the page straight to the
// boundary under a full white-out and reveal Scene One with nothing left over
// to re-trigger the clouds, instead of the old window that stayed opaque for
// ~2.5 carousel steps past the boundary (which is what left the carousel
// rounded onto Scene Two by the time the clouds finally parted).
const COVER_CENTER = PLATEAU + RAMP
const computeCover = (markerTop, viewportH) => {
  if (viewportH <= 0) return 0
  const center = COVER_CENTER * viewportH
  const d = Math.abs(markerTop - center) / viewportH
  const cover = 1 - (d - PLATEAU) / RAMP
  return Math.min(1, Math.max(0, cover))
}

// Once triggered (either direction), the wipe stops being scroll-scrubbed
// entirely and finishes itself on a timer: fade coverage IN over AUTO_IN_MS
// while holding the page dead still at the crossing point, teleport under
// that full white-out to the far side, then fade coverage back OUT over
// AUTO_OUT_MS — so the hand-off completes purely on its own, with zero
// further scrolling required and zero dependency on how fast the user
// happened to be scrolling at the moment it triggered.
const AUTO_OUT_MS = 1100
// Forward autoplay: arm once the seam marker descends to exactly ONE
// viewport-height above the boundary. Seawave's own scrollable distance is
// (its wrapper's height − one viewport height), and this marker sits right
// at that wrapper's bottom edge — so "marker one viewport-height above the
// boundary" is the EXACT scroll position where Seawave's scrollProgress
// reaches 1, i.e. the instant the bottle-launch timeline finishes settling.
// This is a POSITION test, not a coverage-peak test, and it fires on the
// FIRST frame at or below the line: a hard, frame-skipping scroll can shoot
// the marker clean across the full-cover band in one Lenis step, so a
// `cover >= 0.999` peak test could be missed entirely — letting the carousel
// grab the wheel and round onto Scene Two. A position line can't be jumped
// over. It also sits above the carousel's own scroll range (which only
// starts AT the boundary), so the autoplay always arms BEFORE the carousel
// can commit a step.
//
// Coverage on the Seawave side of this line is forced to 0 regardless of
// natural computeCover (see the render loop's `else` branch below) — the
// fade-IN itself happens automatically, on a timer, AFTER this line is
// crossed (mirroring the reverse direction below), not by the user
// scroll-scrubbing their way up to it. That was tried the other way first
// (letting natural position-based coverage ramp up for the ~0.4 viewport-
// heights before this line) and reverted: it made the fade-in feel tied to
// scroll speed instead of automatic, exactly the "still have to scroll for
// the fade" symptom this whole mechanism exists to remove.
const AUTOPLAY_TRIGGER_MARKER_VH = 1.0
// Re-arm the forward autoplay only once the marker has travelled back up past
// this line (into Seawave). One forward pass then fires exactly once, and
// scrolling on down into the carousel afterwards — where the marker sits below
// the boundary — can never re-trigger it. Kept a bit above
// AUTOPLAY_TRIGGER_MARKER_VH (not equal to it) so ordinary frame-to-frame
// jitter right at the trigger line can't flip-flop arm/disarm.
const FWD_REARM_MARKER_VH = 1.3
// Reverse (scrolling UP out of SceneV2) — the reference implementation the
// forward direction above now mirrors. Marker-scrubbing the clouds in on the
// way back would first have to scroll PAST the boundary — visibly unpinning
// SceneV2 and sliding it down before the clouds could hide it. Instead, the
// instant we cross the boundary heading up we hold SceneV2 exactly where it is
// and auto-fade the clouds IN over AUTO_IN_MS, then teleport back up into the
// Seawave section behind the full white-out and fade OUT (AUTO_OUT_MS) — so
// SceneV2 never appears to move; the clouds cover, then Seawave is revealed.
const AUTO_IN_MS = 800
// Where the reverse fade-OUT reveals Seawave: this many viewport-heights of
// marker-top above the boundary, i.e. the exact point on the Seawave side
// where coverage is naturally 0 again (see COVER_CENTER) — mirror of the
// forward landing at the boundary, so nothing is left to re-trigger the wipe.
const REVEAL_MARKER_VH = 2 * COVER_CENTER

// Smootherstep — removes the linear-ramp corners so the clouds ease in/out.
const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10)

export default function CloudTransition({ boundaryRef }) {
  const canvasRef = useRef(null)
  const coverRef = useRef(0)
  const runningRef = useRef(false)
  const glRef = useRef(null)
  // The live Lenis instance (captured off its tick below) — used by the
  // auto-complete to snap/hold the page at the boundary while the clouds part.
  const lenisInstRef = useRef(null)
  // Auto-complete state machine, shared by BOTH directions. `active` = a
  // self-finishing wipe is running.
  //   phase 'out' — fade coverage `from`->`to` (1->0), holding `target`.
  //   phase 'in'  — fade coverage `from`->`to` (->1), holding `target`, then
  //                 teleport to `outTarget` and switch to an 'out' phase.
  // `enforce` re-asserts lenis.stop()/position every frame (reverse only, to
  // hold SceneV2 dead still against the carousel's edge start()). While
  // active, the marker is ignored.
  const autoRef = useRef({
    active: false,
    phase: 'out',
    enforce: false,
    start: 0,
    from: 1,
    to: 0,
    target: 0,
    outTarget: 0,
  })
  // True for the duration of the forward auto-complete (mirrors auto.active,
  // set/cleared alongside it — see the trigger below) — gates the
  // capture-phase wheel/touch block below. A SEPARATE flag from `auto.active`
  // because `lenis.stop()` alone isn't enough here: swingCarousel.js has its
  // own, entirely independent `window` wheel listener (see its own comment:
  // "Lenis has its own wheel listener and momentum, entirely independent
  // of..."), which would otherwise be free to grab the input and commit a
  // carousel step the instant the page is parked at the boundary, before the
  // clouds have finished parting.
  const autoplayLockRef = useRef(false)
  // Forward auto-complete latch: true = a forward pass may still fire. Set
  // false the instant it fires, re-armed only once the marker climbs back up
  // into Seawave (see FWD_REARM_MARKER_VH) — so scrolling on into the carousel
  // after landing on Scene One can't keep re-triggering the wipe.
  const forwardArmedRef = useRef(true)
  // Last window.scrollY / marker-top seen by the render loop — lets it tell
  // scrolling down into the boundary (forward auto-complete) from crossing the
  // boundary upward out of SceneV2 (reverse auto-complete).
  const lastScrollRef = useRef(0)
  const lastMarkerTopRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const gl =
      canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true, depth: false }) ||
      canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false, antialias: true, depth: false })
    if (!gl) return undefined

    const compile = (type, src) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[CloudTransition] shader compile failed:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC)
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC)
    if (!vs || !fs) return undefined

    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[CloudTransition] program link failed:', gl.getProgramInfoLog(program))
      return undefined
    }

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    // Full-screen triangle strip in clip space.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const aPosition = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(program, 'uTime')
    const uProgress = gl.getUniformLocation(program, 'uProgress')
    const uResolution = gl.getUniformLocation(program, 'uResolution')

    gl.useProgram(program)
    // Single full-screen quad, no overlapping geometry — blending is
    // unnecessary; the buffer's own straight alpha (premultipliedAlpha:false)
    // is what the browser composites this canvas over the page with.
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 0)

    const state = { gl, program, quad, vs, fs, uTime, uProgress, uResolution, width: 0, height: 0 }
    glRef.current = state

    const reduced = prefersReducedMotion()
    const start = performance.now()

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = Math.max(1, Math.floor(window.innerWidth * dpr))
      const h = Math.max(1, Math.floor(window.innerHeight * dpr))
      if (w !== state.width || h !== state.height) {
        canvas.width = w
        canvas.height = h
        state.width = w
        state.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    const render = () => {
      const marker = boundaryRef?.current
      const viewportH = window.innerHeight
      const now = performance.now()
      const auto = autoRef.current

      // Always track scroll/marker deltas, even mid-auto-complete, so the
      // direction/boundary-crossing tests below stay correct across phases.
      const markerTop = marker ? marker.getBoundingClientRect().top : Infinity
      const scrollY = window.scrollY
      const prevScroll = lastScrollRef.current
      const prevMarkerTop = lastMarkerTopRef.current
      lastScrollRef.current = scrollY
      lastMarkerTopRef.current = markerTop
      const goingDown = scrollY > prevScroll
      const goingUp = scrollY < prevScroll

      // Re-arm the forward auto-complete whenever the marker is back up in
      // Seawave — evaluated every frame (even mid-auto) so the reverse wipe,
      // which parks the marker at REVEAL_MARKER_VH, leaves forward armed again.
      if (markerTop > FWD_REARM_MARKER_VH * viewportH) forwardArmedRef.current = true

      let cover
      if (auto.active) {
        // Reverse phases hold SceneV2 (or the revealed Seawave) dead still:
        // re-assert stop() every frame to undo the carousel's edge start(),
        // and yank the page back if a stray tick slipped it before we did.
        if (auto.enforce) {
          const lenis = lenisInstRef.current
          if (lenis) {
            if (!lenis.isStopped) lenis.stop()
            if (Math.abs(scrollY - auto.target) > 2) {
              lenis.scrollTo(auto.target, { immediate: true, force: true })
            }
          }
        }

        const dur = auto.phase === 'in' ? AUTO_IN_MS : AUTO_OUT_MS
        const k = (now - auto.start) / dur
        if (k >= 1) {
          if (auto.phase === 'in') {
            // Full white-out reached while holding SceneV2 — now teleport up
            // into Seawave behind the clouds and fade OUT to reveal it.
            auto.phase = 'out'
            auto.from = 1
            auto.to = 0
            auto.target = auto.outTarget
            auto.start = now
            const lenis = lenisInstRef.current
            if (lenis) {
              lenis.scrollTo(auto.outTarget, { immediate: true, force: true })
              lenis.stop()
            }
            cover = 1
          } else {
            auto.active = false
            auto.enforce = false
            autoplayLockRef.current = false
            lenisInstRef.current?.start() // hand scroll back to Lenis/carousel
            coverRef.current = 0
            runningRef.current = false
            canvas.style.opacity = '0'
            return
          }
        } else {
          cover = auto.from + (auto.to - auto.from) * k
        }
      } else {
        // Recompute coverage from the live seam position every frame so the
        // wipe stays exact even mid-drift — but ONLY once the marker is at or
        // below the forward trigger line. Above that line coverage is forced
        // to 0 no matter what computeCover would naturally give: the fade-in
        // itself is handled entirely by the auto-complete's own phase 'in'
        // below (time-based, not position-based) once the trigger fires, so
        // nothing before that line should visibly build up from the user's
        // own scroll speed — see AUTOPLAY_TRIGGER_MARKER_VH's comment.
        cover = marker && markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH
          ? computeCover(markerTop, viewportH)
          : 0

        if (
          marker &&
          goingDown &&
          forwardArmedRef.current &&
          markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH
        ) {
          // FORWARD AUTOPLAY: Seawave's bottle timeline has just finished
          // settling (see AUTOPLAY_TRIGGER_MARKER_VH) — mirrors the REVERSE
          // auto-complete below exactly: freeze the page dead still right
          // here (holdTarget) and fade coverage IN over AUTO_IN_MS (phase
          // 'in', purely time-based — see the shared phase transition
          // further up, in the `auto.active` branch); once opaque, THAT
          // code teleports under the full white-out to the real boundary
          // (docTop, where markerTop becomes exactly 0 — invariant
          // regardless of where it's computed from, since the marker's own
          // document position never moves) and fades coverage back OUT over
          // AUTO_OUT_MS to reveal a now-stationary Scene One. Both phases
          // are entirely automatic from here — no further scrolling changes
          // anything until the whole sequence completes and hands control
          // back to Lenis/the carousel. `enforce` (see its declaration
          // above) holds the page against drift through both phases, and
          // `autoplayLockRef` additionally blocks the carousel's own
          // independent wheel listener (not reached by lenis.stop() alone —
          // see its declaration above) from grabbing input and committing a
          // step while parked here.
          forwardArmedRef.current = false
          const holdTarget = scrollY
          const docTop = scrollY + markerTop
          autoplayLockRef.current = true
          auto.active = true
          auto.phase = 'in'
          auto.enforce = true
          auto.from = cover
          auto.to = 1
          auto.target = holdTarget
          auto.outTarget = docTop
          auto.start = now
          const lenis = lenisInstRef.current
          if (lenis) {
            lenis.scrollTo(holdTarget, { immediate: true, force: true })
            lenis.stop() // hold Seawave's final settled frame while clouds gather
          }
        } else if (marker && goingUp && prevMarkerTop <= 0 && markerTop > 0) {
          // REVERSE: just crossed the boundary heading UP, leaving SceneV2.
          // Snap SceneV2 back into its pin and fade the clouds IN over it
          // (phase 'in'); once opaque, the block above teleports up into
          // Seawave and fades out — SceneV2 itself never appears to move.
          const docTop = scrollY + markerTop
          auto.active = true
          auto.phase = 'in'
          auto.enforce = true
          auto.from = cover
          auto.to = 1
          auto.target = docTop
          auto.outTarget = docTop - REVEAL_MARKER_VH * viewportH
          auto.start = now
          const lenis = lenisInstRef.current
          if (lenis) {
            lenis.scrollTo(docTop, { immediate: true, force: true })
            lenis.stop()
          }
        }
      }
      coverRef.current = cover

      if (cover <= 0.0005 && !auto.active) {
        // Stop the loop (and stop touching the GPU) once the boundary has left
        // the transition window entirely.
        runningRef.current = false
        canvas.style.opacity = '0'
        return
      }
      canvas.style.opacity = '1'

      syncSize()
      gl.useProgram(program)
      gl.uniform1f(uTime, reduced ? 0 : (now - start) / 1000)
      gl.uniform1f(uProgress, ease(cover))
      gl.uniform2f(uResolution, state.width, state.height)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      state.raf = requestAnimationFrame(render)
    }
    state.render = render

    lastScrollRef.current = window.scrollY
    // Stable across this effect's life (never reassigned) — captured so the
    // cleanup below can safely read it without the stale-ref lint warning.
    const auto = autoRef.current

    // Swallow wheel/touch for the whole forward autoplay tween
    // (autoplayLockRef) so a hard, continued scroll can't reach the SceneV2
    // carousel and commit it onto Scene Two underneath the clouds. Capture
    // phase + stopImmediatePropagation preempts BOTH the carousel's and
    // Lenis's own window listeners (both bubble-phase); preventDefault stops
    // native scrolling. Only active during the forward autoplay — reverse
    // holds via `enforce`, and normal scrolling is never touched.
    const blockAutoInput = (event) => {
      if (autoplayLockRef.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('wheel', blockAutoInput, { capture: true, passive: false })
    window.addEventListener('touchmove', blockAutoInput, { capture: true, passive: false })

    // Prime one frame if we mount already inside the transition window
    // (e.g. a resize or a route that lands mid-page).
    if (boundaryRef?.current) {
      const cover = computeCover(boundaryRef.current.getBoundingClientRect().top, window.innerHeight)
      if (cover > 0.0005 && !runningRef.current) {
        runningRef.current = true
        render()
      }
    }

    return () => {
      runningRef.current = false
      // Never leave Lenis frozen if we're torn down mid-auto-complete (it
      // stops scroll while the clouds part — see the trigger in render()),
      // and never leave the capture-phase wheel/touch block engaged.
      if (auto.active) {
        auto.active = false
        lenisInstRef.current?.start()
      }
      autoplayLockRef.current = false
      window.removeEventListener('wheel', blockAutoInput, { capture: true })
      window.removeEventListener('touchmove', blockAutoInput, { capture: true })
      if (state.raf) cancelAnimationFrame(state.raf)
      gl.deleteBuffer(quad)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      glRef.current = null
    }
  }, [boundaryRef])

  // Start (or keep) the render loop whenever scrolling brings the seam into the
  // transition window. The loop stops itself once cover returns to 0, so idle
  // scroll elsewhere on the page costs nothing.
  useLenis((lenis) => {
    lenisInstRef.current = lenis
    const state = glRef.current
    const marker = boundaryRef?.current
    if (!state || !marker) return
    // An auto-complete in flight owns the loop already; don't restart it.
    if (autoRef.current.active) return
    const cover = computeCover(marker.getBoundingClientRect().top, window.innerHeight)
    if (cover > 0.0005 && !runningRef.current) {
      runningRef.current = true
      state.render()
    }
  })

  return <canvas ref={canvasRef} className="cloud-transition" aria-hidden="true" />
}
