import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { isScrollLocked } from "../hooks/useScrollLock";
import { overlayWipe } from "../overlayWipeState";
import { getScrollY, scrollRootTo } from "../utils/scrollRoot";

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

// Exported so callers outside this hook (Scene.v2.jsx's own scroll-section
// height, and useProductPhase's "where does the carousel's owned range end"
// math) can stay in lock-step with the actual per-step scroll distance
// without duplicating the number.
export const STEP_VH_FRACTION = 0.5; // one step = 50vh of scroll, per spec
// Single-swipe-only model: no free/continuous scroll tracking, no
// threshold-to-commit, no rubber-band cancel. Every wheel notch, every
// trackpad tick, and every touch swipe is treated as ONE unit of intent —
// it either starts a full commit to the next/prev step, or (while a commit
// is already animating, or within COOLDOWN_MS of one finishing) is dropped
// outright, never queued. That's what guarantees the user can only ever
// advance one scene per gesture and can never land mid-transition: there is
// no partial state to land in — `t` is either 0 (resting) or animating
// straight to 1 (committed).
const COOLDOWN_MS = 300; // input stays ignored for this long after a commit's animation ends
// Tolerance on the ownership bounds below, absorbing sub-pixel/rounding
// drift between the live scroll offset and the computed step positions.
const RANGE_EPS_PX = 2;
// Minimum vertical travel (px) a touch drag needs before it counts as a
// swipe — below this it's just finger jitter, not intent. Once crossed, the
// rest of that same touch (until touchend) is inert: one drag = one step,
// same as a single wheel notch.
const SWIPE_THRESHOLD_PX = 12;
// Gap (ms) of wheel silence that separates one physical trackpad gesture
// (initial ticks + decaying momentum tail) from the next. See
// wheelGestureLockedRef.
const WHEEL_GESTURE_GAP_MS = 200;
// A trackpad's post-flick momentum ticks decay in magnitude, while a finger
// still physically driving the pad keeps producing deltas near the gesture's
// own peak. Once a step's lock + cooldown has expired but the wheel stream
// has NEVER gone silent, a tick may only take the next step if it's still at
// least this fraction of the peak |deltaY| seen so far in that stream —
// anything smaller is momentum, and momentum must not spend a second step.
const WHEEL_TAIL_ACTIVE_RATIO = 0.5;
// Mirrors Scene.jsx's bottle flavor swap: progressRef.frontIndex keeps
// reporting the OUTGOING scene through 3/4 of a transition before flipping
// to the incoming one for the last quarter — see progressRef below. This
// governs only WHICH scene is called "current"; the bottle's own rotation is
// a HALF turn (π) per step and is derived from progressRef.step, not from
// this (see BottleRigV2's SPIN_SIGN block).
const FLAVOR_SWAP_FRAC = 0.75;

const EASE = "power2.out"; // fast start, long soft deceleration — the requested feel
const COMMIT_DURATION = 0.77; // full step transition, always run start-to-finish (never interrupted) — 30% faster than 1.1

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Same defaults the old global UnrealBloomPass GUI shipped with (see
// PostFX.jsx's own DEFAULT_BLOOM) — used only as a fallback until the
// caller's per-scene `bloomTargets` (index-aligned with SCENES) are ready.
const DEFAULT_BLOOM = { strength: 0.8, radius: 0.4, threshold: 0.85 };
// Baked-light dim range (see applyBakedLightFactor) — near-dark at BACK,
// full authored brightness at FRONT, per the requested "lights turning
// on/off" feel as each scene enters/leaves. Not 0: a fully black room reads
// as "the model vanished" rather than "the lights are off" once it's mid-
// transition and still on screen.
const BAKED_LIGHT_MIN = 0.12;
const BAKED_LIGHT_MAX = 1;

export function useSwingCarousel({
  sectionRef,
  groupRefs,
  faceRotations,
  radius,
  sceneCount,
  camera,
  lightRefs,
  bakedLightRefs,
  sweepAngle,
  lightRevealAngle,
  baseFov,
  transitionFov,
  fovReturnAt,
  lenis,
  bloomTargets,
  // Called when a forward gesture arrives while already resting at the last
  // step (i.e. commitStep's own target > maxStep check just failed at that
  // edge) — the scene-to-product handoff (see useSceneToProductHandoff)
  // hooks in here instead of this hook trying to know anything about
  // product. Returning true means "I'm handling this" (the tick is
  // captured/prevented, same as a normal step); false falls through to the
  // plain releaseScroll() this edge always used.
  onForwardEdge,
  // True for the whole life of the scene-to-product handoff — from the
  // instant the forward flight takes off, through however long the bottle
  // rests in product's room, until the reverse flight has fully landed it
  // back. `commitStep` bails before touching ANYTHING (stepRef, progressRef,
  // lockedRef) while this holds: the handoff's own
  // gsap timeline owns the bottle/scroll for that whole span via its own
  // input block, so this is a belt-and-suspenders guarantee that no stray
  // event can nudge `progressRef.current.step` out from under it — which
  // previously read as the carousel's own swing firing (and the bottle
  // landing off-center, since BottleRigV2's resting math depends on `step`)
  // right as the reverse handoff finished.
  disabledRef,
}) {
  const maxStep = sceneCount - 1;
  const onForwardEdgeRef = useRef(onForwardEdge);
  onForwardEdgeRef.current = onForwardEdge;
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
  const lockedRef = useRef(false); // true for the full duration of a commit's animation
  // Timestamp (performance.now()) until which input stays ignored after a
  // commit's animation completes — see COOLDOWN_MS.
  const cooldownUntilRef = useRef(0);
  // Tracks inRange()'s own last value so input handlers can tell a genuine
  // false->true crossing (just arrived at the section) apart from any other
  // tick — that crossing is what triggers adopting the on-screen step.
  const wasInRangeRef = useRef(false);
  // A trackpad swipe keeps emitting decaying "momentum" wheel ticks for a
  // while after the finger lifts — often longer than COMMIT_DURATION +
  // COOLDOWN_MS. Without this, one physical swipe could commit its step,
  // then a straggling momentum tick after cooldown expired would read as a
  // brand-new gesture and commit a SECOND step — the reported "skips a scene
  // forward/back" on trackpad. wheelGestureLockedRef latches true the moment
  // any wheel tick commits (or lands mid-commit/cooldown for) a step, and
  // stays up through the animation + COOLDOWN_MS. A 200ms silence still
  // clears it early (finger lifted). If the user NEVER lifts — laptop
  // two-finger scroll, cursor unmoved — silence never comes, so cooldown
  // expiry alone used to clear the lock, which is exactly how a long momentum
  // tail (they routinely outlive COMMIT_DURATION + COOLDOWN_MS) still bought
  // itself a second step. Cooldown expiry now only OPENS the door: the tick
  // that walks through it must also still be near the gesture's peak
  // magnitude (WHEEL_TAIL_ACTIVE_RATIO), which a decaying tail never is and
  // an un-lifted finger always is.
  const wheelGestureLockedRef = useRef(false);
  const lastWheelTsRef = useRef(0);
  // Largest |deltaY| seen in the current uninterrupted wheel stream, reset on
  // every WHEEL_GESTURE_GAP_MS silence (and re-baselined whenever a tick is
  // allowed to start a fresh step). The yardstick for the tail test above.
  const wheelPeakMagRef = useRef(0);

  const groupRefsRef = useRef(groupRefs);
  groupRefsRef.current = groupRefs;
  const faceRotationsRef = useRef(faceRotations);
  faceRotationsRef.current = faceRotations;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const lightRefsRef = useRef(lightRefs);
  lightRefsRef.current = lightRefs;
  const bakedLightRefsRef = useRef(bakedLightRefs);
  bakedLightRefsRef.current = bakedLightRefs;
  const sweepAngleRef = useRef(sweepAngle);
  sweepAngleRef.current = sweepAngle;
  const lightRevealAngleRef = useRef(lightRevealAngle);
  lightRevealAngleRef.current = lightRevealAngle;
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
  // Re-run on entering the section (see updateRangeState), not just on resize:
  // fonts, images and ScrollTrigger's own pin/refresh all settle after mount
  // and can move the section without ever firing a resize event.
  const measureSection = () => {
    if (!sectionRef.current) return;
    const rect = sectionRef.current.getBoundingClientRect();
    sectionTopRef.current = rect.top + getScrollY();
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

  // Scenes carry no real lights of their own — every "light" (light strips,
  // neon fixtures, the light-map bake itself) is baked straight into an
  // unlit MeshBasicMaterial's texture (see e.g. SceneOneV2's Cylinder.002 /
  // "Light Map"). There's nothing for a THREE.Light to dim, so instead this
  // scales each such material's own `color` tint — the same trick already
  // used to author their overbright glow (see materials.js's
  // makeOverbrightMaterial) — between BAKED_LIGHT_MIN (dimmed, scene at
  // BACK) and BAKED_LIGHT_MAX (its full authored brightness, scene at
  // FRONT). Never fully off: a scene swinging past the camera mid-transition
  // should read as "dimming down", not "someone cut the power".
  const applyBakedLightFactor = (materials, factor) => {
    if (!materials?.length) return;
    const mix = lerp(BAKED_LIGHT_MIN, BAKED_LIGHT_MAX, factor);
    for (const material of materials) {
      if (!material) continue;
      if (!material.userData.baseColor) {
        material.userData.baseColor = material.color.clone();
      }
      material.color.copy(material.userData.baseColor).multiplyScalar(mix);
    }
  };

  // Unlike the hemi/dir fade (driven straight off `t`, see setGroupFrame
  // below), the baked-light reveal is driven off the scene's actual swing
  // angle (`theta`, 0 at FRONT) rather than transition progress — `t` fades
  // linearly across the WHOLE sweep, most of which has the scene off to the
  // side where a subtle brightness change is never seen. This instead stays
  // pinned at BAKED_LIGHT_MIN until the scene swings within
  // lightRevealAngleRef of FRONT, then ramps to full over just that last
  // stretch — GUI-tunable via "Light Reveal Angle" (Scene.v2.jsx), so it can
  // be widened/narrowed to taste.
  const bakedLightProximity = (theta) => {
    const revealAngle = Math.max(lightRevealAngleRef.current ?? 0, 0.0001);
    return clamp(1 - Math.abs(theta) / revealAngle, 0, 1);
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
    group.rotation.y =
      Math.atan2(camX - x, camZ - z) + faceRotationsRef.current[idx];

    const lights = lightRefsRef.current?.[idx];
    if (lights) {
      lights.forEach((ref) => applyLightFactor(ref?.current, fadeFactor));
    }
    applyBakedLightFactor(
      bakedLightRefsRef.current?.[idx]?.current,
      bakedLightProximity(theta),
    );
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
    // Every slot — including product's — rests at this SAME shared fov. The
    // camera's fov is never retargeted per-slot; the flythrough camera that
    // takes over once product is active carries its own fov independently
    // (see useCameraFlythrough), unrelated to this one.
    const base = baseFovRef.current;
    const fov = base + ((transitionFovRef.current ?? base) - base) * eased;
    if (Math.abs(cam.fov - fov) < 1e-3) return;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  };

  // Cross-fades PostFX's bloom pass between the outgoing and incoming
  // scene's own target values (see Scene.v2.jsx's "Scene Bloom" GUI folder)
  // across the SAME t driving the groups/FOV above — a straight per-property
  // lerp, since t itself already arrives eased (see EASE), so a
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
  // Goes through scrollRoot rather than window.scrollTo: on non-desktop
  // viewports the document is frozen and the page scrolls an inner container
  // instead (see utils/scrollRoot.js), where a window.scrollTo is a silent
  // no-op — the transition tween then couldn't move the page at all.
  const scrollWindowToStep = (stepValue) => {
    scrollRootTo(sectionTopRef.current + stepValue * getStepPx());
  };

  // Single entry point for the commit's transition tween — kills whatever
  // tween currently owns tProxy (there should never be one in flight, since
  // commitStep only calls this while unlocked) and always animates from 0 to
  // targetT, once, start to finish.
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
      // Deliberately does NOT scroll the page per frame. The transition used
      // to scrub scroll along with itself (scrollWindowToStep on every tick),
      // which meant a scene change WAS a 50vh page scroll — invisible under
      // the sticky pin, but every scroll-driven thing on the page still saw
      // it move. On HomeV3Page that is what fired the closing cloud wipe the
      // instant the carousel landed on the last scene: the wipe arms one
      // viewport above its boundary marker, which is exactly where the last
      // step's rest position sits, and the tween's own scrolling supplied the
      // `goingDown` the trigger needs. The page now holds dead still for the
      // whole animation and moves only in one discrete hop, in
      // commitStep's own onComplete, once the step has actually landed.
      onUpdate: () => {
        applyTransition(base, base + dir, dir, tProxyRef.current.t);
      },
      onComplete,
    });
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
    const y = getScrollY();
    const top = sectionTopRef.current;
    const stepPx = getStepPx();
    return (
      y >= top - RANGE_EPS_PX && y <= top + maxStep * stepPx + RANGE_EPS_PX
    );
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
    const raw = (getScrollY() - sectionTopRef.current) / stepPx;
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
  // let through natively (inRange() false, or the target step failing at an
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
    const idle = !lockedRef.current;
    if (idle) measureSection();

    const currentlyInRange = inRange();
    if (currentlyInRange && !wasInRangeRef.current && idle) {
      // Just crossed in from the hero (scrolling forward) or the product
      // shelf (scrolling backward). Adopt whatever step the page is already
      // sitting at rather than trusting stepRef — with ownership now bounded
      // to the step-aligned zone this crossing lands within a step of a real
      // rest position, so there's nothing to jump to.
      syncStepToScroll();
    }
    wasInRangeRef.current = currentlyInRange;
    return currentlyInRange;
  };

  // The single entry point for every input source (wheel notch, trackpad
  // tick, keyboard, swipe) — each one is exactly one unit of intent, so this
  // either commits a full step transition or drops the input outright.
  // Never queues, never live-tracks, never lets a second gesture interrupt
  // one already animating: `lockedRef` covers the whole commit animation,
  // and `cooldownUntilRef` extends that block for COOLDOWN_MS past the end
  // of it, so the very next tick after landing can't immediately re-trigger.
  // Returns whether this input belonged to a step this hook owns (mid-commit,
  // cooling down, or just started one) — as opposed to being let through to
  // native scroll (out of range, or a genuine edge). Callers that track
  // gesture identity (the wheel handler's momentum-tail guard) use this to
  // know whether the current physical gesture has now "used up" its one step.
  const commitStep = (direction, preventDefault) => {
    if (disabledRef?.current) return false;
    // CloudTransition keeps autoActive true through the post-wipe gesture
    // hold (see POST_WIPE_GESTURE_GAP_MS there). A hard scroll from the
    // hero is the same physical gesture that just teleported us onto
    // Scene One — do not spend it as a step to Scene Two.
    if (overlayWipe.autoActive) {
      captureScroll();
      preventDefault();
      return true;
    }
    if (!updateRangeState()) {
      releaseScroll();
      return false;
    }
    if (lockedRef.current || performance.now() < cooldownUntilRef.current) {
      // Mid-transition, or still cooling down from the last one — this
      // input is dropped, not queued, and never reverses/interrupts the
      // commit in flight.
      captureScroll();
      preventDefault();
      return true;
    }

    const base = stepRef.current;
    const target = base + direction;
    if (target < 0 || target > maxStep) {
      if (
        direction === 1 &&
        base === maxStep &&
        onForwardEdgeRef.current?.()
      ) {
        captureScroll();
        preventDefault();
        return true;
      }
      releaseScroll(); // at an edge — let native scroll continue
      return false;
    }

    lockedRef.current = true;
    tProxyRef.current.t = 0;
    setVisibleIndices(new Set([base, target]));
    captureScroll();
    preventDefault();

    animateTransitionTo(base, direction, 1, COMMIT_DURATION, EASE, () => {
      applyTransition(base, target, direction, 1);
      tProxyRef.current.t = 0;
      stepRef.current = target;
      scrollWindowToStep(target);
      setVisibleIndices(new Set([target]));
      tweenRef.current = null;
      lockedRef.current = false;
      cooldownUntilRef.current = performance.now() + COOLDOWN_MS;
    });
    return true;
  };

  // --- DOM wiring: wheel + touch + keyboard parity --------------------------
  useEffect(() => {
    // Every wheel event — one notch from a mouse, or one tick out of a
    // trackpad's continuous stream — is treated as a single unit of intent.
    // A trackpad still fires many of these per physical swipe, but only the
    // very first one can ever land: it flips `lockedRef` immediately, so
    // every tick behind it in the same gesture is dropped by commitStep's
    // own lock/cooldown check above, not queued or accumulated. That's what
    // collapses "many wheel events" into "exactly one step" without needing
    // to special-case notched vs. continuous input.
    const onWheel = (event) => {
      const now = performance.now();
      const mag = Math.abs(event.deltaY);
      const isNewGesture = now - lastWheelTsRef.current > WHEEL_GESTURE_GAP_MS;
      lastWheelTsRef.current = now;
      if (isNewGesture) {
        wheelGestureLockedRef.current = false;
        wheelPeakMagRef.current = 0;
      }
      wheelPeakMagRef.current = Math.max(wheelPeakMagRef.current, mag);

      if (overlayWipe.autoActive) {
        // Same originating flick as the wipe. Latch the gesture lock so
        // even a tick that arrives the frame autoActive drops is still
        // treated as that swipe's tail, not a new step.
        wheelGestureLockedRef.current = true;
        if (inRange()) event.preventDefault();
        return;
      }

      if (overlayWipe.consumeGesture) {
        overlayWipe.consumeGesture = false;
        wheelGestureLockedRef.current = true;
        if (inRange()) event.preventDefault();
        return;
      }

      if (wheelGestureLockedRef.current) {
        // Still mid-commit / cooling down: swallow. Once that window
        // ends, a laptop trackpad that never lifted (cursor never moved,
        // so no WHEEL_GESTURE_GAP silence) must be allowed to take the
        // NEXT step — otherwise the carousel looks dead until the user
        // wiggles the pointer to "end" the gesture.
        if (lockedRef.current || now < cooldownUntilRef.current) {
          if (inRange()) event.preventDefault();
          return;
        }
        // ...but only if this tick is a finger still driving, not the
        // decaying tail of the flick that already spent its step. A tail
        // that keeps arriving also keeps refreshing lastWheelTsRef, so it
        // never earns a "new gesture" either — it just stays swallowed
        // until it dies out and real silence resets the stream.
        if (mag < wheelPeakMagRef.current * WHEEL_TAIL_ACTIVE_RATIO) {
          if (inRange()) event.preventDefault();
          return;
        }
        wheelGestureLockedRef.current = false;
        // Re-baseline: the next tail test belongs to THIS leg of the
        // scroll, not to a peak set by some earlier, harder flick.
        wheelPeakMagRef.current = mag;
      }

      const consumed = commitStep(event.deltaY > 0 ? 1 : -1, () =>
        event.preventDefault()
      );
      if (consumed) wheelGestureLockedRef.current = true;
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

      commitStep(direction, () => event.preventDefault());
    };
    window.addEventListener("keydown", onKeyDown);

    // Touch: one swipe = one step. Track total vertical travel from
    // touchstart; the instant it crosses SWIPE_THRESHOLD_PX, fire exactly
    // one commitStep and mark the gesture "consumed" so the rest of that
    // same finger-down drag (however far it keeps moving) can't trigger a
    // second one — matches the wheel/keyboard "one input, one scene" rule.
    let touchStartY = null;
    let touchConsumed = false;
    const onTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? null;
      touchConsumed = false;
    };
    const onTouchMove = (event) => {
      if (touchStartY == null) return;
      const y = event.touches?.[0]?.clientY;
      if (y == null) return;

      if (touchConsumed) {
        // Same drag, already used — keep swallowing it while inside the
        // carousel's range so the browser doesn't scroll the page natively
        // underneath the still-animating transition.
        if (inRange()) event.preventDefault();
        return;
      }

      const delta = touchStartY - y; // positive = finger moving up = forward
      if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;

      touchConsumed = true;
      commitStep(delta > 0 ? 1 : -1, () => event.preventDefault());
    };
    const onTouchEnd = () => {
      touchStartY = null;
      touchConsumed = false;
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
      tweenRef.current?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxStep, radius, sceneCount]);

  // Re-adopt the resting step from wherever the page has just been PUT, for
  // callers that move scroll without any wheel/touch event ever firing — i.e.
  // a PageProgress rail jump (see utils/navSectionTargets.js). updateRangeState
  // normally does this, but only on a false->true `inRange()` crossing observed
  // from inside an input handler: a jump that starts and ends inside the
  // section (Shop -> Worlds) never produces that edge, so `stepRef` would keep
  // pointing at the step the page has just left and the next gesture would
  // teleport back onto it. `wasInRangeRef` is refreshed too, so the next real
  // input doesn't then re-sync off a stale edge.
  const syncToScroll = () => {
    measureSection();
    syncStepToScroll();
    wasInRangeRef.current = inRange();
  };

  return { visibleIndices, progressRef, syncToScroll };
}
