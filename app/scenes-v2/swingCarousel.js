import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { isScrollLocked } from "../hooks/useScrollLock";

// ---------------------------------------------------------------------
// Scroll-gesture-driven "swing" carousel for a FIXED camera.
//
// Model: two physical slots, FRONT (0,0,-radius) and BACK (0,0,+radius).
// Scenes alternate slot ownership by index parity — even indices (0,2)
// always travel through the same slot pair, odd indices (1,3) the other —
// which is what pairs scene one/three and two/four together. Only the
// scene currently resting at FRONT needs to be on screen; everything else
// sits at BACK, invisible (visibility is driven by React state so mounted
// scene components skip their own per-frame work, see Scene.v2.jsx).
//
// Every bit of motion — live wheel/touch tracking AND the commit/cancel
// settle — is driven through ONE gsap tween animating a single `t` proxy,
// never a hand-rolled lerp/instant set. Each new wheel tick just retargets
// that same tween (gsap continues from whatever value it's currently at,
// so retargeting mid-flight never jumps), which is what makes a burst of
// small, choppy wheel events read as one continuous, smooth motion instead
// of a stair-step.
// ---------------------------------------------------------------------

const STEP_VH_FRACTION = 0.5; // one step = 50vh of scroll, per spec
const COMMIT_THRESHOLD = 0.22; // fraction of a step's travel that auto-finishes the turn
const IDLE_MS = 380; // no ticks for this long before threshold -> rubber-band cancel
// Caps a single TRACKPAD event's contribution. A trackpad streams ~60
// events/sec, so this reads as one smooth continuous gesture. It is NOT a
// sane budget for a physical mouse wheel, which fires roughly one event per
// physical notch: at 1% of a step per event, crossing COMMIT_THRESHOLD took
// 22 separate notches to advance a single scene — the reported "very slow,
// weird long threshold". Notch-based wheels take the discrete path instead
// (see isNotchedWheel / stepOnce below), one notch = one scene.
const MAX_TICK_FRACTION = 0.01;
// Mouse wheels report large, quantized deltas (100/120 per notch in Chrome,
// or deltaMode=DOM_DELTA_LINE in Firefox); trackpads report a stream of
// small continuous ones. A hard trackpad flick can occasionally spike past
// this, and that's fine — it lands on the discrete path and commits exactly
// one step, which is what a hard flick should do anyway.
const NOTCH_MIN_DELTA = 100;
const isNotchedWheel = (event) =>
  event.deltaMode !== 0 || Math.abs(event.deltaY) >= NOTCH_MIN_DELTA;
// Trackpad/mouse "momentum" keeps firing wheel ticks for a bit after the
// physical gesture ends. Those residual ticks used to land right after a
// commit/cancel settles, get read as the start of a brand-new gesture, and
// — since momentum alone rarely crosses COMMIT_THRESHOLD — auto-cancel back
// to rest after IDLE_MS. That whole cycle is what read as "the scroll
// overshoots, then snaps back, and the bottle wobbles" (its spin is scaled
// by a full 2π per step, so even a few % of stray `t` is visible).
//
// This same guard also doubles as a deliberate "look at this scene" beat:
// one long, continuous scroll gesture would otherwise chain into the very
// next transition on literally the next wheel tick, giving no time to
// actually see the scene it just arrived at. Every wheel/touch tick while
// this guard is armed is swallowed (preventDefault, no motion) rather than
// starting or continuing a gesture, so the resting scene always gets at
// least this long on screen before scrolling can move past it again.
//
// Armed ONLY after a commit/cancel settles — never on entering the section.
// An entry-side guard blocked the wheel (preventDefault + lenis.stop()) for
// its full duration the instant you crossed into the section, with nothing
// moving on screen to explain it: that dead, unresponsive beat right at the
// hand-off from the hero (and from the product shelf coming back up) is
// exactly the reported "screen freezes". Entry now starts tracking the
// gesture immediately instead, which is what makes the section feel picked
// up rather than stalled.
const REST_GUARD_MS = 650;
// Tolerance on the ownership bounds below, absorbing sub-pixel/rounding
// drift between window.scrollY and the computed step positions.
const RANGE_EPS_PX = 2;
// Mirrors Scene.jsx's bottle flavor swap: the OUTGOING bottle stays on
// screen through 3/4 of a transition (so its spin reads as one full 360°
// sweep) before the incoming flavor takes over for the last quarter — see
// progressRef below.
const FLAVOR_SWAP_FRAC = 0.75;

const EASE = "power2.out"; // fast start, long soft deceleration — the requested feel
const COMMIT_DURATION_FULL = 1.5;
const COMMIT_DURATION_MIN = 0.5;
const CANCEL_DURATION_FULL = 0.55;
const CANCEL_DURATION_MIN = 0.3;
// Live tracking: short so it still feels 1:1 with the wheel, but every tick
// smoothly eases toward its new target instead of snapping straight to it —
// this is what actually fixes choppiness, since a fast wheel/trackpad fires
// many ticks per second and each one used to hard-set the transform.
const TRACK_DURATION = 0.28;
const TRACK_EASE = "power2.out";
// Commits are never interruptible — they must always run to completion so
// every step gets a full, visible settle before the next gesture can begin
// (see handleTick). Cancels can always be interrupted immediately: their
// target never leaves the base step, so nothing can desync from cutting one
// short.
const CANCEL_UNLOCK_PROGRESS = 0;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Same defaults the old global UnrealBloomPass GUI shipped with (see
// PostFX.jsx's own DEFAULT_BLOOM) — used only as a fallback until the
// caller's per-scene `bloomTargets` (index-aligned with SCENES) are ready.
const DEFAULT_BLOOM = { strength: 0.8, radius: 0.4, threshold: 0.85 };

export function useSwingCarousel({
  sectionRef,
  groupRefs,
  faceRotations,
  radius,
  sceneCount,
  camera,
  lightRefs,
  sweepAngle,
  baseFov,
  transitionFov,
  fovReturnAt,
  lenis,
  bloomTargets,
}) {
  const maxStep = sceneCount - 1;
  const [visibleIndices, setVisibleIndices] = useState(() => new Set([0]));

  const sectionTopRef = useRef(0);
  const stepRef = useRef(0); // resting integer step

  const tProxyRef = useRef({ t: 0 }); // single source of truth for in-flight transition progress, always gsap-driven
  // Continuous, index-space position of the carousel — analogous to
  // Scene.jsx's scroll.step — plus which scene index the bottle rig should
  // currently show, and the CURRENT (possibly mid-cross-fade) bloom values
  // PostFX should apply. Read by BottleRigV2/PostFX every frame (see their
  // own useFrame); written only here, alongside the exact same math that
  // already moves the scene groups each frame, so neither can ever drift out
  // of sync with what's actually on screen.
  const progressRef = useRef({
    step: 0,
    frontIndex: 0,
    bloom: { ...(bloomTargets?.[0] ?? DEFAULT_BLOOM) },
  });
  const tweenRef = useRef(null);
  const lockedRef = useRef(false); // true while a commit/cancel settle tween owns input
  const resolveMetaRef = useRef(null); // { base, dir, committed } — set only while lockedRef is true

  const gestureActiveRef = useRef(false);
  const gestureBaseRef = useRef(0);
  const gestureDirRef = useRef(0);
  const progressPxRef = useRef(0);
  const idleTimerRef = useRef(null);
  const restGuardUntilRef = useRef(0);
  // Tracks inRange()'s own last value so handleTick can tell a genuine
  // false->true crossing (just arrived at the section) apart from any other
  // tick — that crossing is what arms the entry-side REST_GUARD_MS beat.
  const wasInRangeRef = useRef(false);

  const groupRefsRef = useRef(groupRefs);
  groupRefsRef.current = groupRefs;
  const faceRotationsRef = useRef(faceRotations);
  faceRotationsRef.current = faceRotations;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const lightRefsRef = useRef(lightRefs);
  lightRefsRef.current = lightRefs;
  const sweepAngleRef = useRef(sweepAngle);
  sweepAngleRef.current = sweepAngle;
  const baseFovRef = useRef(baseFov);
  baseFovRef.current = baseFov;
  const transitionFovRef = useRef(transitionFov);
  transitionFovRef.current = transitionFov;
  const fovReturnAtRef = useRef(fovReturnAt);
  fovReturnAtRef.current = fovReturnAt;
  const lenisRef = useRef(lenis);
  lenisRef.current = lenis;
  const bloomTargetsRef = useRef(bloomTargets);
  bloomTargetsRef.current = bloomTargets;

  // Every step position below is derived from this, and scrollWindowToStep()
  // teleports the page to one — so a stale value here is a mis-aimed jump.
  // Re-run on entering the section (see handleTick), not just on resize:
  // fonts, images and ScrollTrigger's own pin/refresh all settle after mount
  // and can move the section without ever firing a resize event.
  const measureSection = () => {
    if (!sectionRef.current) return;
    const rect = sectionRef.current.getBoundingClientRect();
    sectionTopRef.current = rect.top + window.scrollY;
  };
  useEffect(() => {
    // Only ever reads/writes refs, so the instance captured on first render
    // stays correct for the lifetime of this (mount-only) effect.
    const measure = () => measureSection();
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef]);

  // --- pure transform math -------------------------------------------------
  // One shared ring in the XZ plane (θ=0 is FRONT, θ=sweepAngle is BACK —
  // sweepAngle is GUI-tunable, see Scene.v2.jsx's "Sweep Angle" control;
  // it used to be a fixed π/180°). The outgoing and incoming scene are
  // always exactly sweepAngle apart on it — like two seats on the same
  // turntable — so they travel it together, in the SAME rotational sense,
  // and can never collide. `dir` (+1 forward / -1 back) is the only thing
  // that flips which way the ring turns, and it's chosen (the leading minus
  // sign on sin below) so scrolling forward — advancing 1→2→3→4 — is always
  // the same consistent turn, with the incoming scene entering from
  // screen-right and the outgoing one leaving to screen-left (the usual
  // "advance" convention — think a filmstrip/gallery moving forward).
  // Scrolling back mirrors it: incoming from the left, outgoing to the
  // right. Never side-dependent on which scene happens to be involved.
  //
  // Facing is recomputed from POSITION each call (atan2 toward the live
  // camera), not accumulated from the sweep angle — tying rotation directly
  // to theta made each group visibly spin a full ~180° on its own axis over
  // the transition. faceRotations[idx] is the per-scene authoring offset
  // (see FACE_ROTATIONS) that lines this up with each model's own front
  // axis; it's exactly the correction needed so this reduces to the old
  // resting rotation when the group sits at FRONT.
  // A scene's own lights fade by `fadeFactor` (1 at FRONT, 0 at BACK),
  // passed in by the caller from the transition's own `t` rather than
  // derived from theta — deriving it from theta (via cos) only reaches 0 at
  // theta=π, so a sweepAngle smaller than π would leave BACK-resting scenes
  // partially lit. Each light's own authored intensity (its JSX
  // `args`/`intensity` prop) is captured once, lazily, as the 100% baseline
  // the very first time it's touched — so this scales relative to however
  // that light was designed, never a hardcoded number here.
  const applyLightFactor = (light, factor) => {
    if (!light) return;
    if (light.userData.baseIntensity === undefined) {
      light.userData.baseIntensity = light.intensity;
    }
    light.intensity = light.userData.baseIntensity * factor;
  };

  const setGroupFrame = (idx, theta, fadeFactor) => {
    const group = groupRefsRef.current[idx]?.current;
    if (!group) return;
    const x = -Math.sin(theta) * radius;
    const z = -Math.cos(theta) * radius;
    group.position.set(x, 0, z);
    const cam = cameraRef.current;
    const camX = cam ? cam.position.x : 0;
    const camZ = cam ? cam.position.z : -radius + 6;
    group.rotation.y = Math.atan2(camX - x, camZ - z) + faceRotationsRef.current[idx];

    const lights = lightRefsRef.current?.[idx];
    if (lights) {
      lights.forEach((ref) => applyLightFactor(ref?.current, fadeFactor));
    }
  };

  const snapRest = (idx, atFront) => {
    setGroupFrame(idx, atFront ? 0 : sweepAngleRef.current, atFront ? 1 : 0);
    // At rest, PostFX's bloom pass should read exactly the resting scene's
    // own target — no cross-fade in progress, so no lerp needed, just adopt
    // it directly (mirrors how lights above snap straight to their own
    // authored intensity at fadeFactor 1).
    if (atFront) {
      const target = bloomTargetsRef.current?.[idx];
      if (target) progressRef.current.bloom = { ...target };
    }
  };

  // The camera "breathes" with each turn of the ring: FOV widens from its
  // resting value (baseFov) toward transitionFov as the sweep gets going,
  // then eases back so the step LANDS at exactly baseFov — the widening is
  // what sells the scenes as swinging past the camera rather than sliding
  // flatly across it. fovReturnAt is where the return leg starts, as a
  // fraction of the step (0.65 = the last third of the sweep pulls back in);
  // both it and transitionFov are tunable from Scene.v2.jsx.
  //
  // Driven straight off the transition's own `t` — the same value that poses
  // the groups — rather than a tween of its own, so it can never lag behind
  // or outlive the motion it's supposed to accompany: a cancel rubber-banding
  // t back to 0, or a commit finishing at 1, both put k at 0 and hand the
  // camera back at rest, with no extra bookkeeping. Writes are guarded on an
  // actual change, since updateProjectionMatrix() on every frame of every
  // transition is pure waste when the value hasn't moved.
  const applyTransitionFov = (t) => {
    const cam = cameraRef.current;
    if (!cam?.isPerspectiveCamera) return;
    const returnAt = clamp(fovReturnAtRef.current ?? 1, 0.01, 0.99);
    // Triangular 0 -> 1 -> 0 across the step, peaking at returnAt...
    const k = t <= returnAt ? t / returnAt : (1 - t) / (1 - returnAt);
    // ...smoothstepped so both ends and the peak itself ease instead of
    // reading as two straight ramps meeting at a visible corner.
    const eased = k * k * (3 - 2 * k);
    const base = baseFovRef.current;
    const fov = base + ((transitionFovRef.current ?? base) - base) * eased;
    if (Math.abs(cam.fov - fov) < 1e-3) return;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  };

  // Cross-fades PostFX's bloom pass between the outgoing and incoming
  // scene's own target values (see Scene.v2.jsx's "Scene Bloom" GUI folder)
  // across the SAME t driving the groups/FOV above — a straight per-property
  // lerp, since t itself already arrives eased (see EASE/TRACK_EASE), so a
  // second easing curve here would just double up. Written into
  // progressRef.current.bloom rather than a THREE object directly: PostFX
  // owns the actual UnrealBloomPass instance and reads this once per frame
  // (see its own useFrame), keeping this hook decoupled from postprocessing.
  const applyTransitionBloom = (outIdx, inIdx, t) => {
    const targets = bloomTargetsRef.current;
    const out = targets?.[outIdx];
    const inn = targets?.[inIdx];
    if (!out || !inn) return;
    const bloom = progressRef.current.bloom ?? (progressRef.current.bloom = {});
    bloom.strength = lerp(out.strength, inn.strength, t);
    bloom.radius = lerp(out.radius, inn.radius, t);
    bloom.threshold = lerp(out.threshold, inn.threshold, t);
  };

  const applyTransition = (outIdx, inIdx, dir, t) => {
    const angle = sweepAngleRef.current;
    // Outgoing always starts exactly at FRONT (θ=0, wherever it's actually
    // resting) and sweeps toward BACK — dir*angle*t reaches dir*angle at
    // t=1, its own (arbitrary, invisible-once-parked) resting spot for this
    // direction. Incoming is the mirror: starts at -dir*angle (the resting
    // spot a previous transition in this same direction would have parked
    // it at) and sweeps to land EXACTLY at FRONT (θ=0) at t=1 — not
    // `angle + sweep` (that only reduces to 0 at t=1 when angle=π, via
    // 2π≡0; any other angle overshoots FRONT entirely, which is what was
    // leaving the wrong scene rendered — black background, bloom-blown
    // fixed bottle rig floating in it).
    setGroupFrame(outIdx, dir * angle * t, 1 - t);
    setGroupFrame(inIdx, dir * angle * (t - 1), t);
    applyTransitionFov(t);
    applyTransitionBloom(outIdx, inIdx, t);
    progressRef.current.step = outIdx + dir * t;
    progressRef.current.frontIndex = t >= FLAVOR_SWAP_FRAC ? inIdx : outIdx;
  };

  // Initial pose: step 0 at front, everything else parked at back. Layout
  // effect so this lands before the first three.js frame paints — a plain
  // effect would leave every group at its JSX default (the origin) for one
  // visible frame.
  useLayoutEffect(() => {
    for (let i = 0; i < sceneCount; i++) snapRest(i, i === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneCount]);

  // --- scroll bookkeeping ---------------------------------------------------
  const getStepPx = () => window.innerHeight * STEP_VH_FRACTION;
  const scrollWindowToStep = (stepValue) => {
    window.scrollTo(0, sectionTopRef.current + stepValue * getStepPx());
  };

  // Single entry point for ALL transition motion (live tracking + settle) —
  // kills whatever tween currently owns tProxy and retargets from wherever
  // it actually is right now, so consecutive calls (one per wheel tick)
  // chain into one continuous ease instead of restarting from scratch.
  const animateTransitionTo = (
    base,
    dir,
    targetT,
    duration,
    ease,
    onComplete,
  ) => {
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(tProxyRef.current, {
      t: targetT,
      duration,
      ease,
      onUpdate: () => {
        applyTransition(base, base + dir, dir, tProxyRef.current.t);
        scrollWindowToStep(base + dir * tProxyRef.current.t);
      },
      onComplete,
    });
  };

  const finalizeResolve = () => {
    const meta = resolveMetaRef.current;
    tweenRef.current = null;
    lockedRef.current = false;
    if (!meta) return;
    const { base, dir, committed } = meta;
    const finalStep = committed ? base + dir : base;
    applyTransition(base, base + dir, dir, committed ? 1 : 0);
    tProxyRef.current.t = 0;
    stepRef.current = finalStep;
    scrollWindowToStep(finalStep);
    setVisibleIndices(new Set([finalStep]));
    resolveMetaRef.current = null;
    // Only a COMMIT earns the rest beat — it's screen time for a scene you
    // just arrived at. A cancel rubber-bands back to the scene already on
    // screen, so guarding after one just billed 650ms of dead, unresponsive
    // wheel for having scrolled a little and stopped. Worse, handleTick's
    // "interrupt a cancel and fall through to open the next gesture" path
    // called straight into here, so that fall-through was immediately
    // swallowed by the guard it had itself just armed.
    if (committed) {
      restGuardUntilRef.current = performance.now() + REST_GUARD_MS;
    }
  };

  const resolveGesture = (committed) => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    gestureActiveRef.current = false;

    const base = gestureBaseRef.current;
    const dir = gestureDirRef.current;
    lockedRef.current = true;
    resolveMetaRef.current = { base, dir, committed };

    const targetT = committed ? 1 : 0;
    const remaining = Math.abs(targetT - tProxyRef.current.t);
    const fullDuration = committed
      ? COMMIT_DURATION_FULL
      : CANCEL_DURATION_FULL;
    const minDuration = committed ? COMMIT_DURATION_MIN : CANCEL_DURATION_MIN;
    const duration = Math.max(
      minDuration,
      fullDuration * Math.max(remaining, 0.05),
    );

    animateTransitionTo(base, dir, targetT, duration, EASE, finalizeResolve);
  };

  const beginGesture = (direction) => {
    const base = stepRef.current;
    const target = base + direction;
    if (target < 0 || target > maxStep) return false;
    gestureActiveRef.current = true;
    gestureBaseRef.current = base;
    gestureDirRef.current = direction;
    progressPxRef.current = 0;
    tProxyRef.current.t = 0;
    setVisibleIndices(new Set([base, target]));
    return true;
  };

  // Ownership is EXACTLY the step-aligned zone — step N lives at
  // top + N*stepPx, so the carousel may only own the wheel between step 0
  // and step maxStep, and nowhere else.
  //
  // This used to reach a full extra step past maxStep plus 20vh of slack on
  // both ends, which put the ownership boundary far outside the range any
  // step actually maps to: ~504px of dead zone above the last step (where
  // the section's trailing rest/buffer room lives) and ~144px below the
  // first. Since scrollWindowToStep() always snaps the page to a step
  // position, grabbing the wheel anywhere in those dead zones teleported the
  // page the instant the first tween tick landed — scrolling back up from
  // the product shelf, the wheel was seized ~504px (0.7 viewports) early and
  // the page then jumped straight down onto the last step. That jump, plus
  // the entry rest guard freezing the wheel just before it, is the reported
  // "scroll suddenly stops and I jump directly to the scene".
  const inRange = () => {
    const y = window.scrollY;
    const top = sectionTopRef.current;
    const stepPx = getStepPx();
    return y >= top - RANGE_EPS_PX && y <= top + maxStep * stepPx + RANGE_EPS_PX;
  };

  // Re-derives the resting step from where the page ACTUALLY is. stepRef is
  // otherwise only ever advanced by this hook's own commits, so any scroll
  // that moved the page without going through it — Lenis coasting through
  // the section on momentum with no wheel event to grab, a resize, an
  // anchor jump — left stepRef pointing at a step the page is nowhere near,
  // and the next gesture teleported onto it. Called on entry so the carousel
  // always picks up from the scene actually on screen.
  const syncStepToScroll = () => {
    const stepPx = getStepPx();
    if (stepPx <= 0) return;
    const raw = (window.scrollY - sectionTopRef.current) / stepPx;
    const step = clamp(Math.round(raw), 0, maxStep);
    tProxyRef.current.t = 0;
    applyTransitionFov(0); // rest pose includes the camera, not just the groups
    if (step === stepRef.current) return;
    stepRef.current = step;
    // The groups are still posed for the step we thought we were on, so put
    // the adopted one at FRONT and park the rest — otherwise the carousel
    // would keep rendering the old scene while reporting the new index.
    for (let i = 0; i < sceneCount; i++) snapRest(i, i === step);
    progressRef.current.step = step;
    progressRef.current.frontIndex = step;
    setVisibleIndices(new Set([step]));
  };

  // Lenis has its own wheel listener and momentum, entirely independent of
  // this hook's preventDefault() calls below — a library-level listener
  // doesn't stop just because some OTHER listener on the same event called
  // preventDefault(). Went unnoticed while .scene-v2 was position:fixed
  // (nothing behind it for a stray Lenis nudge to reveal); now that it's a
  // real in-flow sticky section (see Scene.v2.css), any scroll Lenis applies
  // on its own is directly visible — it could scroll the pin partway open
  // and reveal the hero/shelf mid-carousel. So: explicitly stop() Lenis for
  // every tick this hook decides to own (own = calls preventDefault(), i.e.
  // scrollWindowToStep() is the only thing allowed to move the page), and
  // start() it again at the exact two points below where a tick is instead
  // let through natively (inRange() false, or beginGesture() failing at an
  // edge) — mirrors the ownership boundary this hook already enforces via
  // preventDefault(), just extended to Lenis's own independent listener.
  // ...but this hook's "no tick of mine is in flight" is NOT the same as "the
  // page is free to scroll": something else (the preloader boot, IntroHeroV2's
  // autoplay reel — see useScrollLock) can be holding scroll frozen on purpose.
  // Out-of-range ticks are the common case for the whole length of the intro,
  // so an unconditional start() here un-froze the page on the first wheel tick
  // after load. Defer to the lock; releasing is only ours to do when nobody
  // else is holding it.
  const captureScroll = () => lenisRef.current?.stop();
  const releaseScroll = () => {
    if (isScrollLocked()) return;
    lenisRef.current?.start();
  };

  // Shared by every input path (trackpad stream, wheel notch, keyboard):
  // re-measure, detect a fresh crossing into the section, and latch it.
  // Returns whether the carousel currently owns scroll.
  const updateRangeState = () => {
    // Cheap and rare (only fires while actually near the section), and it
    // has to happen BEFORE inRange() so the boundary test itself is judged
    // against the section's real, current position.
    const idle = !gestureActiveRef.current && !lockedRef.current;
    if (idle) measureSection();

    const currentlyInRange = inRange();
    if (currentlyInRange && !wasInRangeRef.current && idle) {
      // Just crossed in from the hero (scrolling forward) or the product
      // shelf (scrolling backward). Adopt whatever step the page is already
      // sitting at rather than trusting stepRef — with ownership now bounded
      // to the step-aligned zone this crossing lands within a step of a real
      // rest position, so there's nothing to jump to. Deliberately does NOT
      // arm restGuardUntilRef: blocking input the instant the section is
      // entered is what read as the screen freezing on hand-off.
      syncStepToScroll();
    }
    wasInRangeRef.current = currentlyInRange;
    return currentlyInRange;
  };

  // Commits must always run to completion — interrupting one early (even
  // near its tail) lets a fast flick chain straight into the next gesture
  // before the settling scene ever gets a full frame on screen, which reads
  // as skipping a step. Cancels are safe to interrupt immediately: their
  // target never leaves the base step, so nothing can desync from cutting
  // one short. Returns true when the caller should swallow this input.
  const consumedByLock = () => {
    if (!lockedRef.current) return false;
    if (resolveMetaRef.current?.committed) return true;
    const tween = tweenRef.current;
    if (tween && tween.progress() >= CANCEL_UNLOCK_PROGRESS) {
      tween.kill();
      finalizeResolve();
      return false; // this input opens the next gesture
    }
    return true;
  };

  // One discrete input = exactly one scene. Used by notched mouse wheels and
  // the keyboard, both of which deliver intent in whole units rather than as
  // a continuous stream, so there's nothing to live-track — begin the
  // gesture and commit it straight to a full settle tween.
  const stepOnce = (direction, preventDefault) => {
    if (!updateRangeState()) {
      releaseScroll();
      return;
    }
    if (consumedByLock()) {
      captureScroll();
      preventDefault();
      return;
    }
    if (
      gestureActiveRef.current ||
      performance.now() < restGuardUntilRef.current
    ) {
      captureScroll();
      preventDefault(); // mid-gesture or resting — hold this scene
      return;
    }
    if (!beginGesture(direction)) {
      releaseScroll(); // at an edge — let native scroll continue
      return;
    }
    captureScroll();
    preventDefault();
    resolveGesture(true);
  };

  const handleTick = (deltaY, preventDefault) => {
    if (!updateRangeState()) {
      releaseScroll();
      return;
    }

    if (consumedByLock()) {
      captureScroll();
      preventDefault();
      return;
    }

    const direction = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0;
    if (!direction) return;

    if (!gestureActiveRef.current) {
      if (performance.now() < restGuardUntilRef.current) {
        captureScroll();
        preventDefault(); // resting — let the current scene stay on screen
        return;
      }
      if (!beginGesture(direction)) {
        releaseScroll(); // at an edge — let native scroll continue
        return;
      }
    }

    captureScroll();
    preventDefault();

    const stepPx = getStepPx();
    const maxTickPx = stepPx * MAX_TICK_FRACTION;
    const tickPx = clamp(deltaY * gestureDirRef.current, -maxTickPx, maxTickPx);
    progressPxRef.current = clamp(progressPxRef.current + tickPx, 0, stepPx);
    const targetT = stepPx > 0 ? progressPxRef.current / stepPx : 0;

    animateTransitionTo(
      gestureBaseRef.current,
      gestureDirRef.current,
      targetT,
      TRACK_DURATION,
      TRACK_EASE,
    );

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    if (targetT >= COMMIT_THRESHOLD) {
      resolveGesture(true);
      return;
    }
    idleTimerRef.current = setTimeout(() => resolveGesture(false), IDLE_MS);
  };

  // --- DOM wiring: wheel + touch + keyboard parity --------------------------
  useEffect(() => {
    const onWheel = (event) => {
      const prevent = () => event.preventDefault();
      // Notched wheels deliver one discrete unit of intent per event, so
      // they get one scene per notch rather than being fed through the
      // trackpad's continuous accumulator (which needed ~22 of them).
      if (isNotchedWheel(event)) {
        stepOnce(event.deltaY > 0 ? 1 : -1, prevent);
        return;
      }
      handleTick(event.deltaY, prevent);
    };
    window.addEventListener("wheel", onWheel, { passive: false });

    // Keyboard parity: the carousel swallows the page's scroll while it owns
    // it, so without this the arrow/page/space/home/end keys did nothing at
    // all inside the section (and any native scroll they did land desynced
    // stepRef from the page). Same discrete path as a wheel notch.
    const KEY_DIRECTIONS = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 1,
      PageUp: -1,
    };
    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Never hijack keys aimed at a form field or editable region.
      const el = event.target;
      if (
        el &&
        (el.isContentEditable ||
          /^(input|textarea|select|button)$/i.test(el.tagName))
      ) {
        return;
      }

      let direction = KEY_DIRECTIONS[event.key] ?? 0;
      if (event.key === " " || event.key === "Spacebar") {
        direction = event.shiftKey ? -1 : 1;
      } else if (event.shiftKey) {
        return; // shift+arrow is a selection gesture, not navigation
      }
      if (!direction) return;

      stepOnce(direction, () => event.preventDefault());
    };
    window.addEventListener("keydown", onKeyDown);

    let touchLastY = null;
    const onTouchStart = (event) => {
      touchLastY = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event) => {
      const y = event.touches?.[0]?.clientY;
      if (y == null) return;
      if (touchLastY == null) {
        touchLastY = y;
        return;
      }
      const deltaY = touchLastY - y;
      touchLastY = y;
      if (deltaY === 0) return;
      handleTick(deltaY, () => event.preventDefault());
    };
    const onTouchEnd = () => {
      touchLastY = null;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      tweenRef.current?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxStep, radius, sceneCount]);

  return { visibleIndices, progressRef };
}
