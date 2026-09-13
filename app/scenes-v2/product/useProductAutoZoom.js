import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { isScrollLocked } from "../../hooks/useScrollLock";

// THE zoom — one tween, start to finish, no second motion layered under or
// chained after it (see useModelNudgeZ's own comment for what used to be
// there and why it read as a pause). It starts at the reveal instant, while
// the cloud wipe still fully covers the frame, so the room is already
// travelling toward the camera by the time the fog parts and keeps going in
// one unbroken move until it lands at its final position.
//
// `power2.out` for that reason: the fast opening is spent behind the fog,
// and what the viewer actually sees is the long deceleration into the final
// framing. Scroll is locked for the whole span — this is a cinematic beat,
// not something to scrub by hand.
//
// Must outlast the handoff timeline that launched it, so the two release
// input in a sane order: that timeline runs FOG_IN(0.65) + FOG_OUT(0.8) +
// AUTO_SCROLL(1.1) = 2.55s total, and this starts 0.65s in, so anything
// comfortably above ~1.9s is safe.
const AUTO_ZOOM_DURATION = 3.4;
const AUTO_ZOOM_EASE = "power2.out";
// Extra hold after the zoom lands before scroll unlocks — covers the tail of
// the "+" hotspots' own staggered fade-in (see useProductHotspots, which
// starts that fade once scrubProgressRef crosses
// HOTSPOT_REVEAL_AT_SCRUB_PROGRESS — under the ease above that lands around
// 63% through the tween, leaving most of the stagger already done by the
// time it completes).
const HOTSPOT_SETTLE_HOLD = 0.6;

// How far (px) scrollY has to pull back from its high-water mark while
// resting before that counts as "the user wants to go back", rather than
// scroll jitter/rubber-band. Small on purpose — per spec this should take
// only a LITTLE reverse scroll, not a drag back through the whole (now
// otherwise-unused) scrub range.
const REVERSE_TRIGGER_PX = 40;
// How far (viewport heights) forward past the landing point counts as "the
// user has moved on to later content", disarming the reverse-pullback check
// above. Without this, `resting` stayed armed indefinitely — since nothing
// else ever put it back in `idle` — so scrolling UP by REVERSE_TRIGGER_PX
// ANYWHERE further down the page (footer included) would hijack scroll/
// input and replay the reverse cloud transition out of nowhere. One
// viewport is comfortably past product's own hold zone (see constants.js's
// SCROLL_LENGTH_VH) while still well short of "genuinely scrolled back
// toward product".
const SETTLE_DISTANCE_VH = 100;
// The little pull-back cue played BEFORE handing off to the real cloud
// transition (see useSceneToProductHandoff's triggerReverse) — eases the
// zoom back just enough to read as "backing out" (and, as a side effect,
// drops scrubProgressRef back below the hotspot reveal threshold, hiding
// them) without fully reversing the whole flythrough first.
const REVERSE_NUDGE_TARGET = 0.8;
const REVERSE_NUDGE_DURATION = 0.32;
const REVERSE_NUDGE_EASE = "power2.in";

// Mirrors useSceneToProductHandoff's own input block verbatim (capture
// phase, no overflow:hidden) — that file's comment explains why
// overflow:hidden is the wrong tool here: window.scrollTo has to keep
// working under this lock (the reverse hand-off animates scroll position
// itself), which an overflow:hidden html/body silently breaks.
const BLOCKED_EVENTS = ["wheel", "touchmove", "keydown"];
function blockInput(event) {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}
function acquireInputBlock() {
  for (const type of BLOCKED_EVENTS) {
    window.addEventListener(type, blockInput, { capture: true, passive: false });
  }
}
function releaseInputBlock() {
  for (const type of BLOCKED_EVENTS) {
    window.removeEventListener(type, blockInput, { capture: true });
  }
}

// Replaces scroll-scrubbing of the product flythrough with a single
// automatic play-through.
//
// `revealedRef` (useSceneToProductHandoff's roomRevealedRef) is the cue: a
// plain boolean flipped synchronously at the instant-swap point of the
// cloud wipe, in both directions. Starting from THAT — rather than the
// handoff timeline's completion — is what makes the zoom and the arrival a
// single continuous motion: the tween is already running as the fog parts.
//
// It is also deliberately NOT useProductPhase's raw scroll-position
// comparison (`window.scrollY >= startPx`). That reads false at the exact
// moment the forward transition lands, because the auto-scroll targets
// startPx itself and rounding leaves the page a hair short — and since
// useModelNudgeZ and useProductHotspots both hard-gate on it, the zoom and
// the "+" buttons would sit frozen until a manual scroll nudge tipped it
// true.
//
// The tween eases `phaseRef` 0 -> 1 — a plain normalized progress, since it
// is no longer a slice of any scroll range (product's own range is now just
// a linger beat, see constants.js's SCROLL_LENGTH_VH).
//
// Once landed (+ HOTSPOT_SETTLE_HOLD for the hotspot stagger's tail),
// scroll unlocks and phaseRef stays pinned at its finished value regardless
// of further scroll — scrolling forward from here just carries the (already
// fully zoomed) sticky section off screen into whatever comes next.
// Scrolling BACK, even a little (REVERSE_TRIGGER_PX), plays a quick
// pull-back cue then hands straight off to `triggerReverse` for the actual
// cloud transition back to the carousel.
export function useProductAutoZoom({
  revealedRef,
  scrollActiveRef,
  lenis,
  triggerReverse,
}) {
  const phaseRef = useRef(0);
  // "Product owns the frame right now" — what every downstream consumer
  // should gate on instead of useProductPhase's raw scroll comparison.
  //
  // This exists because that comparison (`window.scrollY >= startPx`) is
  // false at the exact moment the forward transition lands: leg D's
  // auto-scroll targets startPx itself, and sub-pixel/rounding drift
  // routinely leaves the page a hair short of it. Both useModelNudgeZ (its
  // `t` collapses to 0) and useProductHotspots (its `settled` stays false)
  // hard-gate on it, so the autoplay below wrote phaseRef into the void and
  // NOTHING moved — no zoom, no "+" buttons — until a manual scroll nudge
  // finally tipped that comparison true. Or'ing in revealedRef (flipped
  // synchronously at the wipe's own swap point) removes the edge entirely
  // while still falling back to real scroll position everywhere else.
  const onScreenRef = useRef(false);
  // idle -> autoplay -> resting -> reversing, plus a `resting` -> `settled`
  // exit once the user has scrolled a screen's worth past the landing point
  // without pulling back (see SETTLE_DISTANCE_VH).
  //
  // EVERY one of those states returns to `idle` the moment revealedRef goes
  // false — see the re-arm block at the top of the frame handler. That is
  // the whole reset mechanism, and it must not be special-cased per mode:
  // the reverse can be started either by this hook (its own pullback
  // hand-off) or, entirely behind its back, by useSceneToProductHandoff's
  // watcher on raw scroll leaving product's range. `resting` and `settled`
  // both used to ignore that second path and stayed put with phaseRef
  // pinned at 1, so a product -> carousel -> product round trip re-entered
  // already fully zoomed with no entry animation at all.
  const modeRef = useRef("idle");
  const tweenRef = useRef(null);
  // The post-landing hold (see the autoplay onComplete). Tracked so the
  // re-arm below can cancel it — killing the tween alone doesn't, and a
  // stray one firing later would push a stale "resting" over the reset.
  const settleCallRef = useRef(null);
  const highWaterRef = useRef(0);
  // scrollY at the moment `resting` began — fixed, unlike highWaterRef
  // which keeps climbing as the user reads on — so SETTLE_DISTANCE_VH can
  // measure "how far past landing", not "how far past the running max".
  const landingYRef = useRef(0);
  const lenisRef = useRef(lenis);
  lenisRef.current = lenis;
  const triggerReverseRef = useRef(triggerReverse);
  triggerReverseRef.current = triggerReverse;

  const releaseLock = () => {
    releaseInputBlock();
    // Mirrors swingCarousel's own releaseScroll: don't resume a Lenis some
    // OTHER holder (e.g. an intro reel) deliberately froze.
    if (!isScrollLocked()) lenisRef.current?.start();
  };

  useFrame(() => {
    const revealed = !!revealedRef.current;
    const mode = modeRef.current;
    // Published BEFORE the state machine below, so consumers see it true on
    // the very same frame the autoplay starts rather than one frame later.
    onScreenRef.current = revealed || !!scrollActiveRef?.current;

    // Re-arm. The room has been swapped back out — by this hook's own
    // pullback hand-off, or by useSceneToProductHandoff's reverse watcher
    // firing on raw scroll leaving product's range, which this hook has no
    // other way to find out about. Either way the next forward entry must
    // autoplay from the start, so drop phaseRef back to 0 and wait for the
    // cue again.
    //
    // Safe to do bluntly here because revealedRef is cleared at the reverse
    // wipe's own instant-swap point, i.e. while the fog fully covers the
    // frame — the room snapping back to startZ is never visible.
    if (!revealed && mode !== "idle") {
      // Only autoplay holds the scroll/input lock itself. In `reversing`
      // triggerReverse's timeline owns it and releases it on its own
      // schedule, so touching it here would unlock mid-transition.
      if (mode === "autoplay") {
        tweenRef.current?.kill();
        tweenRef.current = null;
        settleCallRef.current?.kill();
        settleCallRef.current = null;
        releaseLock();
      }
      modeRef.current = "idle";
      phaseRef.current = 0;
      return;
    }

    if (mode === "idle") {
      phaseRef.current = 0;
      if (!revealed) return;
      modeRef.current = "autoplay";
      lenisRef.current?.stop();
      acquireInputBlock();
      const proxy = { v: 0 };
      tweenRef.current?.kill();
      tweenRef.current = gsap.to(proxy, {
        v: 1,
        duration: AUTO_ZOOM_DURATION,
        ease: AUTO_ZOOM_EASE,
        onUpdate: () => {
          phaseRef.current = proxy.v;
        },
        onComplete: () => {
          settleCallRef.current = gsap.delayedCall(HOTSPOT_SETTLE_HOLD, () => {
            settleCallRef.current = null;
            releaseLock();
            highWaterRef.current = window.scrollY;
            landingYRef.current = window.scrollY;
            modeRef.current = "resting";
          });
        },
      });
      return;
    }

    if (mode === "autoplay") {
      // phaseRef is being written by the tween's own onUpdate above.
      return;
    }

    if (mode === "resting") {
      phaseRef.current = 1;
      const y = window.scrollY;
      // Moved on to later content without pulling back — stop treating any
      // further backward scroll as "wants to go back". Left armed, this is
      // what made scrolling up ANYWHERE below product (footer included)
      // hijack scroll/input and replay the reverse transition out of
      // nowhere, since nothing else ever returned `resting` to `idle`.
      if (y - landingYRef.current > window.innerHeight * (SETTLE_DISTANCE_VH / 100)) {
        modeRef.current = "settled";
        return;
      }
      if (y > highWaterRef.current) highWaterRef.current = y;
      if (highWaterRef.current - y <= REVERSE_TRIGGER_PX) return;

      modeRef.current = "reversing";
      lenisRef.current?.stop();
      acquireInputBlock();
      const proxy = { v: 1 };
      tweenRef.current?.kill();
      tweenRef.current = gsap.to(proxy, {
        v: REVERSE_NUDGE_TARGET,
        duration: REVERSE_NUDGE_DURATION,
        ease: REVERSE_NUDGE_EASE,
        onUpdate: () => {
          phaseRef.current = proxy.v;
        },
        onComplete: () => {
          // Hand off cleanly — triggerReverse acquires its own block/lenis
          // stop before this returns, so there's no unblocked gap.
          releaseInputBlock();
          triggerReverseRef.current?.();
        },
      });
      return;
    }

    if (mode === "settled") {
      // Holds the landed pose, just no longer watching for a pullback. Not
      // a dead end: the re-arm block above returns it to `idle` as soon as
      // the room is swapped back out.
      phaseRef.current = 1;
      return;
    }

    // mode === "reversing": triggerReverse's own timeline now owns scroll,
    // input and the fog, and the re-arm block above resets us once it
    // reports the room actually swapped back out. Nothing to do until then.
  });

  // Jump straight to the landed state, skipping the zoom entirely — for a
  // PageProgress rail click on "Shop" (see utils/navSectionTargets.js), which
  // promises the finished product display with its "+" hotspots up, not a
  // 3.4s camera move the user didn't ask to sit through. The caller has
  // already swapped the room in behind the nav clouds (see
  // useSceneToProductHandoff's enterInstant), so `revealedRef` reads true and
  // the frame handler above will hold this in `resting` rather than re-arming.
  //
  // Entering `resting` (not `settled`) on purpose: the pullback watch is what
  // makes a small backward scroll play the reverse transition, and arriving
  // by rail should behave exactly like arriving by scroll from here on.
  const landInstant = () => {
    tweenRef.current?.kill();
    tweenRef.current = null;
    settleCallRef.current?.kill();
    settleCallRef.current = null;
    // Nothing here acquires the lock, but a previous mode may have — release
    // unconditionally so a rail jump out of a mid-autoplay entry can't strand
    // the input block.
    releaseLock();
    phaseRef.current = 1;
    onScreenRef.current = true;
    highWaterRef.current = window.scrollY;
    landingYRef.current = window.scrollY;
    modeRef.current = "resting";
  };

  return { phaseRef, onScreenRef, landInstant };
}
