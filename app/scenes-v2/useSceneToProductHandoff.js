import { useCallback, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { STEP_VH_FRACTION } from "./swingCarousel";

// A/B durations for the fog wipe itself; the auto-scroll leg has its own.
const FOG_IN_DURATION = 0.65;
const FOG_OUT_DURATION = 0.8;
const AUTO_SCROLL_DURATION = 1.1;

// GSAP's power2.inOut / power2.out, so the Lenis-owned auto-scroll matches
// the curve the old proxy tween used instead of Lenis's default expo.
function easePower2InOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (2 * t - 2) ** 2 / 2;
}
function easePower2Out(t) {
  return 1 - (1 - t) ** 2;
}

// Programmatic scroll while Lenis is stopped (see trigger's lenis.stop()).
// Native window.scrollTo is a no-op under `lenis-stopped`; CloudTransition
// already uses force:true for the same reason. Duration is in seconds.
function scrollWhileStopped(lenis, y, { duration, easing }) {
  if (lenis) {
    lenis.scrollTo(y, { duration, force: true, easing });
    return;
  }
  window.scrollTo(0, y);
}

// Mirrors useScrollLock's capture-phase input block, deliberately WITHOUT its
// overflow:hidden layer: the auto-scroll leg has to actually move
// window.scrollY itself (via Lenis force:true, not native scrollTo), and
// useProductPhase reads window.scrollY directly right after — overflow:hidden
// on html/body would remove the scroll box entirely and turn both into
// no-ops. Capture phase + stopping propagation on window is still what keeps
// swingCarousel's own (bubble-phase) wheel/touch/key listeners from ever
// seeing input while this timeline owns the page. Don't drop this block when
// swapping the write path — carousel would steal a step mid-fog.
const BLOCKED_EVENTS = ["wheel", "touchmove", "keydown"];
function blockInput(event) {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}
function acquireInputBlock() {
  for (const type of BLOCKED_EVENTS) {
    window.addEventListener(type, blockInput, {
      capture: true,
      passive: false,
    });
  }
}
function releaseInputBlock() {
  for (const type of BLOCKED_EVENTS) {
    window.removeEventListener(type, blockInput, { capture: true });
  }
}

// Instantly (no fade) sets every material on `object` to fully opaque/
// visible or fully transparent/hidden — used ONLY while the fog fully
// covers the frame, so the swap itself is never seen. Cheaper and simpler
// than animating opacity now that nothing needs to be visible mid-fade: the
// fog is the entire transition.
function setRoomOpaque(object, opaque) {
  if (!object) return;
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (opaque) {
        material.transparent = false;
        material.opacity = 1;
      } else {
        material.transparent = true;
        material.opacity = 0;
      }
    });
  });
}

// Scroll-gesture-driven, two-way cinematic handoff between the last carousel
// scene and product's room: a camera-facing fog plane (see HandoffFogWipe)
// covers the frame, everything swaps INSTANTLY behind it (no bottle flight,
// no cross-fade — the room's own bottles are already sitting on the shelf,
// same as the carousel's flavor bottle is already parked in front of the
// camera), and the fog clears onto the finished result. See Scene.v2.jsx's
// own comment on where this plugs into useSwingCarousel (onForwardEdge) and
// BottleRigV2 (flightOverrideRef).
//
// `assetsRef`/`ready` are product's own useProductAssets() result, lifted up
// into SceneContents (Scene.v2.jsx) so this hook and ProductSceneV2 both read
// the SAME assets rather than each loading their own copy.
export function useSceneToProductHandoff({
  sectionRef,
  lenis,
  maxStep,
  assetsRef,
  ready,
  flightOverrideRef,
  sceneFourMaterialRef,
  lightsActiveRef,
  fogRef,
  showerFogRef,
  // Flipped true/false at the instant-swap point of each direction — i.e.
  // the one moment the wipe fully covers the frame and the room is actually
  // swapped in/out. This is what useProductAutoZoom starts its single
  // zoom-in tween off, so that motion begins WITH the reveal and runs
  // continuously through the fog clearing, rather than waiting for this
  // whole timeline to finish and starting cold afterwards.
  roomRevealedRef,
  productActiveRef,
  onProductActiveChange,
  handoffScrollVh,
}) {
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const lenisRef = useRef(lenis);
  lenisRef.current = lenis;
  const sectionRefMirror = useRef(sectionRef);
  sectionRefMirror.current = sectionRef;
  const productActiveRefMirror = useRef(productActiveRef);
  productActiveRefMirror.current = productActiveRef;
  const onProductActiveChangeRef = useRef(onProductActiveChange);
  onProductActiveChangeRef.current = onProductActiveChange;

  // Resting state: false while the carousel owns the screen, true once the
  // forward wipe has landed on product's room. Flipped back by the reverse
  // handoff — this run repeats in both directions for the life of the page.
  const inProductRef = useRef(false);
  // True while EITHER direction's timeline is actively animating — guards
  // against a second gesture re-entering mid-timeline (shouldn't be
  // reachable once the input block is up, but costs nothing to guard
  // anyway) and against the reverse watcher below firing mid-forward-wipe.
  const runningRef = useRef(false);
  // True for the whole span EITHER of the above holds. Handed to
  // useSwingCarousel (see Scene.v2.jsx) as `disabledRef`, so its own gesture
  // handling can't touch `progressRef` (step/frontIndex) while this owns the
  // screen. Also what `onProductActiveChange` (SceneCaption's own fade —
  // see Scene.v2.jsx) is driven off: the carousel's heading/paragraph has no
  // business being on screen from the moment the fog starts rising until
  // the reverse wipe has fully landed back, not just while resting in
  // product — a boolean gated on inProductRef alone would leave it visible
  // (wrongly) for the whole outbound/return wipe. Kept in sync at every
  // point inProductRef/runningRef change.
  const handoffActiveRef = useRef(false);
  const syncHandoffActive = () => {
    const next = inProductRef.current || runningRef.current;
    if (next !== handoffActiveRef.current) {
      handoffActiveRef.current = next;
      onProductActiveChangeRef.current?.(next);
    }
  };

  const trigger = useCallback(() => {
    if (inProductRef.current || runningRef.current || !readyRef.current) {
      return false;
    }
    const assets = assetsRef.current;
    const override = flightOverrideRef.current;
    if (!override || !fogRef?.current) return false;

    runningRef.current = true;
    syncHandoffActive();
    lenisRef.current?.stop();
    acquireInputBlock();
    // ProductLights turns on right here, behind the fog — NOT any earlier
    // (see ProductSceneV2/Scene.v2.jsx's own comments on why `roomVisible`
    // alone can't gate this: real lights aren't scoped by mount timing or
    // opacity).
    if (lightsActiveRef) lightsActiveRef.current = true;

    const tl = gsap.timeline({
      onComplete: () => {
        releaseInputBlock();
        lenisRef.current?.start();
        inProductRef.current = true;
        runningRef.current = false;
        syncHandoffActive();
      },
    });

    // Leg A — a camera-facing white fog plane covers the held final scene.
    // Nothing behind it moves; the swap only happens once the frame is
    // fully obscured.
    tl.to(fogRef.current, {
      opacity: 1,
      duration: FOG_IN_DURATION,
      ease: "power2.in",
    });

    // Leg B — while fully covered: hide the carousel's bottle and scene
    // four's video plane, reveal the ALREADY-ASSEMBLED product room exactly
    // as authored (every bottle already on the shelf — nothing to fly in).
    tl.add(() => {
      const mat = sceneFourMaterialRef.current;
      if (mat) {
        mat.transparent = true;
        mat.opacity = 0;
      }
      override.active = false;
      override.hidden = true;
      setRoomOpaque(assets.roomModel, true);
      if (assets.bathroomBottleModel) assets.bathroomBottleModel.visible = true;
      // Hands useProductAutoZoom its cue. Set HERE, under full cover, so its
      // single zoom-in tween is already underway as the fog parts — the
      // room is visibly still arriving when first seen, which is what the
      // old (now removed) revealSettle tween was for, except this is the
      // SAME motion that carries on to the final position instead of a
      // separate one that stops dead and hands over.
      if (roomRevealedRef) roomRevealedRef.current = true;
      // The shower fog appears as part of THIS swap, for exactly the same
      // reason everything else here does: it's the one moment the screen is
      // guaranteed fully covered. Driving it from the timeline (rather than
      // having ProductSceneV2 watch fogRef.opacity cross a threshold from
      // its own useFrame) is what makes it frame-exact with the room
      // arriving, instead of landing a few frames late once the clouds have
      // already started parting.
      if (showerFogRef) showerFogRef.current.revealed = true;
    });

    // Leg C — the fog clears, revealing the room mid-zoom: useProductAutoZoom's
    // own tween started at the swap above and is still running, so the room
    // is genuinely still travelling toward the camera as it comes into view.
    tl.to(
      fogRef.current,
      { opacity: 0, duration: FOG_OUT_DURATION, ease: "power2.out" },
      FOG_IN_DURATION,
    );

    // Leg D — auto-scroll into product's own flythrough-scrub range, once
    // the fog has fully cleared. useProductPhase/the model-motion hook are
    // both purely reactive to window.scrollY every frame (see their own
    // files) — driving the actual scroll position, the same way
    // swingCarousel's scrollWindowToStep already does, gets the camera
    // zooming in with zero changes to either hook. Lenis owns the tween
    // (force:true while stopped); the dummy hold below keeps this timeline's
    // onComplete from firing before that 1.1s is up. toY math is untouched.
    const el = sectionRefMirror.current?.current;
    const sectionTop = el
      ? el.getBoundingClientRect().top + window.scrollY
      : window.scrollY;
    const vh = window.innerHeight / 100;
    const toY =
      sectionTop + (maxStep * STEP_VH_FRACTION * 100 + handoffScrollVh) * vh;
    const scrollAt = FOG_IN_DURATION + FOG_OUT_DURATION;
    tl.add(() => {
      scrollWhileStopped(lenisRef.current, toY, {
        duration: AUTO_SCROLL_DURATION,
        easing: easePower2InOut,
      });
    }, scrollAt);
    tl.to({ t: 0 }, { t: 1, duration: AUTO_SCROLL_DURATION, ease: "none" }, scrollAt);

    return true;
  }, [
    assetsRef,
    flightOverrideRef,
    sceneFourMaterialRef,
    lightsActiveRef,
    fogRef,
    roomRevealedRef,
    showerFogRef,
    maxStep,
    handoffScrollVh,
  ]);

  // Reverse: fog covers the room, everything swaps back INSTANTLY (carousel
  // bottle reappears parked in front of the camera, product room hides),
  // fog clears onto the last carousel scene. Not exposed to callers — it's
  // wired below, purely off scroll direction (productActiveRef's own
  // true->false edge), the same way the forward trigger is purely a
  // consequence of the carousel's own onForwardEdge.
  const triggerReverse = useCallback(() => {
    if (!inProductRef.current || runningRef.current) return;
    const assets = assetsRef.current;
    const override = flightOverrideRef.current;
    if (!override || !fogRef?.current) return;

    runningRef.current = true;
    syncHandoffActive();
    lenisRef.current?.stop();
    acquireInputBlock();

    const tl = gsap.timeline({
      onComplete: () => {
        releaseInputBlock();
        lenisRef.current?.start();
        inProductRef.current = false;
        runningRef.current = false;
        syncHandoffActive();
      },
    });

    // Leg A — scroll back off product's own range onto the carousel's last
    // resting step, starting IMMEDIATELY rather than waiting for the fog:
    // reverse fires mid-gesture, with real scroll momentum already behind
    // it (unlike forward, which begins from rest at a refused edge), so
    // holding the page still first reads as the page stalling.
    const el = sectionRefMirror.current?.current;
    const sectionTop = el
      ? el.getBoundingClientRect().top + window.scrollY
      : window.scrollY;
    const vh = window.innerHeight / 100;
    const restY = sectionTop + maxStep * STEP_VH_FRACTION * 100 * vh;
    tl.add(() => {
      scrollWhileStopped(lenisRef.current, restY, {
        duration: AUTO_SCROLL_DURATION,
        easing: easePower2Out,
      });
    }, 0);
    tl.to({ t: 0 }, { t: 1, duration: AUTO_SCROLL_DURATION, ease: "none" }, 0);

    // Leg B — fog covers the room, in parallel with the scroll above.
    tl.to(
      fogRef.current,
      { opacity: 1, duration: FOG_IN_DURATION, ease: "power2.in" },
      0,
    );

    // Leg C — while fully covered: hide the product room, bring back the
    // carousel's own bottle exactly as it was parked before the handoff.
    tl.add(() => {
      setRoomOpaque(assets.roomModel, false);
      if (assets.bathroomBottleModel) assets.bathroomBottleModel.visible = false;
      override.hidden = false;
      override.active = false;
      // Mirror of the forward swap: lights go off here, under full cover,
      // NOT at trigger time — the room is still the only thing on screen
      // when reverse fires (the fog hasn't risen yet), so flipping this any
      // earlier showed as the room's lights visibly snapping off before the
      // wipe had arrived to hide it.
      if (lightsActiveRef) lightsActiveRef.current = false;
      const mat = sceneFourMaterialRef.current;
      if (mat) {
        mat.transparent = true;
        mat.opacity = 1;
      }
      // Mirror of the forward cue: cleared under full cover, which both
      // resets useProductAutoZoom for the next entry and drops the room
      // straight back to its un-zoomed start — unseen, since the fog is
      // covering the frame at this exact point.
      if (roomRevealedRef) roomRevealedRef.current = false;
      // Mirror of the forward swap: the shower fog goes away here, under
      // full cover, NOT when the reverse was triggered — lightsActiveRef
      // flips at trigger time (above), while the room is still the only
      // thing on screen, so anything keyed off that vanished before the
      // clouds had arrived to hide it.
      if (showerFogRef) showerFogRef.current.revealed = false;
    }, FOG_IN_DURATION);

    // Leg D — the fog clears, revealing the last carousel scene again.
    tl.to(
      fogRef.current,
      { opacity: 0, duration: FOG_OUT_DURATION, ease: "power2.out" },
      FOG_IN_DURATION,
    );

    return true;
  }, [
    assetsRef,
    flightOverrideRef,
    sceneFourMaterialRef,
    lightsActiveRef,
    fogRef,
    roomRevealedRef,
    showerFogRef,
    maxStep,
  ]);

  // --- rail navigation ----------------------------------------------------
  //
  // The forward/reverse timelines above are the ONLY way product's room is
  // ever swapped in or out, and both are reachable only from a scroll gesture
  // at a specific edge. A PageProgress rail jump has neither — but it does run
  // under NavCloudTransition's own full-screen cover, which is exactly the
  // condition those timelines spend their fog legs establishing. So these two
  // do just the instant-swap leg (leg B / leg C) with no fog and no
  // auto-scroll, and leave the caller to place scroll itself.
  //
  // Deliberately NOT reusing trigger()/triggerReverse(): running their fog
  // under the nav clouds would mean ~2.5s of wipe the user cannot see,
  // followed by an auto-scroll fighting the jump the rail just made.

  /** Swap product's room IN, unseen. Returns false if assets aren't loaded. */
  const enterInstant = useCallback(() => {
    if (runningRef.current || !readyRef.current) return false;
    const assets = assetsRef.current;
    const override = flightOverrideRef.current;
    if (!override || !fogRef?.current || !assets?.roomModel) return false;

    const mat = sceneFourMaterialRef.current;
    if (mat) {
      mat.transparent = true;
      mat.opacity = 0;
    }
    override.active = false;
    override.hidden = true;
    setRoomOpaque(assets.roomModel, true);
    if (assets.bathroomBottleModel) assets.bathroomBottleModel.visible = true;
    if (lightsActiveRef) lightsActiveRef.current = true;
    if (roomRevealedRef) roomRevealedRef.current = true;
    if (showerFogRef) showerFogRef.current.revealed = true;
    // The nav clouds are the wipe here, so this one must be clear — a stale
    // opacity from an interrupted timeline would sit as a white veil over the
    // revealed room.
    fogRef.current.opacity = 0;

    inProductRef.current = true;
    syncHandoffActive();
    return true;
  }, [
    assetsRef,
    flightOverrideRef,
    sceneFourMaterialRef,
    lightsActiveRef,
    fogRef,
    roomRevealedRef,
    showerFogRef,
  ]);

  /** Swap product's room back OUT, unseen — mirror of the above. Safe to call
   *  when product was never entered (it simply does nothing). */
  const exitInstant = useCallback(() => {
    if (!inProductRef.current) return;
    const assets = assetsRef.current;
    const override = flightOverrideRef.current;

    setRoomOpaque(assets?.roomModel, false);
    if (assets?.bathroomBottleModel) assets.bathroomBottleModel.visible = false;
    if (override) {
      override.hidden = false;
      override.active = false;
    }
    if (lightsActiveRef) lightsActiveRef.current = false;
    const mat = sceneFourMaterialRef.current;
    if (mat) {
      mat.transparent = true;
      mat.opacity = 1;
    }
    // Clearing this is what re-arms useProductAutoZoom: its own frame handler
    // drops back to `idle` (phase 0) the moment it reads false, so a later
    // entry autoplays from the start rather than arriving pre-zoomed.
    if (roomRevealedRef) roomRevealedRef.current = false;
    if (showerFogRef) showerFogRef.current.revealed = false;
    if (fogRef?.current) fogRef.current.opacity = 0;

    inProductRef.current = false;
    syncHandoffActive();
  }, [
    assetsRef,
    flightOverrideRef,
    sceneFourMaterialRef,
    lightsActiveRef,
    fogRef,
    roomRevealedRef,
    showerFogRef,
  ]);

  // Watches for the exact scroll-direction edge that means "the user has
  // scrolled back up out of product's range" — productActiveRef flips
  // true->false at precisely the boundary the forward handoff's own
  // auto-scroll (leg D above) parks the page on, so this is a direct mirror
  // of the forward trigger's own entry point (swingCarousel's
  // onForwardEdge), just read here instead of pushed in as a callback since
  // there's no equivalent "edge" event on the product side to hook.
  const prevProductActiveRef = useRef(false);
  useFrame(() => {
    const active = !!productActiveRefMirror.current?.current;
    if (
      prevProductActiveRef.current &&
      !active &&
      inProductRef.current &&
      !runningRef.current
    ) {
      triggerReverse();
    }
    prevProductActiveRef.current = active;
  });

  // Exposed so useProductAutoZoom can hand off into the SAME reverse timeline
  // the moment it detects "a little" backward scroll intent, instead of
  // waiting for the raw scroll position to drop all the way back below
  // product's own entry boundary (see that hook's own comment) — the
  // guards above (inProductRef/runningRef) make this safe to call from
  // either place, or both, without ever double-firing.
  //
  // Note the autoplay's own START cue is NOT returned here — it's the
  // caller-owned `roomRevealedRef`, written by the timelines above at each
  // direction's instant-swap point. That's deliberately much earlier than
  // anything this hook could report on completion, which is what lets the
  // zoom run continuously through the fog clearing instead of starting cold
  // afterwards.
  return {
    trigger,
    triggerReverse,
    enterInstant,
    exitInstant,
    activeRef: handoffActiveRef,
  };
}
