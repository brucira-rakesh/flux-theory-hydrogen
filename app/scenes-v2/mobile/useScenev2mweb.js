import { useCallback, useEffect, useRef, useState } from "react";
import { useLenis } from "lenis/react";
import {
  FRAME_COUNT,
  LOOP_FPS,
  SCENES,
  SWIPE_DEAD_ZONE_PX,
  TRANSITION_DURATION_SEC,
  getMwebHeroFramePath,
} from "../../data/mwebHeroSequence";
import {
  drawFrameCover,
  prefersReducedMotion,
  setupCanvas,
} from "../../utils/frameSequence";
import { createSequenceLoader } from "../../utils/sequenceLoader";
import {
  getScrollRoot,
  getScrollY,
  scrollRootTo,
  scrollRootToSmooth,
} from "../../utils/scrollRoot";
import {
  acquireScrollLock,
  releaseScrollLock,
} from "../../hooks/useScrollLock";
import { scrollNavState } from "../../utils/scrollNavState";

/** How long the scroll that carries the page off this section takes once
 *  the pin is released. Roughly the carousel's own commit duration, so
 *  leaving feels like one more scene change rather than a page jump. */
const EXIT_DURATION_SEC = 1.1;

/**
 * Upper bound on how long, after a pin, the section keeps re-asserting its
 * lock position.
 *
 * A mobile fling is a native, compositor-driven momentum scroll, and taking
 * the scroll lock does not reliably kill one already in flight: `overflow:
 * hidden` and the touchmove block both arrive too late for momentum the
 * finger has already let go of. So `pin`'s snap lands and the next frames of
 * leftover momentum scroll straight back off it — the section ends up parked
 * part-way up the viewport with scrolling frozen, which is the "stuck past
 * the section" a fast swipe up out of ProductV3 produces. A real `position:
 * sticky` box is held by the compositor and never has this problem; holding
 * the lock line each frame until the residue is spent is how a JS pin gets
 * the same result.
 *
 * A bound only — the loop exits the moment the position holds still (see
 * PIN_SETTLE_STABLE_FRAMES), so a pin arrived at slowly barely runs.
 */
const PIN_SETTLE_MAX_MS = 1200;

/** Consecutive frames the scroller has to sit on the lock line before the
 *  momentum counts as spent and the settle loop stops. */
const PIN_SETTLE_STABLE_FRAMES = 4;

/** Under this, drift is rounding rather than momentum — the lock line is
 *  rounded to a whole pixel while Lenis and dvh boxes both land on
 *  fractional ones. */
const PIN_SETTLE_EPSILON_PX = 1;

/**
 * How many frames ahead the probe projects the current scroll velocity when
 * deciding to pin.
 *
 * The plain crossing tests fire on the frame the pin line is actually
 * crossed and correct within it, which is exact while Lenis owns the scroll
 * (HomeV3Page's syncTouch). Anywhere a native fling still drives the page,
 * the position reaching this probe is already a frame or two stale, so
 * reacting to the crossing means reacting after the section has visibly gone
 * past. Projecting velocity forward pins on the approach instead: the snap
 * then arrives early, in the direction of travel, which reads as the section
 * catching the flick rather than as the page being dragged back out of the
 * section above.
 */
const PIN_LOOKAHEAD_FRAMES = 2;

/** Minimum speed, in px per frame, before the projection above is used at
 *  all. Under it there is no lag worth anticipating, and an unhurried scroll
 *  should land on the line exactly rather than jump the last few pixels. */
const PIN_LOOKAHEAD_MIN_VELOCITY_PX = 12;

/** Decelerating ease — the commit lands softly on the target frame instead
 *  of snapping to a stop at a constant rate. */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * Scenev2mweb's playback engine — a swipe-controlled image-sequence
 * carousel. Each entry in SCENES (data/mwebHeroSequence.js) owns a
 * contiguous frame range and idles by ping-ponging [start, loopEnd]. Any one
 * swipe (past a small dead zone, just to tell it apart from a tap/jitter —
 * there is no distance/velocity threshold to clear) commits to the
 * next/previous scene: the playhead eases from wherever it currently sits to
 * that scene's `start` over a fixed TRANSITION_DURATION_SEC, where the idle
 * loop picks back up. `activeSceneIndex` (returned below) updates the MOMENT
 * a swipe commits, not once the ease lands — Scenev2mwebOverlay keys its
 * caption swap off it, and the outgoing copy should start fading out right
 * as the canvas starts its own whip-pan, not 1.5s later once that's done.
 *
 * Two phases, tracked in phaseRef (a ref, not state — this runs inside a rAF
 * loop and re-rendering React every frame would be wasted work):
 *
 *   idle       ping-ponging the active scene's loop range. A swipe here
 *              starts a commit.
 *   committing a swipe was just released; the playhead eases to the target
 *              scene's `start` on its own. New gestures are ignored for the
 *              full TRANSITION_DURATION_SEC — see onPointerDown's `phaseRef
 *              !== "idle"` guard — so mid-flight swipes can't stack up.
 */
export function useScenev2mweb() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const lastPaintedFrameRef = useRef(-1);
  const loaderRef = useRef(null);

  const frameRef = useRef(SCENES[0]?.start ?? 0);
  const sceneIndexRef = useRef(0);
  const phaseRef = useRef("idle");
  const loopDirRef = useRef(1);
  const commitStartFrameRef = useRef(0);
  const commitTargetRef = useRef(0);
  const commitElapsedRef = useRef(0);

  const dragStartYRef = useRef(0);
  const pointerIdRef = useRef(null);

  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  /** rAF handle for the post-pin settle loop — see PIN_SETTLE_MAX_MS. */
  const settleRafRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const isReducedMotion = prefersReducedMotion();

  // -- pin bookkeeping -----------------------------------------------------
  // `pinned` is the state copy for rendering (it drives touch-action, see
  // Scenev2mweb.css); pinnedRef is what the scroll probe and the pointer
  // handlers read, since both run outside React's render cycle.
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  /** Armed = "a crossing in this direction should pin". Down starts armed
   *  (the first approach is from the hero above); up arms only once the
   *  section has been left downward, which is what makes coming back up
   *  from ProductV3 re-pin and walk the scenes backwards. */
  const armedDownRef = useRef(true);
  const armedUpRef = useRef(false);
  /**
   * Arming the upward crossing is also a claim ON it: the seam marker sits
   * exactly on our pin line, so CloudTransition watches the very same
   * crossing and — subscribing to Lenis first, with its `!isScrollLocked()`
   * guard useless once we have released the lock — would otherwise win it
   * and wipe back to the top of the page instead of letting us re-pin.
   * Published as one write with the ref so the two can never disagree; see
   * scrollNavState.suppressSeamReverse.
   */
  const setArmedUp = useCallback((value) => {
    armedUpRef.current = value;
    scrollNavState.suppressSeamReverse = value;
  }, []);
  /** Scroll offset at which the section's top sits on the viewport top —
   *  the position the pin snaps to and holds. */
  const lockYRef = useRef(0);
  const prevScrollYRef = useRef(null);
  /** Smoothed scroll speed in px per frame, signed — see the probe. */
  const velocityRef = useRef(0);
  const readyRef = useRef(false);

  // undefined outside a ReactLenis provider (the standalone /scenev2mweb
  // route) — every scroll below falls back to the native path there.
  const lenis = useLenis();
  const lenisRef = useRef(null);

  // Mirrored into refs so the scroll probe and the pointer handlers — both
  // of which run outside React's render cycle — read current values without
  // being rebuilt every time one of them changes.
  useEffect(() => {
    readyRef.current = ready;
    lenisRef.current = lenis ?? null;
  }, [ready, lenis]);

  // -- preload ---------------------------------------------------------------

  useEffect(() => {
    const loader = createSequenceLoader({
      frameCount: FRAME_COUNT,
      getFramePath: getMwebHeroFramePath,
    });
    loaderRef.current = loader;
    let cancelled = false;

    // Gate on the first 20 frames only — enough to cover the first scene's
    // idle loop range — so the canvas paints something as soon as it can
    // instead of sitting blank until all 383 frames finish downloading.
    // The rest keep loading in the background on this same loader instance.
    loader.preloadSequence(undefined, { readyCount: 20 }).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      loaderRef.current = null;
    };
  }, []);

  // -- paint -------------------------------------------------------------

  const paint = useCallback((force = false) => {
    const canvas = canvasRef.current;
    const loader = loaderRef.current;
    if (!canvas || !loader) return;

    const frameIndex = Math.round(frameRef.current);
    // console.log(frameIndex);
    const image = loader.getLoadedFrame(frameIndex);
    if (!image) return;
    if (!force && frameIndex === lastPaintedFrameRef.current) return;

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const needsResize =
      force ||
      !ctxRef.current ||
      canvasSizeRef.current.width !== cw ||
      canvasSizeRef.current.height !== ch;

    if (needsResize) {
      const setup = setupCanvas(canvas, canvas, ctxRef);
      if (!setup) return;
      canvasSizeRef.current = { width: setup.width, height: setup.height };
      lastPaintedFrameRef.current = -1;
    }

    const ctx = ctxRef.current;
    if (!ctx) return;

    const { width, height } = canvasSizeRef.current;
    const drew = drawFrameCover(ctx, image, width, height);
    if (drew) lastPaintedFrameRef.current = frameIndex;
  }, []);

  useEffect(() => {
    if (ready) paint(true);
  }, [ready, paint]);

  // -- animation loop ------------------------------------------------------

  const stepIdle = useCallback((dtSec) => {
    const scene = SCENES[sceneIndexRef.current];
    if (!scene) return;
    const { start, loopEnd } = scene;
    if (loopEnd <= start) return;

    let next = frameRef.current + loopDirRef.current * LOOP_FPS * dtSec;
    if (next >= loopEnd) {
      next = loopEnd;
      loopDirRef.current = -1;
    } else if (next <= start) {
      next = start;
      loopDirRef.current = 1;
    }
    frameRef.current = next;
  }, []);

  const stepCommitting = useCallback((dtSec) => {
    commitElapsedRef.current += dtSec;
    const t = Math.min(1, commitElapsedRef.current / TRANSITION_DURATION_SEC);
    const eased = easeOutCubic(t);

    const start = commitStartFrameRef.current;
    const target = commitTargetRef.current;
    frameRef.current = start + (target - start) * eased;

    if (t >= 1) {
      frameRef.current = target;
      loopDirRef.current = 1;
      phaseRef.current = "idle";
    }
  }, []);

  useEffect(() => {
    if (isReducedMotion) return undefined;

    const tick = (timestamp) => {
      const dtMs = lastTsRef.current
        ? Math.min(timestamp - lastTsRef.current, 64)
        : 16.67;
      lastTsRef.current = timestamp;
      const dtSec = dtMs / 1000;

      if (ready) {
        if (phaseRef.current === "idle") stepIdle(dtSec);
        else if (phaseRef.current === "committing") stepCommitting(dtSec);
      }

      paint();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [ready, isReducedMotion, stepIdle, stepCommitting, paint]);

  // -- pin -----------------------------------------------------------------

  /**
   * Page scroll, in whichever scroller is active. `force: true` is required
   * on the Lenis path: Lenis refuses programmatic scrolls while stopped,
   * and the pin stops it. Duration 0 goes through `immediate` rather than a
   * zero-length tween, which Lenis would still spread across a frame.
   */
  const scrollPageTo = useCallback((y, durationSec) => {
    const instance = lenisRef.current;
    if (instance) {
      if (durationSec <= 0) {
        instance.scrollTo(y, { immediate: true, force: true });
      } else {
        instance.scrollTo(y, { duration: durationSec, force: true });
      }
      return;
    }
    if (durationSec <= 0) scrollRootTo(y);
    else scrollRootToSmooth(y);
  }, []);

  /** Stop the settle loop, if one is running. */
  const stopSettle = useCallback(() => {
    if (settleRafRef.current != null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
  }, []);

  /**
   * Hold the page on the lock line until the fling that pinned us runs out of
   * momentum — the why is in PIN_SETTLE_MAX_MS's note.
   *
   * Corrects only when the scroller has actually drifted, so the common case
   * (a pin arrived at under Lenis, already stationary) costs a handful of
   * `scrollTop` reads and nothing else. The correction goes back through
   * scrollPageTo rather than writing `scrollTop` directly, so Lenis's own
   * idea of where the page is stays in step with the DOM — unpin's exit tween
   * is computed from it.
   */
  const startSettle = useCallback(() => {
    stopSettle();
    const deadline = performance.now() + PIN_SETTLE_MAX_MS;
    let stableFrames = 0;

    const step = () => {
      settleRafRef.current = null;
      // Released mid-settle (a swipe past the last scene, or Discover) — the
      // exit scroll owns the page now and must not be dragged back.
      if (!pinnedRef.current) return;

      if (Math.abs(getScrollY() - lockYRef.current) > PIN_SETTLE_EPSILON_PX) {
        stableFrames = 0;
        scrollPageTo(lockYRef.current, 0);
        prevScrollYRef.current = lockYRef.current;
      } else {
        stableFrames += 1;
      }

      if (stableFrames >= PIN_SETTLE_STABLE_FRAMES) return;
      if (performance.now() >= deadline) return;
      settleRafRef.current = requestAnimationFrame(step);
    };

    settleRafRef.current = requestAnimationFrame(step);
  }, [scrollPageTo, stopSettle]);

  /**
   * Take the page. From here the section is stuck to the top of the
   * viewport and nothing scrolls: the scroll lock (three layers, see
   * hooks/useScrollLock) holds it, and swipes are the only way through the
   * scenes. Snapping to lockY on the way in is what makes a fast flick
   * settle exactly on the section's top edge instead of wherever the
   * gesture's momentum had carried it.
   */
  const pin = useCallback(
    (direction, pinY) => {
      if (pinnedRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      // The page has a Lenis but this hook hasn't been handed the instance
      // yet (ReactLenis creates it in its own effect). Pinning now would
      // latch the flag without ever stopping Lenis — bail and let the next
      // probe retry.
      // Lenis stamps its class on its OWN root, which in element-scroller
      // mode is the scroll container rather than <html> — testing
      // documentElement alone quietly skipped this guard on exactly the
      // mobile path it matters most on. It matters more still now that
      // Lenis drives touch there (HomeV3Page's syncTouch): pinning without
      // an instance would take the lock without stopping the scroller that
      // is mid-throw.
      const lenisHost = getScrollRoot() ?? document.documentElement;
      if (lenisHost.classList.contains("lenis") && !lenisRef.current) return;

      // The probe's own reading by preference: it decided the crossing
      // against that number, and re-measuring here would anchor the pin to a
      // rect read a frame later than the scroll offset it gets added to.
      lockYRef.current =
        pinY ?? Math.round(getScrollY() + el.getBoundingClientRect().top);
      pinnedRef.current = true;
      setPinned(true);
      // The reading that got us here must not survive into the next
      // approach, or a stale projection could re-pin off it — see the probe.
      velocityRef.current = 0;
      // Synchronous, ref-counted, and it stops Lenis — which has to happen
      // before the snap below, since lenis.stop() resets internally and
      // would cancel an already-in-flight scrollTo.
      acquireScrollLock(lenisRef.current);
      scrollPageTo(lockYRef.current, 0);
      prevScrollYRef.current = lockYRef.current;
      // The fling that carried us across the pin line can still have momentum
      // left, and the lock does not stop one already in flight — hold the
      // line until it is spent. See PIN_SETTLE_MAX_MS.
      startSettle();

      // Disarm the direction we came in on, so the snap itself can't read
      // back as another crossing.
      if (direction > 0) armedDownRef.current = false;
      else setArmedUp(false);
    },
    [scrollPageTo, startSettle, setArmedUp],
  );

  /**
   * Give the page back and carry it off the section, `direction` being the
   * way out: down past the carousel (a swipe with no next scene) or back up
   * toward the hero (no previous scene).
   *
   * Leaving DOWN arms the upward crossing, so scrolling back up out of
   * ProductV3 pins here again and the next swipe walks back through the
   * scenes rather than sliding past them.
   *
   * Leaving UP arms NOTHING, and that is load-bearing. The seam marker sits
   * exactly on our pin line, so CloudTransition's reverse wipe — which the
   * scroll below is what triggers — snaps the page straight back onto it
   * before teleporting up to the hero. With the downward crossing armed,
   * that snap read as a genuine downward crossing: we re-pinned mid-wipe
   * and took the scroll lock again, and CloudTransition only restarts Lenis
   * `if (!isScrollLocked())` — so it never did. That was the page stuck on
   * the carousel with scroll dead. The probe re-arms the downward crossing
   * on its own once the section is genuinely back below the fold.
   */
  const unpin = useCallback(
    (direction) => {
      if (!pinnedRef.current) return;
      // Before anything else: the settle loop would otherwise spend up to a
      // frame yanking the exit scroll below back onto the lock line.
      stopSettle();
      pinnedRef.current = false;
      setPinned(false);
      velocityRef.current = 0;
      armedDownRef.current = false;
      setArmedUp(direction > 0);
      releaseScrollLock(lenisRef.current);

      const el = containerRef.current;
      const height = el?.offsetHeight ?? window.innerHeight;
      const target =
        direction > 0
          ? lockYRef.current + height
          : Math.max(0, lockYRef.current - window.innerHeight);
      scrollPageTo(target, EXIT_DURATION_SEC);
    },
    [scrollPageTo, stopSettle, setArmedUp],
  );

  /** Discover's action — the one way past the carousel that doesn't wait
   *  for the last scene. */
  const scrollPastSection = useCallback(() => {
    if (pinnedRef.current) {
      unpin(1);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const target = getScrollY() + el.getBoundingClientRect().bottom;
    scrollPageTo(target, EXIT_DURATION_SEC);
  }, [scrollPageTo, unpin]);

  /**
   * Watches for the section's top edge crossing the top of the viewport and
   * pins on the way through, in either direction. Driven off Lenis's own
   * tick rather than a scroll listener so it sees the same positions Lenis
   * is scrolling to; while pinned Lenis is stopped, so this simply stops
   * being called until the pin is released.
   *
   * The crossing is tested against document-space positions (previous vs
   * current scroll offset either side of the pin line) rather than the live
   * rect: a hard flick can carry a single tick clean past the whole
   * section, and a rect test would read that as "already below us" and let
   * it fly by unpinned.
   */
  const probe = useCallback(() => {
    const el = containerRef.current;
    if (!el || isReducedMotion) return;

    const scrollY = getScrollY();
    const prev = prevScrollYRef.current;
    prevScrollYRef.current = scrollY;
    // Two drivers feed this probe (Lenis's tick and the scroller's own
    // scroll event) and within a frame they report the same position, so a
    // zero delta is the second of that pair rather than a stall — sampling
    // it would halve the estimate every frame. Only real movement updates
    // it; the blend is what keeps one jittery frame from dominating.
    if (prev != null && scrollY !== prev) {
      velocityRef.current = (velocityRef.current + (scrollY - prev)) / 2;
    }
    if (pinnedRef.current) return;

    const rect = el.getBoundingClientRect();
    const pinY = Math.round(scrollY + rect.top);
    lockYRef.current = pinY;

    // Crossing test BEFORE the fully-above/below re-arms below, and this
    // order is the whole point: one tick of a fast flick can carry the page
    // clean past the section, and the rect that lands in this probe then
    // says "already gone by". Read off scroll offsets either side of the
    // pin line instead and that jump is still a crossing — checked first,
    // so it can't be swallowed by a re-arm branch that returns early.
    //
    // Frames still loading: hold nothing. Pinning there would park the user
    // on an unpainted canvas with no swipe handlers attached to let them
    // out — better to let the section be scrolled past than to trap them.
    if (readyRef.current && prev != null) {
      if (
        scrollY > prev &&
        armedDownRef.current &&
        prev < pinY &&
        scrollY >= pinY
      ) {
        pin(1, pinY);
        return;
      }
      if (
        scrollY < prev &&
        armedUpRef.current &&
        prev > pinY &&
        scrollY <= pinY
      ) {
        pin(-1, pinY);
        return;
      }

      // Same two crossings, one projection ahead — see PIN_LOOKAHEAD_FRAMES.
      // Deliberately after the exact tests: when the line has genuinely been
      // crossed already, that is the reading to pin on.
      const velocity = velocityRef.current;
      if (Math.abs(velocity) >= PIN_LOOKAHEAD_MIN_VELOCITY_PX) {
        const projected = scrollY + velocity * PIN_LOOKAHEAD_FRAMES;
        if (
          velocity > 0 &&
          armedDownRef.current &&
          scrollY < pinY &&
          projected >= pinY
        ) {
          pin(1, pinY);
          return;
        }
        if (
          velocity < 0 &&
          armedUpRef.current &&
          scrollY > pinY &&
          projected <= pinY
        ) {
          pin(-1, pinY);
          return;
        }
      }
    }

    // Fully below us (back up in the hero) / fully above us (down in
    // ProductV3): re-arm the crossing that would bring us back.
    if (rect.top >= window.innerHeight) armedDownRef.current = true;
    else if (rect.bottom <= 0) setArmedUp(true);
  }, [isReducedMotion, pin, setArmedUp]);

  useLenis(probe);

  // Second driver for the same probe. Lenis's tick is the primary one, but
  // a mobile fling is a NATIVE scroll of the container (touch is not synced
  // through Lenis here), and a fast one has to be caught on the frame it
  // happens or the pin line is already behind us. Listening on the scroller
  // itself means the probe sees that scroll directly rather than waiting to
  // be told about it. Both drivers run the same idempotent function.
  useEffect(() => {
    const scroller = getScrollRoot() ?? window;
    scroller.addEventListener("scroll", probe, { passive: true });
    return () => scroller.removeEventListener("scroll", probe);
  }, [probe]);

  // Never leave the lock held by a section that has gone away.
  useEffect(
    () => () => {
      if (settleRafRef.current != null) {
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = null;
      }
      if (pinnedRef.current) {
        pinnedRef.current = false;
        releaseScrollLock(lenisRef.current);
      }
      // Never leave the seam claimed by a section that has gone away, or
      // CloudTransition's reverse wipe stays suppressed for the next route.
      scrollNavState.suppressSeamReverse = false;
    },
    [],
  );

  // -- pointer input -------------------------------------------------------

  const beginCommit = useCallback((targetScene, sceneDelta) => {
    commitStartFrameRef.current = frameRef.current;
    commitTargetRef.current = targetScene.start;
    commitElapsedRef.current = 0;
    phaseRef.current = "committing";

    // Bumped here, not once the ease lands — activeSceneIndex is what
    // Scenev2mwebOverlay's caption swap keys off, and it should start
    // fading the outgoing copy out THE MOMENT the swipe commits, in step
    // with the canvas beginning its own whip-pan, not 1.5s later once the
    // canvas has already finished.
    sceneIndexRef.current += sceneDelta;
    setActiveSceneIndex(sceneIndexRef.current);
  }, []);

  useEffect(() => {
    if (isReducedMotion) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;

    const onPointerDown = (event) => {
      // Only while the section holds the page — unpinned, a drag here is
      // the user scrolling the page past us and none of our business.
      if (!pinnedRef.current) return;
      // Blocks a new gesture for as long as a swipe is still animating —
      // see phaseRef's "committing" note above.
      if (!ready || phaseRef.current !== "idle") return;
      pointerIdRef.current = event.pointerId;
      // Wrapped defensively — some pointer types (and any synthetic event
      // without a real active pointer behind it) throw here instead of
      // failing silently, and losing the gesture over it is worse than
      // losing capture.
      try {
        el.setPointerCapture?.(event.pointerId);
      } catch {
        // no-op — see above
      }
      dragStartYRef.current = event.clientY;
    };

    const endGesture = (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;
      try {
        el.releasePointerCapture?.(event.pointerId);
      } catch {
        // no-op — see onPointerDown's setPointerCapture try/catch
      }

      // Nothing scrubs live while the finger is down — only the released
      // gesture's net direction matters, past a small dead zone that tells
      // a real swipe apart from a tap/jitter. There is no further distance
      // or velocity threshold: any swipe past that commits.
      const deltaY = event.clientY - dragStartYRef.current;
      if (Math.abs(deltaY) < SWIPE_DEAD_ZONE_PX) return;

      // Swiping UP (finger moves toward the top, deltaY negative) advances
      // to the next scene — the same "swipe up for next" convention as a
      // stories UI.
      if (deltaY < 0) {
        const nextScene = SCENES[sceneIndexRef.current + 1];
        // Out of scenes: this swipe is the one that lets the page go, and
        // scrolling is free from here until the section is re-entered from
        // below.
        if (nextScene) beginCommit(nextScene, 1);
        else unpin(1);
      } else {
        const prevScene = SCENES[sceneIndexRef.current - 1];
        // First scene, swiping back: let go upward. The scroll this issues
        // is what carries the marker back across CloudTransition's reverse
        // line, so the cloud wipe plays and lands the page on the hero at
        // its own start — see HomeV3Page's reverseLandTarget/onReverseLand
        // on that boundary, and unpin's note on why nothing re-arms here.
        if (prevScene) beginCommit(prevScene, -1);
        else unpin(-1);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", endGesture);
    el.addEventListener("pointercancel", endGesture);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", endGesture);
      el.removeEventListener("pointercancel", endGesture);
    };
  }, [ready, isReducedMotion, beginCommit, unpin]);

  // -- resize --------------------------------------------------------------

  useEffect(() => {
    const onResize = () => {
      lastPaintedFrameRef.current = -1;
      paint(true);
    };
    window.addEventListener("resize", onResize, { passive: true });

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [paint]);

  return {
    containerRef,
    canvasRef,
    ready,
    activeSceneIndex,
    scenes: SCENES,
    reducedMotion: isReducedMotion,
    pinned,
    scrollPastSection,
  };
}
