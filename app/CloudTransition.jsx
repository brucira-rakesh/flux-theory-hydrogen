import { useEffect, useRef } from "react";
import { useLenis } from "lenis/react";
import { prefersReducedMotion } from "./hooks/useSpotlight";
import { isScrollLocked } from "./hooks/useScrollLock";
import { getScrollY, scrollRootTo } from "./utils/scrollRoot";
import { overlayWipe } from "./overlayWipeState";
import { scrollNavState } from "./utils/scrollNavState";
import "./CloudTransition.css";

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
`;

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
  // Quintic fade, matching SeawaveSteam.jsx - see the long note there. The
  // cubic smoothstep this replaces is only C1, so its curvature breaks at
  // every cell boundary and shows as a crease lattice ("folded paper") in
  // the smooth, low-frequency parts of the field. Same hash and same cell
  // values, so nothing is re-randomised; only the blend is smoother.
  // Less pronounced here than in the steam because 6 octaves bury the base
  // cell structure under detail, but this wipe runs on mobile too.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
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

  // Premultiply RGB by density. Safari/WebKit ignores premultipliedAlpha:false
  // and composites this overlay canvas as src.rgb + dst.rgb*(1-src.a), so
  // unpremultiplied near-white (col, density) adds as almost-opaque white
  // and the wipe reads as cartoon cutouts. Chrome/Firefox with
  // premultipliedAlpha:true + this output match the previous unpremultiplied
  // path bit-for-bit. HandoffFogWipe never hits this because it blends
  // inside SceneV2's opaque Three.js canvas, not as a page overlay.
  gl_FragColor = vec4(col * density, density);
}
`;

// Coverage as a function of the seam's viewport-space position. Peaks (full
// cover) while the seam sits just below the viewport — where the canvas swap
// is about to become visible — and ramps to 0 well before/after so the clouds
// gather and disperse gradually. All distances are in viewport heights.
const PLATEAU = 0.25; // half-height of the guaranteed-full-cover band
const RAMP = 0.45; // fade distance on each side of the plateau
// Center the coverage bump this many viewport-heights above the boundary
// marker (i.e. below the viewport, on the Seawave side). Set to PLATEAU+RAMP
// so coverage returns to EXACTLY 0 when the marker reaches the viewport top
// (markerTop = 0) — the moment SceneV2 pins with Scene One resting at FRONT.
// That's what lets the auto-complete (below) snap the page straight to the
// boundary under a full white-out and reveal Scene One with nothing left over
// to re-trigger the clouds, instead of the old window that stayed opaque for
// ~2.5 carousel steps past the boundary (which is what left the carousel
// rounded onto Scene Two by the time the clouds finally parted).
const COVER_CENTER = PLATEAU + RAMP;
const computeCover = (markerTop, viewportH) => {
  if (viewportH <= 0) return 0;
  const center = COVER_CENTER * viewportH;
  const d = Math.abs(markerTop - center) / viewportH;
  const cover = 1 - (d - PLATEAU) / RAMP;
  return Math.min(1, Math.max(0, cover));
};

// Once triggered (either direction), the wipe stops being scroll-scrubbed
// entirely and finishes itself on a timer: fade coverage IN over AUTO_IN_MS
// while holding the page dead still at the crossing point, teleport under
// that full white-out to the far side, then fade coverage back OUT over
// AUTO_OUT_MS — so the hand-off completes purely on its own, with zero
// further scrolling required and zero dependency on how fast the user
// happened to be scrolling at the moment it triggered.
const AUTO_OUT_MS = 800;
const AUTO_IN_MS = 800;
// After the clouds have parted, keep swallowing the originating flick
// until this much wheel/touch silence. A hard scroll from the hero is
// still emitting momentum ticks when the (now-short) wipe ends; without
// this those ticks hit swingCarousel as a fresh gesture and commit Scene
// Two the instant the bathroom is revealed. Matches the carousel's own
// WHEEL_GESTURE_GAP_MS idea, padded so a sparse trackpad tail can't sneak
// through.
const POST_WIPE_GESTURE_GAP_MS = 400;
// Shader is already a guaranteed-opaque core by ~0.72 (see SHADER_OPAQUE).
// Waiting out the rest of AUTO_IN_MS after that is just sitting on white
// before the page is allowed to drop — easeOut hits this by ~t=0.8, so a
// full 800ms gather was wasting ~160ms (and much more of the earlier ramp
// is already visually solid). Teleport as soon as cover is safely opaque.
const IN_COVER_READY = 0.96;
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
const AUTOPLAY_TRIGGER_MARKER_VH = 1.0;
// Re-arm the forward autoplay once the marker is back on the far side of the
// pin, so a later downward pass plays the wipe again.
//
// This MUST sit strictly ABOVE the trigger line, not below it. The rearm test
// runs every frame including mid-wipe, and a forward pass that actually plays
// its gather-in (skipInCover — see that prop) holds the page parked at
// markerTop ≈ the trigger line for the whole AUTO_IN_MS. At 0.99 (just BELOW
// 1.0, as this was) that hold satisfies the rearm on every one of those
// frames: the latch flips back on mid-wipe, and the next downward scroll
// after landing replays the entire transition. Above the line, the hold can
// never satisfy it. REVERSE_LANDING_MARKER_VH below is what keeps a genuine
// reverse landing clear of this, so that still re-arms as intended.
const FWD_REARM_MARKER_VH = 1.05;
// Where the reverse wipe parks the page, as viewport-heights of markerTop —
// i.e. how far back up into the preceding section it lands. Must clear
// FWD_REARM_MARKER_VH above, or scrolling back down after a reverse pass
// would find the forward latch still disarmed and skip the wipe entirely.
const REVERSE_LANDING_MARKER_VH = 1.1;
// Reverse (scrolling UP out of SceneV2) — the reference implementation the
// forward direction above now mirrors. Marker-scrubbing the clouds in on the
// way back would first have to scroll PAST the boundary — visibly unpinning
// SceneV2 and sliding it down before the clouds could hide it. Instead, the
// instant we cross the boundary heading up we hold SceneV2 exactly where it is
// and auto-fade the clouds IN over AUTO_IN_MS, then teleport back up into the
// Seawave section behind the full white-out and fade OUT (AUTO_OUT_MS) — so
// SceneV2 never appears to move; the clouds cover, then Seawave is revealed.

// Tolerance on the reverse-crossing test (`prevMarkerTop <= 0 && markerTop >
// 0`) below. markerTop sits at (essentially) exactly 0 not only right after
// the forward teleport lands SceneV2 at Scene One, but ALSO every time
// swingCarousel's own internal step transitions rest back at step 0 (Scene
// One is the step whose scrollWindowToStep() target IS the boundary
// position) — e.g. scrolling from Scene Two back to Scene One. Sub-pixel
// float noise in getBoundingClientRect()/the scroll offset around that exact
// value can read as a hair positive on one frame, which a bare `> 0` test
// misreads as "just scrolled up out of SceneV2 into Seawave" and fires the
// reverse wipe — even though the carousel never left SceneV2 at all. A
// couple of px of dead zone absorbs that noise; a genuine reverse scroll out
// of SceneV2 moves the marker far past this on the very next tick regardless.
//
// 2px only covers float rounding — it doesn't cover a real scroll delta.
// swingCarousel's captureScroll()/releaseScroll() toggle lenis.stop()/
// start() directly (not the ref-counted useScrollLock), so a physical
// trackpad/wheel gesture whose momentum is still "in flight" the instant
// step 0 commits can carry Lenis a few more pixels past the marker under
// its own inertia before decelerating to a stop — landing on step 0 and
// immediately (mis)reading as a genuine reverse exit. Widened to comfortably
// absorb that inertia carry-over while staying far short of a deliberate
// reverse scroll gesture's own travel.
const REVERSE_CROSSING_EPS_PX = 16;

// Smootherstep — density curve for scroll-scrubbed coverage only.
const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10);
// Quad ease-out — used on the IN gather. OUT uses a slower curve (below)
// because the shader is fully opaque until uProgress ~0.72, so a raw
// ease-out 1→0 dumps the white in ~200ms and the remaining 600ms is wisps.
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// Shader: opaque core at uProgress >= 0.72, noise gone around ~0.25.
// `hold` is the fraction of OUT spent on the opaque core before the
// dissolve — 0.55 of 800ms is ~440ms of white, which is why a raw duration
// cut used to look identical. Short HomeV3 outs pass a smaller hold so the
// reveal actually starts sooner instead of eating the whole cut as white.
const SHADER_OPAQUE = 0.78;
function sampleOutCover(t, hold = 0.55) {
  const x = Math.min(1, Math.max(0, t));
  const h = Math.min(0.85, Math.max(0.05, hold));
  if (x < h) {
    return 1 - (1 - SHADER_OPAQUE) * (x / h);
  }
  // Linear-ish dissolve (smoothstep) — ease-out here would dump 0.78→0
  // in the first 100ms of this half and we're back to an invisible tail.
  const u = (x - h) / (1 - h);
  const s = u * u * (3 - 2 * u);
  return SHADER_OPAQUE * (1 - s);
}

/** Instant jump — Lenis when it exists, native otherwise (Lenis-off tests). */
function snapScroll(lenis, y) {
  if (lenis) {
    lenis.scrollTo(y, { immediate: true, force: true });
    return;
  }
  scrollRootTo(y);
}

// Already sitting in the near-white band (Seawave's pin parks markerTop on
// the trigger line, where computeCover is ~0.89). Ramping 0.89→1 for a
// full AUTO_IN_MS is a second of white before Scene even jumps in.
const SKIP_IN_COVER = 0.75;

export default function CloudTransition({
  boundaryRef,
  // Overridable for callers whose preceding section does NOT park itself at
  // the trigger line (see SKIP_IN_COVER's own comment — that shortcut only
  // makes sense when `cover` is already naturally high at the moment the
  // forward trigger fires, e.g. Seawave's own pin resting there, or its
  // seamLeadCover ramp having already built coverage up during its closing
  // frames). Without an equivalent lead-in, `cover` at trigger time is
  // essentially always ~0.89 regardless — a pure function of
  // AUTOPLAY_TRIGGER_MARKER_VH/computeCover's own geometry, NOT of anything
  // the user actually watched build up on screen — so the shortcut fires
  // every time and the whole gather-in reads as an instant white flash.
  // Pass a value >= 1 to always play the full AUTO_IN_MS gather.
  skipInCover = SKIP_IN_COVER,
  // Overrides where the forward gather-in ramp STARTS from (0..1), instead
  // of the naturally-computed `cover` at the trigger instant (~0.89 — see
  // skipInCover's own comment on why that's a geometry constant, not a real
  // signal). Without this, forcing skipInCover past 1 still only stretches
  // an 0.89->1 ramp over AUTO_IN_MS — barely any visible climb. Pass 0 for a
  // full clear-to-opaque gather.
  gatherFrom,
  // Overrides where the REVERSE auto-complete's teleport lands (absolute
  // scrollY on this boundary's scroll root), instead of the default
  // `docTop - REVERSE_LANDING_MARKER_VH * viewportH` (parked just above the
  // marker, on the preceding section's own pin/rest position). That default
  // is right for a preceding section built to resume mid-scroll (e.g.
  // SeawaveSeq's own pin), but wrong for one that should always be re-entered
  // from its own untouched start — pass 0 there to land at the very top of
  // that section instead of wherever its last-held frame happened to be.
  reverseLandTarget,
  // Called once the reverse auto-complete has fully landed (clouds parted,
  // page teleported) — after `reverseLandTarget`, if used, so a paired
  // section can hard-reset its own scroll-driven state (e.g. IntroHeroV3's
  // sequence playhead) back to match the landing spot instead of leaving it
  // wherever the forward journey left it.
  onReverseLand,
  // Per-instance gather / reveal durations. HomeV2's Seawave pin is already
  // near-white at trigger so the 800ms defaults (and skipInCover shortcut)
  // are right there; HomeV3 always plays a full 0→1 gather and those
  // defaults freeze the page for 1.6s before the next section is even
  // interactable. Override both down there.
  inMs = AUTO_IN_MS,
  outMs = AUTO_OUT_MS,
}) {
  const canvasRef = useRef(null);
  const inMsRef = useRef(inMs);
  const outMsRef = useRef(outMs);
  inMsRef.current = inMs;
  outMsRef.current = outMs;
  const coverRef = useRef(0);
  const runningRef = useRef(false);
  const glRef = useRef(null);
  // The live Lenis instance (captured off its tick below) — used by the
  // auto-complete to snap/hold the page at the boundary while the clouds part.
  const lenisInstRef = useRef(null);
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
    phase: "out",
    enforce: false,
    start: 0,
    from: 1,
    to: 0,
    target: 0,
    outTarget: 0,
    // 'forward' | 'reverse' — which way this auto-complete is landing. Only
    // read once, right when the whole sequence finishes (see the completion
    // branch below): the sentinel it primes lenisPrevMarkerTopRef with is
    // direction-specific, and reusing the forward one for a reverse landing
    // is what caused a spurious immediate replay on continued upward scroll
    // (see that branch's own comment).
    direction: "forward",
  });
  // True for the duration of the forward auto-complete (mirrors auto.active,
  // set/cleared alongside it — see the trigger below) — gates the
  // capture-phase wheel/touch block below. A SEPARATE flag from `auto.active`
  // because `lenis.stop()` alone isn't enough here: swingCarousel.js has its
  // own, entirely independent `window` wheel listener (see its own comment:
  // "Lenis has its own wheel listener and momentum, entirely independent
  // of..."), which would otherwise be free to grab the input and commit a
  // carousel step the instant the page is parked at the boundary, before the
  // clouds have finished parting.
  const autoplayLockRef = useRef(false);
  // Last wheel/touch we swallowed while autoplayLockRef was up — the
  // post-wipe silence timer (see POST_WIPE_GESTURE_GAP_MS) is measured
  // from this, not from visual complete.
  const lastBlockedInputRef = useRef(0);
  const postWipeHoldRafRef = useRef(0);
  // Forward auto-complete latch: true = a forward pass may still fire. Set
  // false the instant it fires, re-armed only once the marker climbs back up
  // into Seawave (see FWD_REARM_MARKER_VH) — so scrolling on into the carousel
  // after landing on Scene One can't keep re-triggering the wipe.
  const forwardArmedRef = useRef(true);
  // One-tick confirmation before the forward trigger below actually commits
  // (see its own comment) — closes the remaining half of the same race
  // SEAWAVE_ENGAGE_OFFSET_PX's head start addresses: this render() loop is
  // its own independent requestAnimationFrame chain, not synchronized to
  // the Lenis tick that runs SeawaveSeq's probe/engage, so a hard flick can
  // still land both crossings in the same wall-clock instant despite the
  // head start. Requiring the trigger condition to hold across two
  // consecutive render() ticks (not just one) gives SeawaveSeq's own
  // synchronous acquireScrollLock a full extra Lenis tick to have already
  // landed before this actually commits.
  const forwardTriggerPendingRef = useRef(false);
  // Last scroll offset / marker-top seen by the render loop — lets it tell
  // scrolling down into the boundary (forward auto-complete) from crossing the
  // boundary upward out of SceneV2 (reverse auto-complete).
  const lastScrollRef = useRef(0);
  const lastMarkerTopRef = useRef(0);
  // Separate copies of the same bookkeeping, but for the useLenis tick
  // callback below (see its own comment) — it has to run its own
  // goingUp/crossing check every tick, independent of whether the render()
  // rAF loop happens to be alive that frame. Sharing lastScrollRef/
  // lastMarkerTopRef with render() breaks BOTH: whichever of the two runs
  // first in a given frame updates the shared ref, so the other reads
  // prevScroll === scrollY and its own goingDown/goingUp comes out false —
  // that's what took the forward trigger down when this was first added.
  const lenisPrevScrollRef = useRef(0);
  const lenisPrevMarkerTopRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl =
      canvas.getContext("webgl", {
        alpha: true,
        // true + shader-side premultiply: Safari ignores `false` and still
        // composites as premultiplied (same bug as SeawaveClouds). See the
        // gl_FragColor comment in FRAGMENT_SRC.
        premultipliedAlpha: true,
        antialias: true,
        depth: false,
      }) ||
      canvas.getContext("experimental-webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        depth: false,
      });
    if (!gl) return undefined;

    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          "[CloudTransition] shader compile failed:",
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return undefined;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[CloudTransition] program link failed:",
        gl.getProgramInfoLog(program),
      );
      return undefined;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    // Full-screen triangle strip in clip space.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "uTime");
    const uProgress = gl.getUniformLocation(program, "uProgress");
    const uResolution = gl.getUniformLocation(program, "uResolution");

    gl.useProgram(program);
    // Single full-screen quad, no overlapping geometry — blending is
    // unnecessary. The fragment shader already writes premultiplied RGB
    // (see gl_FragColor), which is what this context (premultipliedAlpha:
    // true) composites onto the page with.
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    const state = {
      gl,
      program,
      quad,
      vs,
      fs,
      uTime,
      uProgress,
      uResolution,
      width: 0,
      height: 0,
    };
    glRef.current = state;

    const reduced = prefersReducedMotion();
    const start = performance.now();

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (w !== state.width || h !== state.height) {
        canvas.width = w;
        canvas.height = h;
        state.width = w;
        state.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    // Size once + on resize, not every rAF — innerWidth is cheap-ish but
    // still a layout-adjacent read, and the backing store almost never
    // changes mid-wipe.
    syncSize();
    window.addEventListener("resize", syncSize, { passive: true });

    const releasePostWipeHold = () => {
      autoplayLockRef.current = false;
      overlayWipe.autoActive = false;
      const lenis = lenisInstRef.current;
      // Kill any target Lenis stashed during the originating flick so
      // start() can't coast from Scene One into Scene Two on its own.
      snapScroll(lenis, getScrollY());
      if (!isScrollLocked()) lenis?.start();
    };

    const armPostWipeHold = () => {
      autoplayLockRef.current = true;
      overlayWipe.autoActive = true;
      lastBlockedInputRef.current = performance.now();
      // Cap from visual complete, NOT from the last swallowed tick.
      // Resetting the timer on every wheel meant a laptop trackpad that
      // never lifted (no cursor move = no 400ms of silence) kept this
      // lock armed forever and the bathroom carousel looked dead.
      const holdUntil = performance.now() + POST_WIPE_GESTURE_GAP_MS;
      if (postWipeHoldRafRef.current) {
        cancelAnimationFrame(postWipeHoldRafRef.current);
      }
      const tick = () => {
        if (performance.now() >= holdUntil) {
          postWipeHoldRafRef.current = 0;
          // If the flick already went quiet, the next wheel is leftover
          // momentum — ask the carousel to eat it. If ticks are still
          // streaming, the user is still scrolling on purpose: don't
          // latch, let the carousel take steps after its own cooldown.
          const stillStreaming =
            performance.now() - lastBlockedInputRef.current < 80;
          overlayWipe.consumeGesture = !stillStreaming;
          releasePostWipeHold();
          return;
        }
        postWipeHoldRafRef.current = requestAnimationFrame(tick);
      };
      postWipeHoldRafRef.current = requestAnimationFrame(tick);
    };

    const render = () => {
      const marker = boundaryRef?.current;
      const viewportH = window.innerHeight;
      const now = performance.now();
      const auto = autoRef.current;

      // Always track scroll/marker deltas, even mid-auto-complete, so the
      // direction/boundary-crossing tests below stay correct across phases.
      const markerTop = marker ? marker.getBoundingClientRect().top : Infinity;
      const scrollY = getScrollY();
      const prevScroll = lastScrollRef.current;
      const prevMarkerTop = lastMarkerTopRef.current;
      lastScrollRef.current = scrollY;
      lastMarkerTopRef.current = markerTop;
      const goingDown = scrollY > prevScroll;
      const goingUp = scrollY < prevScroll;

      // Re-arm the forward auto-complete whenever the marker is back up in
      // Seawave — evaluated every frame (even mid-auto) so the reverse wipe,
      // which parks the marker on SeawaveSeq's pin (1vh above the seam),
      // leaves forward armed again.
      if (markerTop > FWD_REARM_MARKER_VH * viewportH)
        forwardArmedRef.current = true;

      let cover;
      if (auto.active) {
        // Reverse phases hold SceneV2 (or the revealed Seawave) dead still:
        // re-assert stop() every frame to undo the carousel's edge start(),
        // and yank the page back if a stray tick slipped it before we did.
        if (auto.enforce) {
          const lenis = lenisInstRef.current;
          if (lenis && !lenis.isStopped) lenis.stop();
          if (Math.abs(scrollY - auto.target) > 2) {
            snapScroll(lenis, auto.target);
          }
        }

        const dur = auto.phase === "in" ? inMsRef.current : outMsRef.current;
        const t = Math.min(1, (now - auto.start) / dur);
        const inCover =
          auto.from + (auto.to - auto.from) * easeOut(t);
        // Don't sit on full white waiting out the rest of inMs — the
        // teleport is what "drops" the next section, and the shader has
        // already sealed the seam once cover crosses IN_COVER_READY.
        const phaseDone =
          auto.phase === "out" ? t >= 1 : t >= 1 || inCover >= IN_COVER_READY;
        if (phaseDone) {
          if (auto.phase === "in") {
            // Full white-out reached while holding SceneV2 — now teleport up
            // into Seawave behind the clouds and fade OUT to reveal it.
            auto.phase = "out";
            auto.from = 1;
            auto.to = 0;
            auto.target = auto.outTarget;
            auto.start = now;
            const lenis = lenisInstRef.current;
            snapScroll(lenis, auto.outTarget);
            lenis?.stop();
            cover = 1;
            // Reset the landing section's own scroll-driven frame HERE, under
            // full opaque cover, not after the fade-OUT below finishes — the
            // fade-OUT is a reveal of whatever is already sitting under the
            // clouds, so waiting until it completes means the stale
            // (previous) frame is what visibly reveals, with the reset only
            // snapping to frame 0 on the very last tick. Doing it at the
            // teleport instant, while the screen is still fully white, means
            // the correct frame is already showing for the entire reveal.
            if (auto.direction === "reverse") onReverseLand?.();
          } else {
            auto.active = false;
            auto.enforce = false;
            coverRef.current = 0;
            overlayWipe.cover = 0;
            runningRef.current = false;
            canvas.style.opacity = "0";
            canvas.style.visibility = "hidden";
            canvas.style.willChange = "auto";
            // Visual wipe is done, but the flick that triggered it is often
            // still in flight — especially now that IN/OUT are sub-400ms.
            // Keep the capture-phase wheel block + autoActive up until that
            // gesture goes silent, otherwise swingCarousel treats the tail
            // as a brand-new step and lands on Scene Two.
            snapScroll(lenisInstRef.current, getScrollY());
            armPostWipeHold();
            // The forward landing spot IS markerTop = 0 by construction
            // (auto.outTarget was computed as the exact docTop where the
            // marker sits at the viewport top), but the browser rounds
            // scrollTo() to a device pixel, so the actual post-teleport
            // getBoundingClientRect().top can land a hair to either side of
            // 0. If it lands at, say, +0.4px, the useLenis reverse-crossing
            // check below (`prevMarkerTop <= 0 && markerTop > 0`) would
            // already read as "past" the crossing before any scroll
            // happens — scrolling up from there only makes markerTop MORE
            // positive, so the edge is never seen and an immediate
            // scroll-back silently falls through to plain scroll with no
            // clouds. Force the sentinel unambiguously onto the SceneV2
            // side so the very next upward tick, however small, is
            // guaranteed to read as a crossing.
            //
            // That sentinel only makes sense for a FORWARD landing. A
            // REVERSE landing puts the marker on the far (positive) side
            // instead — forcing the same -1 there falsely reads as "we were
            // just below the crossing line", so continuing to scroll up from
            // the landed position re-satisfies the reverse-crossing test on
            // the very next tick and replays the whole wipe a second time.
            // Priming it from the actual just-landed position (already
            // fresh — lastMarkerTopRef is updated at the top of this same
            // render() call) makes that comparison correctly read "already
            // well past the line" instead.
            lenisPrevMarkerTopRef.current =
              auto.direction === "reverse" ? lastMarkerTopRef.current : -1;
            lenisPrevScrollRef.current = getScrollY();
            return;
          }
        } else {
          // Cap the opaque-core hold at ~120ms only on the short HomeV3
          // outs — 800ms defaults keep the original 0.55 fraction so
          // HomeV2's Seawave wipe is untouched.
          const outHold = dur < 500 ? Math.min(0.55, 120 / dur) : 0.55;
          cover = auto.phase === "out" ? sampleOutCover(t, outHold) : inCover;
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
        // ...and forced to 0 for as long as something holds the scroll lock.
        // SeawaveSeq pins itself with its bottom edge ON this marker, parking
        // markerTop at exactly AUTOPLAY_TRIGGER_MARKER_VH — where natural
        // coverage is already ~0.89, i.e. the clouds would sit almost fully
        // opaque over that section for its entire run. The trigger line was
        // calibrated for a Seawave several viewports tall, where this marker
        // position meant "its timeline has finished settling" rather than "its
        // one and only viewport is now perfectly framed".
        // ...and forced to 0 across Seawave's upward exit. See
        // scrollNavState.suppressSeamCover: exitUp() drops the scroll lock
        // while the page is still parked with markerTop exactly ON this
        // line, so without this the frame between the release and the exit
        // tween's first step satisfied every condition below and painted
        // ~0.89 coverage — a one-frame white-out. Cleared here, off the
        // marker itself, so it lifts the moment the page has genuinely moved
        // rather than after some guessed delay.
        if (
          scrollNavState.suppressSeamCover &&
          marker &&
          markerTop > AUTOPLAY_TRIGGER_MARKER_VH * viewportH
        ) {
          scrollNavState.suppressSeamCover = false;
        }

        // `!forwardArmedRef.current` — computeCover's own geometry is
        // already ~0.89 at markerTop === the trigger line (COVER_CENTER
        // sits below the line, not on it), so the instant markerTop first
        // satisfies the line test above, this would otherwise jump straight
        // from the forced 0 to ~0.89 in a single frame — a snap, not a
        // build-up, since the auto-complete (which owns the real gather-in
        // ramp, from `gatherFrom`) hasn't even fired yet at that point. A
        // fresh, not-yet-fired forward pass always has forwardArmedRef.current
        // === true here, so this keeps the geometric value out of the paint
        // entirely for that case — real buildup for a caller that has one
        // (Seawave's seamLeadCover) still comes through via the floor just
        // below, computed independently of this. Once a pass has actually
        // fired, forwardArmedRef.current flips false, but by then auto.active
        // is true and this whole branch is skipped anyway; the only other
        // time it reads false here is the reverse crossing (marker recrossing
        // this same 0..1vh band from below), where the geometric value is
        // exactly what auto.from should start from — so this leaves that
        // path untouched.
        cover =
          marker &&
          !isScrollLocked() &&
          !scrollNavState.suppressSeamCover &&
          !forwardArmedRef.current &&
          markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH
            ? computeCover(markerTop, viewportH)
            : 0;

        // ...except for Seawave's own closing frames. Everything above is a
        // POSITION-driven wipe, which is why it has to read 0 while that
        // section holds the scroll lock (its pin parks the marker right on
        // the trigger line, at ~0.89 natural coverage). But that also meant
        // the wipe could not start until Seawave had played every last frame
        // and released — a dead beat on a finished still frame before
        // anything moved. useSeawaveSeq now publishes a PLAYHEAD-driven ramp
        // across its last SEAWAVE_HANDOFF_LEAD_FRAMES, which we take as a
        // floor here: the clouds gather over those closing frames, scrubbed
        // by the same scroll that is advancing them, and are already at full
        // cover by the time the lock drops. See scrollNavState.seamLeadCover.
        const leadCover = scrollNavState.seamLeadCover || 0;
        if (leadCover > cover) cover = leadCover;

        // Position/lock/arm conditions only — deliberately WITHOUT `goingDown`,
        // so the confirming tick below can still fire even if the scroll has
        // already decelerated to rest by then (see forwardTriggerConfirmed's
        // own comment). `goingDown` is what starts the pending latch in the
        // first place, just not what's required to keep it valid one tick
        // later.
        const forwardTriggerPositionReady =
          marker &&
          forwardArmedRef.current &&
          !isScrollLocked() &&
          // A PageProgress rail jump tweens straight past this boundary on
          // its way further down the page — this line's own position-based
          // test would otherwise read that tween as a real crossing and
          // hijack it here instead. See scrollNavState.js.
          !scrollNavState.skippingSections &&
          markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH;
        const forwardTriggerReady = forwardTriggerPositionReady && goingDown;
        // Captured BEFORE updating the ref below — otherwise "was already
        // pending" and "just became pending" collapse into the same tick
        // and the debounce below never actually waits a tick.
        //
        // Deliberately keyed on `forwardTriggerPositionReady`, NOT
        // `forwardTriggerReady`/goingDown: Lenis eases a scroll to a stop,
        // and a moderate flick can easily finish decelerating — landing
        // exactly in this narrow below-the-line window — within the single
        // tick between "just arrived" and "confirm". That tick reads
        // goingDown === false (scrollY hasn't changed since the last frame)
        // even though the marker got here by genuinely scrolling down a
        // moment ago. Requiring fresh downward motion on BOTH ticks silently
        // dropped the wipe on exactly that (common) cadence — confirmed by
        // instrumenting this boundary: the marker jumped from above the line
        // to just past it, `goingDown` was true on the tick that set the
        // pending latch, then false on the very next tick before the trigger
        // ever got to confirm. Position + arm/lock state is enough on its
        // own to confirm once the FIRST tick already proved forward motion.
        const forwardTriggerConfirmed =
          forwardTriggerPositionReady && forwardTriggerPendingRef.current;
        forwardTriggerPendingRef.current = forwardTriggerReady;

        if (forwardTriggerConfirmed) {
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
          //
          // Skipped entirely while something else holds the scroll lock:
          // SeawaveSeq pins itself with its bottom edge on this very marker,
          // which puts markerTop at exactly AUTOPLAY_TRIGGER_MARKER_VH — so
          // without that guard the wipe fires the instant that section
          // engages, and fights it for control of Lenis.
          forwardArmedRef.current = false;
          // From here the auto-complete's own timeline owns coverage; a
          // lingering floor would hold the screen white right through the
          // fade-OUT. See scrollNavState.seamLeadCover.
          scrollNavState.seamLeadCover = 0;
          const docTop = scrollY + markerTop;
          // The trigger LINE, not wherever the scroll actually landed. Those
          // are the same thing only on a slow scroll that stops within a
          // pixel of the line; a fast flick (or this trigger's own one-tick
          // debounce) lands well past it, and holding there means holding at
          // a scroll position where the preceding section's sticky pin has
          // already begun to lift — the sliver of the next section showing
          // through underneath. Snapping back to the line puts the page
          // exactly where that pin is still fully stuck, so the gather-in
          // always plays over a covered frame no matter how hard the scroll
          // overshot.
          const holdTarget = docTop - AUTOPLAY_TRIGGER_MARKER_VH * viewportH;
          autoplayLockRef.current = true;
          auto.active = true;
          auto.enforce = true;
          auto.direction = "forward";
          auto.start = now;
          const lenis = lenisInstRef.current;
          // Seawave's pin already sits in the near-white band (~0.89 cover).
          // Don't spend AUTO_IN_MS ramping the last 10% — jump Scene in now
          // and fade out. User-flick from a clear frame (cover ~0) still
          // does the short IN so the seam never shows.
          if (cover >= skipInCover) {
            auto.phase = "out";
            auto.from = 1;
            auto.to = 0;
            auto.target = docTop;
            auto.outTarget = docTop;
            snapScroll(lenis, docTop);
            lenis?.stop();
            cover = 1;
          } else {
            auto.phase = "in";
            // Natural `cover` at the trigger line is ~0.89 by pure geometry
            // (see AUTOPLAY_TRIGGER_MARKER_VH/computeCover) — with no lead-in
            // ramp behind it (see gatherFrom's own prop comment), starting
            // the gather there leaves almost no visible room to climb before
            // hitting solid white. gatherFrom overrides the START of the
            // ramp for exactly that case; left unset, this is the original,
            // already-mostly-there value.
            auto.from = gatherFrom ?? cover;
            auto.to = 1;
            auto.target = holdTarget;
            auto.outTarget = docTop;
            snapScroll(lenis, holdTarget);
            lenis?.stop();
            // Sync this frame's paint to the ramp's actual start. Without
            // this, `cover` still holds the natural ~0.89 geometry value
            // computed above (pre-trigger), so gatherFrom's whole point —
            // starting the gather from a lower, more visible value like 0 —
            // is undone for exactly one frame: this tick paints at ~0.89
            // (auto.active bypasses `ease()`, so that's raw, near-opaque),
            // then the very next frame drops back down to auto.from to begin
            // the real ramp. That one-frame spike-then-drop is what reads as
            // a white flash right when the wipe triggers.
            cover = auto.from;
          }
        } else if (
          marker &&
          goingUp &&
          !isScrollLocked() &&
          !scrollNavState.skippingSections &&
          // A section pinned ON this seam owns its own upward crossing —
          // see scrollNavState.suppressSeamReverse. `!isScrollLocked()`
          // cannot stand in for this: the claim outlives the lock.
          !scrollNavState.suppressSeamReverse &&
          prevMarkerTop <= REVERSE_CROSSING_EPS_PX &&
          markerTop > REVERSE_CROSSING_EPS_PX
        ) {
          // REVERSE: just crossed the boundary heading UP, leaving SceneV2.
          // Snap SceneV2 back into its pin and fade the clouds IN over it
          // (phase 'in'); once opaque, the block above teleports up into
          // Seawave and fades out — SceneV2 itself never appears to move.
          scrollNavState.seamLeadCover = 0;
          const docTop = scrollY + markerTop;
          autoplayLockRef.current = true;
          auto.active = true;
          auto.phase = "in";
          auto.enforce = true;
          auto.direction = "reverse";
          auto.from = cover;
          auto.to = 1;
          auto.target = docTop;
          // Land on SeawaveSeq's pin (section is exactly one viewport tall, so
          // the pin is one vh above the seam). The old REVEAL_MARKER_VH offset
          // was calibrated for a multi-viewport Seawave and parked 0.4vh ABOVE
          // the pin, which meant SeawaveSeq never saw an upward crossing and
          // reverse re-entry broke. Teleporting onto the pin lets SeawaveSeq
          // grab the lock during the white-out and start reverse playback as
          // the clouds part.
          //
          // `reverseLandTarget` overrides this entirely for callers whose
          // preceding section should always be re-entered at its own start
          // rather than resumed where it was left — see that prop's comment.
          auto.outTarget =
            reverseLandTarget ??
            docTop - REVERSE_LANDING_MARKER_VH * viewportH;
          auto.start = now;
          const lenis = lenisInstRef.current;
          snapScroll(lenis, docTop);
          lenis?.stop();
        }
      }
      coverRef.current = cover;
      overlayWipe.cover = cover;
      overlayWipe.autoActive = auto.active;

      // ...but never mid-debounce. A forward trigger that is `ready` has only
      // armed the one-tick confirmation (forwardTriggerPendingRef) so far;
      // stopping here would end the loop before the confirming tick can run,
      // leaving the wipe to depend on some later scroll tick happening to
      // restart it. Coverage is legitimately 0 in exactly the case that
      // matters most — a fast flick past the line, where the marker is
      // already negative — so this is not a rare corner.
      if (cover <= 0.0005 && !auto.active && !forwardTriggerPendingRef.current) {
        // Stop the loop (and stop touching the GPU) once the boundary has left
        // the transition window entirely.
        overlayWipe.cover = 0;
        overlayWipe.autoActive = false;
        runningRef.current = false;
        canvas.style.opacity = "0";
        canvas.style.visibility = "hidden";
        canvas.style.willChange = "auto";
        return;
      }
      canvas.style.visibility = "visible";
      canvas.style.willChange = "opacity";
      canvas.style.opacity = "1";

      gl.useProgram(program);
      gl.uniform1f(uTime, reduced ? 0 : (now - start) / 1000);
      // Auto-complete already eases in time; extra smootherstep on top is
      // what made 800ms OUT look like 200ms (opaque core dies at 0.72).
      gl.uniform1f(uProgress, auto.active ? cover : ease(cover));
      gl.uniform2f(uResolution, state.width, state.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      state.raf = requestAnimationFrame(render);
    };
    state.render = render;

    lastScrollRef.current = getScrollY();
    lenisPrevScrollRef.current = getScrollY();
    lenisPrevMarkerTopRef.current = boundaryRef?.current
      ? boundaryRef.current.getBoundingClientRect().top
      : 0;

    // See scrollNavState.syncSeamAfterJump's own comment: a PageProgress rail
    // jump teleports the page across (or onto) this seam without ever
    // scrolling through it, so every prev-position ref below is left
    // describing where the page WAS. Re-prime them all from the live marker,
    // and set the forward latch to match which side we actually landed on —
    // otherwise landing at the carousel (already past the seam) leaves
    // `forwardArmedRef` true and the very next downward tick replays the
    // entire wipe.
    scrollNavState.syncSeamAfterJump = (armed) => {
      const m = boundaryRef?.current;
      const top = m ? m.getBoundingClientRect().top : Infinity;
      const y = getScrollY();
      forwardArmedRef.current = armed;
      forwardTriggerPendingRef.current = false;
      lastMarkerTopRef.current = top;
      lastScrollRef.current = y;
      lenisPrevMarkerTopRef.current = top;
      lenisPrevScrollRef.current = y;
    };
    // See scrollNavState.startSeamCoverLoop's own comment: the restart check
    // at the bottom of this file rides Lenis's scroll callback, and Lenis is
    // STOPPED for the whole time Seawave holds the scroll lock — which is
    // exactly when its closing-frames lead ramp needs painting. This is how
    // that section kicks the loop awake by hand.
    scrollNavState.startSeamCoverLoop = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      render();
    };

    // Stable across this effect's life (never reassigned) — captured so the
    // cleanup below can safely read it without the stale-ref lint warning.
    const auto = autoRef.current;

    // Swallow wheel/touch for the whole forward autoplay tween
    // (autoplayLockRef) so a hard, continued scroll can't reach the SceneV2
    // carousel and commit it onto Scene Two underneath the clouds. Capture
    // phase + stopImmediatePropagation preempts BOTH the carousel's and
    // Lenis's own window listeners (both bubble-phase); preventDefault stops
    // native scrolling. Only active during the forward autoplay — reverse
    // holds via `enforce`, and normal scrolling is never touched.
    const blockAutoInput = (event) => {
      if (autoplayLockRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        lastBlockedInputRef.current = performance.now();
      }
    };
    window.addEventListener("wheel", blockAutoInput, {
      capture: true,
      passive: false,
    });
    window.addEventListener("touchmove", blockAutoInput, {
      capture: true,
      passive: false,
    });

    // Prime one frame if we mount already inside the transition window
    // (e.g. a resize or a route that lands mid-page).
    if (boundaryRef?.current) {
      const cover = computeCover(
        boundaryRef.current.getBoundingClientRect().top,
        window.innerHeight,
      );
      if (cover > 0.0005 && !runningRef.current) {
        runningRef.current = true;
        render();
      }
    }

    return () => {
      runningRef.current = false;
      scrollNavState.syncSeamAfterJump = null;
      scrollNavState.startSeamCoverLoop = null;
      scrollNavState.seamLeadCover = 0;
      // Never leave Lenis frozen if we're torn down mid-auto-complete (it
      // stops scroll while the clouds part — see the trigger in render()),
      // and never leave the capture-phase wheel/touch block engaged.
      if (postWipeHoldRafRef.current) {
        cancelAnimationFrame(postWipeHoldRafRef.current);
        postWipeHoldRafRef.current = 0;
      }
      if (auto.active || autoplayLockRef.current) {
        auto.active = false;
        autoplayLockRef.current = false;
        if (!isScrollLocked()) lenisInstRef.current?.start();
      }
      window.removeEventListener("wheel", blockAutoInput, { capture: true });
      window.removeEventListener("touchmove", blockAutoInput, {
        capture: true,
      });
      if (state.raf) cancelAnimationFrame(state.raf);
      window.removeEventListener("resize", syncSize);
      overlayWipe.cover = 0;
      overlayWipe.autoActive = false;
      overlayWipe.consumeGesture = false;
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      glRef.current = null;
    };
  }, [boundaryRef]);

  // Start (or keep) the render loop whenever scrolling brings the seam into the
  // transition window. The loop stops itself once cover returns to 0, so idle
  // scroll elsewhere on the page costs nothing.
  //
  // computeCover is deliberately 0 for the ENTIRE time markerTop is negative
  // (i.e. the whole time the user is browsing inside SceneV2 — see
  // COVER_CENTER's comment: coverage only ever builds on the Seawave/positive
  // side, by design). That means the rAF `render()` loop's own self-stop
  // (`cover <= 0.0005 && !auto.active`) kills it almost immediately after the
  // forward hand-off lands on SceneV2, and nothing here was restarting it: the
  // `cover > 0.0005` gate below never fires while markerTop stays negative, so
  // the reverse-crossing test that lives inside render() (`prevMarkerTop <= 0
  // && markerTop > 0`) never got a chance to run for most of that scroll
  // range. In practice the pin looked like it "sometimes" released without
  // the clouds: it only worked when the loop happened to still be alive by
  // luck (e.g. scrolling back up again before it had a chance to stop).
  //
  // Fix: track markerTop/prevMarkerTop and watch for the same upward crossing
  // right here, on every Lenis tick, independent of whether the GL render
  // loop is currently running — this callback is cheap (no GPU work), so it
  // can safely run continuously. Once it either detects a crossing or finds
  // nonzero coverage, it (re)starts the render loop, which then takes over.
  useLenis((lenis) => {
    lenisInstRef.current = lenis;
    const state = glRef.current;
    const marker = boundaryRef?.current;
    if (!state || !marker) return;

    const auto = autoRef.current;
    const viewportH = window.innerHeight;
    const markerTop = marker.getBoundingClientRect().top;
    const scrollY = getScrollY();
    const prevMarkerTop = lenisPrevMarkerTopRef.current;
    const goingUp = scrollY < lenisPrevScrollRef.current;
    lenisPrevScrollRef.current = scrollY;
    lenisPrevMarkerTopRef.current = markerTop;

    if (markerTop > FWD_REARM_MARKER_VH * viewportH) {
      forwardArmedRef.current = true;
    }

    // An auto-complete in flight owns the loop already; don't restart it or
    // re-evaluate triggers out from under it.
    if (auto.active) return;

    // See scrollNavState.js — a PageProgress rail jump passing through this
    // boundary must not be read as a real crossing, and mustn't restart the
    // render loop below off a coverage value that will settle right back to
    // 0 once the jump lands anyway.
    if (scrollNavState.skippingSections) return;

    if (
      goingUp &&
      !isScrollLocked() &&
      // Mirrors render()'s own reverse test — see that guard's comment and
      // scrollNavState.suppressSeamReverse.
      !scrollNavState.suppressSeamReverse &&
      prevMarkerTop <= REVERSE_CROSSING_EPS_PX &&
      markerTop > REVERSE_CROSSING_EPS_PX
    ) {
      const docTop = scrollY + markerTop;
      autoplayLockRef.current = true;
      auto.active = true;
      auto.phase = "in";
      auto.enforce = true;
      auto.direction = "reverse";
      auto.from = computeCover(prevMarkerTop, viewportH);
      auto.to = 1;
      auto.target = docTop;
      auto.outTarget =
        reverseLandTarget ?? docTop - REVERSE_LANDING_MARKER_VH * viewportH;
      auto.start = performance.now();
      scrollNavState.seamLeadCover = 0;
      snapScroll(lenis, docTop);
      lenis.stop();
    }

    // Mirror render()'s own gating exactly (see its `cover =` assignment):
    // while something holds the scroll lock — SeawaveSeq parks its pin
    // right at AUTOPLAY_TRIGGER_MARKER_VH, where natural coverage is ~0.89
    // — coverage must read as 0, or this restart check spins render() back
    // up every single tick for as long as the section sits locked there.
    // render() itself re-applies this same guard once invoked, so that
    // spin-up was harmless before (it always immediately self-stopped
    // again), but it's still wasted GPU work every tick, and computing
    // coverage two different ways here is exactly the kind of drift that
    // caused the locked-pin case to need this guard in the first place.
    const cover = auto.active
      ? 1
      : Math.max(
          scrollNavState.seamLeadCover || 0,
          !isScrollLocked() &&
          markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH
            ? computeCover(markerTop, viewportH)
            : 0,
        );
    // A forward wipe is still owed here: the marker is at or past the trigger
    // line, nothing else holds scroll, and the latch has not been spent.
    //
    // Without this the loop's own start condition is coverage alone — and
    // computeCover is 0 for every NEGATIVE markerTop (coverage only ever
    // builds on the approach side, see COVER_CENTER). A fast flick can carry
    // the marker from above the trigger line to well past 0 inside a single
    // tick, so coverage reads 0 on both the tick before and the tick after:
    // the loop never spins up, and the forward trigger — which lives inside
    // render() — is never evaluated at all. That is a wipe that simply does
    // not happen, dropping the user straight into the next section. Starting
    // the loop off the same condition the trigger itself tests means the
    // trigger always gets a chance to run; `holdTarget` (see the trigger)
    // snaps the page back to the line, so a late detection still plays the
    // gather over a properly covered frame.
    const forwardWipeOwed =
      !auto.active &&
      forwardArmedRef.current &&
      !isScrollLocked() &&
      markerTop <= AUTOPLAY_TRIGGER_MARKER_VH * viewportH;

    if (
      (cover > 0.0005 || auto.active || forwardWipeOwed) &&
      !runningRef.current
    ) {
      runningRef.current = true;
      state.render();
    }
  });

  return (
    <canvas ref={canvasRef} className="cloud-transition" aria-hidden="true" />
  );
}
