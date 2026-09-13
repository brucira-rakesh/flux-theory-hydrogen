import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useLenis } from "lenis/react";
import RainOverlay from "../RainEffect/RainOverlay";
import { usePreloader } from "../Preloader/PreloaderContext";
import { prefersReducedMotion } from "../../hooks/useSpotlight";
import {
  acquireScrollLock,
  isScrollLocked,
  releaseScrollLock,
  useScrollLock,
} from "../../hooks/useScrollLock";
import { setupCanvas } from "../../utils/frameSequence";
import { createSequenceLoader } from "../../utils/sequenceLoader";
import { getScrollY } from "../../utils/scrollRoot";
import { overlayWipe } from "../../overlayWipeState";
import HeroScrollCue from "../HeroScrollCue/HeroScrollCue";
import {
  AUTOPLAY_FRAME_COUNT,
  HOME_SEQ_FPS,
  SCROLL_FRAME_COUNT,
  getScrollFramePath,
} from "../../data/homeSeq";
import iconScrollChevron from "../../assets/icons/icon-scroll-chevron.svg";
import "./IntroHeroV3.css";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * IntroHeroV3 — fork of IntroHeroV2, forked for HomeV3Page.
 *
 * Same two-sequence canvas hero (time-driven autoplay reel, then a second
 * sequence), but the second reel is NOT scroll-scrubbed: the first downward
 * input after autoplay starts it playing on its own wall-clock timer at a
 * locked SCROLL_SEQ_FPS. That same input is swallowed before Lenis sees it
 * (HomeV3Page's Lenis is `smoothWheel` with duration 1.2 — one trackpad tick
 * otherwise interpolates clean through the hero buffer into CloudTransition)
 * and scroll is frozen for SCROLL_HOLD_MS so leftover ticks from the
 * starting gesture cannot carry the page into the next section. After that
 * window the lock is released whether or not the reel has finished: further
 * scroll carries on toward CloudTransition/the carousel, and the reel keeps
 * drawing in the background until it hits its last frame. Reverse from
 * resting is the same machine the other way.
 *
 * The hold uses acquireScrollLock but NEVER programmatic scrollTo while it
 * is on — that overflow:hidden + scrollTo combo is what deadlocked Firefox
 * in an earlier version that froze the page for the entire reel.
 *
 * Only the canvas-sequence hero mode is implemented — HomeV3Page has no use
 * for the plain-<video> fallback mode IntroHeroV2 supports (HERO_MODE is
 * 'sequence' anyway; see config/heroMode.js).
 */
// Starts together with the autoplay reel rather than trailing near its end
// (IntroHeroV2's own timing) — the reel and the title/copy read as one
// single reveal on handoff.
export const COPY_REVEAL_DELAY_SEC = 0;
const DESC_REVEAL_OFFSET_SEC = 0.25;

const TITLE_STATIC_LINE = "Feel the";
const TITLE_PHRASES = [
  "water caress you.",
  "lather embrace you.",
  "fragrance uplift you.",
];
const TITLE_FINAL_LINES = ["Every shower", "shapes a new you."];
const TITLE_PHRASE_INTERVAL_SEC = 2;
/**
 * Resting opacity of the h1. The heading is `mix-blend-overlay` copy over the
 * hero reel and reads too hot at full strength; the scroll cue and the mobile
 * "swipe down" row are deliberately NOT inside the h1 (see the render below)
 * so they stay unblended at opacity 1. Lives here rather than in CSS because
 * GSAP writes `opacity` on the h1 itself during the reveal.
 */
const TITLE_OPACITY = 0.6;
const TITLE_IN_DURATION_SEC = 1;
const TITLE_OUT_DURATION_SEC = 0.45;
const TITLE_IN_CHAR_STAGGER_SEC = 0.03;
const TITLE_IN_STAGGER_MAX_SEC = 0.9;
const TITLE_OUT_STAGGER_SEC = 0.25;
const TITLE_EXIT_TOTAL_SEC = TITLE_OUT_DURATION_SEC + TITLE_OUT_STAGGER_SEC;
const TITLE_EXIT_AT_SEC = TITLE_PHRASE_INTERVAL_SEC - TITLE_EXIT_TOTAL_SEC;

/**
 * Playback rate for the scroll-triggered second sequence. Wall-clock, not
 * refresh-tied: the playhead advances at this fps regardless of how fast
 * (or how many times, or in which direction) the user scrolls while it
 * runs. Scroll is only frozen for SCROLL_HOLD_MS at the start of a run
 * (see the component doc comment above).
 */
const SCROLL_SEQ_FPS = 30;

/**
 * How long to freeze the page after a scroll-sequence run starts, so the
 * gesture that kicked it off cannot also be the gesture that crosses into
 * CloudTransition. Released on a timer, not when the reel ends.
 */
const SCROLL_HOLD_MS = 1000;

/**
 * dvh of sticky room AFTER the scroll-sequence finishes playing, still
 * showing its last frame — same idea as HomeV3Page's LAST_SCENE_EXIT_VH.
 * Layout/geometry buffer for CloudTransition's pin/trigger seam (see
 * HANDOFF_HOLD_VH below). The "don't skip on the first tick" job belongs
 * to SCROLL_HOLD_MS, not this.
 */
const SEQUENCE_EXIT_VH = 40;

const SCROLL_KEYS = new Set([
  " ",
  "Spacebar",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
]);

const KEY_DIRECTION = {
  ArrowDown: 1,
  PageDown: 1,
  " ": 1,
  Spacebar: 1,
  End: 1,
  ArrowUp: -1,
  PageUp: -1,
  Home: -1,
};

function isTextEntry(target) {
  if (!target || typeof target.tagName !== "string") return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Extra dvh of sticky room held AFTER SEQUENCE_EXIT_VH, with the pin still
 * covering the viewport on the sequence's last frame.
 *
 * A `sticky top-0` box one viewport tall stops sticking once its container
 * has less than one viewport of room left — i.e. exactly at
 * `sectionTop + (sectionHeight - 100dvh)`. CloudTransition's forward trigger
 * fires one viewport BEFORE its boundary marker
 * (AUTOPLAY_TRIGGER_MARKER_VH), i.e. at `markerDocTop - 100dvh`. With the
 * marker sitting at the section's own bottom edge those two are the SAME
 * scroll position, so the pin begins lifting on the very frame the wipe is
 * still deciding to fire (it also debounces a tick) — which is the sliver of
 * the next section that shows through underneath.
 *
 * This buys that gap back: the section is this much taller than the exit
 * buffer needs, and HomeV3Page places the marker at the sequence-end rest
 * rather than the section's end (then pulls the next section up by the same
 * amount so the wipe still lands it perfectly framed). The pin is therefore
 * still fully stuck, holding the last frame, for this entire distance — the
 * trigger, its debounce, and the whole gather-in all happen while it covers.
 */
export const HANDOFF_HOLD_VH = 40;

function drawFrameCover(ctx, image, width, height) {
  const imgW = image.naturalWidth || image.width;
  const imgH = image.naturalHeight || image.height;
  if (!imgW || !imgH) return false;

  const scale = Math.max(width / imgW, height / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const drawX = (width - drawW) / 2;
  const drawY = (height - drawH) / 2;

  ctx.drawImage(image, drawX, drawY, drawW, drawH);
  return true;
}

function drawSequenceFrame(
  index,
  { canvasRef, ctxRef, sizeRef, lastDrawnRef, loader },
) {
  const canvas = canvasRef.current;
  if (!canvas || !loader) return;
  if (index === lastDrawnRef.current) return;

  const image = loader.getLoadedFrame(index);
  if (!image) return;

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const needsResize =
    !ctxRef.current ||
    sizeRef.current.width !== cw ||
    sizeRef.current.height !== ch;

  if (needsResize) {
    const setup = setupCanvas(canvas, canvas, ctxRef);
    if (!setup) return;
    sizeRef.current = { width: setup.width, height: setup.height };
  }

  const ctx = ctxRef.current;
  if (!ctx) return;

  const { width, height } = sizeRef.current;
  if (drawFrameCover(ctx, image, width, height)) lastDrawnRef.current = index;
}

export default function IntroHeroV3({ onAutoplayDone, resetRef } = {}) {
  const { handoff, sequenceLoader } = usePreloader();
  const lenis = useLenis();
  const lenisRef = useRef(lenis);
  lenisRef.current = lenis;
  const [autoplayDone, setAutoplayDone] = useState(() =>
    prefersReducedMotion(),
  );

  const sectionRef = useRef(null);
  const pinRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const titleRef = useRef(null);
  const descRef = useRef(null);

  const startedRef = useRef(false);
  const rafRef = useRef(null);
  const startTimeRef = useRef(0);
  const lastDrawnFrameRef = useRef(-1);

  const drawFrame = useCallback(
    (index) => {
      drawSequenceFrame(index, {
        canvasRef,
        ctxRef,
        sizeRef: canvasSizeRef,
        lastDrawnRef: lastDrawnFrameRef,
        loader: sequenceLoader,
      });
    },
    [sequenceLoader],
  );

  useEffect(() => {
    if (!sequenceLoader) return;
    drawFrame(0);
  }, [sequenceLoader, drawFrame]);

  // Read through refs by the reel effect below, which must depend on NOTHING
  // but `handoff` — see its own comment.
  const onAutoplayDoneRef = useRef(onAutoplayDone);
  onAutoplayDoneRef.current = onAutoplayDone;
  const drawFrameRef = useRef(drawFrame);
  drawFrameRef.current = drawFrame;

  // Play through the autoplay sequence once, starting on the preloader's
  // handoff cue.
  //
  // `handoff` is the ONLY dependency, deliberately. This effect is a
  // start-once guard (startedRef) paired with a cleanup that cancels the
  // in-flight rAF — so any dependency that changes identity mid-reel tears
  // the reel down and then hits the guard and refuses to restart it, leaving
  // the hero frozen on whatever frame it had reached. `onAutoplayDone` is
  // exactly that: an inline arrow from the page, new on every parent render.
  // Both it and `drawFrame` are read off refs instead.
  useEffect(() => {
    if (!handoff || startedRef.current) return undefined;
    startedRef.current = true;

    if (prefersReducedMotion()) {
      onAutoplayDoneRef.current?.();
      return undefined;
    }

    const tick = (timestamp) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsedSec = (timestamp - startTimeRef.current) / 1000;
      const frame = Math.min(
        AUTOPLAY_FRAME_COUNT - 1,
        Math.floor(elapsedSec * HOME_SEQ_FPS),
      );

      drawFrameRef.current(frame);

      if (frame < AUTOPLAY_FRAME_COUNT - 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAutoplayDone(true);
        onAutoplayDoneRef.current?.();
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [handoff]);

  // Title copy reveal — same phrase-cycle treatment as IntroHeroV2.
  useGSAP(
    () => {
      if (!handoff) return undefined;
      const titleEl = titleRef.current;
      const descEl = descRef.current;
      if (!titleEl) return undefined;

      // No word-level animation here — settle straight onto the final,
      // held copy (both the intro group and its rotating phrases are
      // hidden by default in CSS, so without this the title would just
      // stay blank).
      if (prefersReducedMotion()) {
        const introGroupEl = titleEl.querySelector(".intro-hero-v3__group");
        const finalGroupEl = titleEl.querySelector(".intro-hero-v3__final");
        titleEl.setAttribute("aria-label", TITLE_FINAL_LINES.join(" "));
        gsap.set(titleEl, { opacity: TITLE_OPACITY });
        // opacity-only (no autoAlpha/visibility toggle) — keeps the SVG
        // filter's raster surface warm on Safari, see .intro-hero-v3__group.
        if (introGroupEl) gsap.set(introGroupEl, { opacity: 0 });
        if (finalGroupEl) gsap.set(finalGroupEl, { opacity: 1 });
        return undefined;
      }

      const wordIn = { opacity: 1, y: 0, filter: "blur(0px)" };
      const wordOutHidden = {
        opacity: 0,
        y: 8,
        filter: "blur(19px)",
        force3D: true,
      };
      const wordOutTween = { opacity: 0, y: 8, filter: "blur(19px)" };

      let descSplit = null;
      let descTl = null;

      if (descEl) {
        descSplit = SplitText.create(descEl, {
          type: "words",
          wordsClass: "ih-word",
        });

        gsap.set(descSplit.words, {
          opacity: 0,
          y: 6,
          filter: "blur(12px)",
          force3D: true,
        });

        descTl = gsap.timeline({
          delay: COPY_REVEAL_DELAY_SEC + DESC_REVEAL_OFFSET_SEC,
        });
        descTl.to(
          descSplit.words,
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.8,
            stagger: 0.05,
            ease: "power2.out",
            onComplete: () =>
              gsap.set(descSplit.words, { clearProps: "filter,transform" }),
          },
          0,
        );
      }

      const introGroupEl = titleEl.querySelector(".intro-hero-v3__group");
      const staticEl = titleEl.querySelector(".intro-hero-v3__static");
      const finalGroupEl = titleEl.querySelector(".intro-hero-v3__final");
      const phraseEls = [...titleEl.querySelectorAll(".intro-hero-v3__phrase")];
      const splits = phraseEls.map((el) =>
        SplitText.create(el, {
          type: "words",
          wordsClass: "ih-word",
        }),
      );
      const staticSplit = staticEl
        ? SplitText.create(staticEl, { type: "words", wordsClass: "ih-word" })
        : null;
      const finalSplit = finalGroupEl
        ? SplitText.create(finalGroupEl, {
            type: "words",
            wordsClass: "ih-word",
          })
        : null;

      gsap.set(titleEl, { opacity: 0 });
      // opacity-only (no autoAlpha/visibility toggle) — see
      // .intro-hero-v3__group for why visibility:hidden defeats Safari's
      // filter warm-up.
      gsap.set(phraseEls, { opacity: 0 });
      splits.forEach((split) => gsap.set(split.words, wordOutHidden));
      if (staticSplit) gsap.set(staticSplit.words, wordOutHidden);
      if (finalGroupEl) gsap.set(finalGroupEl, { opacity: 0 });
      if (finalSplit) gsap.set(finalSplit.words, wordOutHidden);

      let titleTl = null;
      let cancelled = false;

      const playFinal = () => {
        if (cancelled || !finalGroupEl || !finalSplit?.words?.length) return;

        titleEl.setAttribute(
          "aria-label",
          `${TITLE_STATIC_LINE} ${TITLE_PHRASES[TITLE_PHRASES.length - 1]} ${TITLE_FINAL_LINES.join(" ")}`,
        );
        gsap.set(finalGroupEl, { opacity: 1 });

        titleTl = gsap.timeline();
        titleTl.to(finalSplit.words, {
          ...wordIn,
          duration: TITLE_IN_DURATION_SEC,
          stagger: Math.min(
            TITLE_IN_CHAR_STAGGER_SEC,
            TITLE_IN_STAGGER_MAX_SEC / Math.max(1, finalSplit.words.length),
          ),
          ease: "power2.out",
          onComplete: () =>
            gsap.set(finalSplit.words, { clearProps: "filter,transform" }),
        });
      };

      const playPhrase = (index) => {
        if (cancelled) return;
        const isLast = index === TITLE_PHRASES.length - 1;
        const phraseEl = phraseEls[index];
        const { words } = splits[index];
        if (!phraseEl || !words?.length) return;

        titleEl.setAttribute(
          "aria-label",
          `${TITLE_STATIC_LINE} ${TITLE_PHRASES[index]}`,
        );
        gsap.set(titleEl, { opacity: TITLE_OPACITY });
        gsap.set(phraseEl, { opacity: 1 });
        gsap.set(words, wordOutHidden);
        if (index === 0 && staticEl) gsap.set(staticEl, { opacity: 1 });

        const revealWords =
          index === 0 && staticSplit ? [...staticSplit.words, ...words] : words;

        titleTl = gsap.timeline({
          delay: index === 0 ? COPY_REVEAL_DELAY_SEC : 0,
        });
        titleTl.to(
          revealWords,
          {
            ...wordIn,
            duration: TITLE_IN_DURATION_SEC,
            stagger: Math.min(
              TITLE_IN_CHAR_STAGGER_SEC,
              TITLE_IN_STAGGER_MAX_SEC / Math.max(1, revealWords.length),
            ),
            ease: "power2.out",
          },
          0,
        );

        const outWords =
          isLast && staticSplit ? [...staticSplit.words, ...words] : words;

        titleTl
          .to(
            outWords,
            {
              ...wordOutTween,
              duration: TITLE_OUT_DURATION_SEC,
              stagger: { amount: TITLE_OUT_STAGGER_SEC },
              ease: "power2.in",
            },
            TITLE_EXIT_AT_SEC,
          )
          .call(() => {
            gsap.set(phraseEl, { opacity: 0 });
            if (isLast) {
              if (introGroupEl) gsap.set(introGroupEl, { opacity: 0 });
              playFinal();
            } else {
              playPhrase(index + 1);
            }
          });
      };

      playPhrase(0);

      return () => {
        cancelled = true;
        titleTl?.kill();
        splits.forEach((split) => split.revert());
        staticSplit?.revert();
        finalSplit?.revert();
        descTl?.kill();
        descSplit?.revert();
        gsap.set(titleEl, { clearProps: "opacity,filter" });
        gsap.set(phraseEls, { clearProps: "opacity" });
        if (staticEl) gsap.set(staticEl, { clearProps: "opacity" });
        if (introGroupEl) gsap.set(introGroupEl, { clearProps: "opacity" });
        if (finalGroupEl) gsap.set(finalGroupEl, { clearProps: "opacity" });
      };
    },
    { dependencies: [handoff], scope: pinRef },
  );

  // Freeze scroll through the autoplay reel so a wheel tick can't race the
  // rAF loop for the same canvas.
  useScrollLock(!autoplayDone);

  useEffect(() => {
    if (!autoplayDone) return undefined;
    const id = requestAnimationFrame(() => {
      lenis?.resize();
      ScrollTrigger.refresh();
    });
    return () => cancelAnimationFrame(id);
  }, [autoplayDone, lenis]);

  const autoplayDoneRef = useRef(autoplayDone);
  useEffect(() => {
    autoplayDoneRef.current = autoplayDone;
  }, [autoplayDone]);

  // --- Wet-glass droplets over the hero canvas ---
  // Picks up where PreloaderV2's own overlay left off (see its
  // `showStillRain`): that one samples the boot plate's still image, this one
  // samples the live sequence canvas, so the effect reads as continuous
  // across the hand-off instead of stopping when the boot screen leaves.
  const getRainSource = useCallback(() => canvasRef.current, []);
  const [rainActive, setRainActive] = useState(false);

  // Pause the overlay's rAF loops when the section is well out of view —
  // RainOverlay tears its raindrops/renderer down entirely while `active` is
  // false. The 50% bottom margin keeps it from thrashing right at the edge.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined")
      return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setRainActive(entry.isIntersecting),
      { rootMargin: "0px 0px 50% 0px", threshold: 0 },
    );
    observer.observe(section);

    return () => observer.disconnect();
  }, []);

  // --- Scroll-triggered second sequence (play at locked fps, never scrub) ---
  const lastDrawnScrollFrameRef = useRef(-1);
  const scrollLoaderRef = useRef(null);
  const scrollPlayRafRef = useRef(null);
  const playheadRef = useRef(0);
  // idle (autoplay still running) -> armed (waiting for the first down
  // scroll) -> playing -> resting (last frame held) -> playing (reverse) ->
  // armed. Playback itself never gates scroll; only the brief SCROLL_HOLD_MS
  // freeze at the start of a run does.
  const phaseRef = useRef("idle");
  const prevScrollYRef = useRef(0);
  const holdingLockRef = useRef(false);
  const lockTimerRef = useRef(null);
  // Set by the effect below; called from the capture-phase intent handler
  // and the useLenis fallback. A ref because it closes over
  // SCROLL_FRAME_COUNT-derived constants that only need to be computed once
  // per drawScrollFrame identity, not per input tick.
  const startScrollPlayRef = useRef(() => {});

  const drawScrollFrame = useCallback((index) => {
    drawSequenceFrame(index, {
      canvasRef,
      ctxRef,
      sizeRef: canvasSizeRef,
      lastDrawnRef: lastDrawnScrollFrameRef,
      loader: scrollLoaderRef.current,
    });
  }, []);

  useEffect(() => {
    const loader = createSequenceLoader({
      frameCount: SCROLL_FRAME_COUNT,
      getFramePath: getScrollFramePath,
    });
    scrollLoaderRef.current = loader;
    loader.preloadSequence();

    return () => {
      scrollLoaderRef.current = null;
    };
  }, []);

  // Arm the play-on-scroll machine once the autoplay reel has left the
  // canvas. Reduced motion jumps straight to the last scroll frame so
  // there's no locked playback beat to sit through at all.
  useEffect(() => {
    if (!autoplayDone) return;
    if (prefersReducedMotion()) {
      playheadRef.current = Math.max(0, SCROLL_FRAME_COUNT - 1);
      phaseRef.current = "resting";
      drawScrollFrame(playheadRef.current);
      return;
    }
    if (phaseRef.current === "idle") {
      playheadRef.current = 0;
      phaseRef.current = "armed";
      prevScrollYRef.current = getScrollY();
      drawScrollFrame(0);
    }
  }, [autoplayDone, drawScrollFrame]);

  // Builds the frame-advance loop and the brief SCROLL_HOLD_MS freeze, then
  // hands startPlay to startScrollPlayRef so the capture-phase listener /
  // Lenis fallback below can kick it off. Wall-clock playback — never reads
  // or writes scroll position (no scrollTo under the lock: that is what
  // hung Firefox last time).
  useEffect(() => {
    const lastFrame = Math.max(0, SCROLL_FRAME_COUNT - 1);
    const playBudgetMs = ((lastFrame + 1) / SCROLL_SEQ_FPS) * 1000 + 1000;

    const stopPlayLoop = () => {
      if (scrollPlayRafRef.current != null) {
        cancelAnimationFrame(scrollPlayRafRef.current);
        scrollPlayRafRef.current = null;
      }
    };

    const releaseHold = () => {
      if (lockTimerRef.current != null) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
      if (!holdingLockRef.current) return;
      holdingLockRef.current = false;
      releaseScrollLock(lenisRef.current);
    };

    const holdBriefly = () => {
      if (!holdingLockRef.current) {
        holdingLockRef.current = true;
        acquireScrollLock(lenisRef.current);
      }
      if (lockTimerRef.current != null) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        lockTimerRef.current = null;
        releaseHold();
      }, SCROLL_HOLD_MS);
    };

    startScrollPlayRef.current = (dir) => {
      if (phaseRef.current === "playing") return;
      if (SCROLL_FRAME_COUNT <= 1) {
        playheadRef.current = lastFrame;
        phaseRef.current = dir > 0 ? "resting" : "armed";
        drawScrollFrame(playheadRef.current);
        return;
      }

      stopPlayLoop();
      phaseRef.current = "playing";
      holdBriefly();

      const origin = playheadRef.current;
      let startTime = 0;

      const tick = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsedMs = timestamp - startTime;
        const advanced = Math.floor((elapsedMs / 1000) * SCROLL_SEQ_FPS);
        const frame = Math.max(0, Math.min(lastFrame, origin + dir * advanced));
        playheadRef.current = frame;
        drawScrollFrame(frame);

        const timedOut = elapsedMs > playBudgetMs;
        const done = timedOut || (dir > 0 ? frame >= lastFrame : frame <= 0);
        if (!done) {
          scrollPlayRafRef.current = requestAnimationFrame(tick);
          return;
        }

        scrollPlayRafRef.current = null;
        phaseRef.current = dir > 0 ? "resting" : "armed";
      };

      scrollPlayRafRef.current = requestAnimationFrame(tick);
    };

    // Instant reset to the un-scrolled start (armed, frame 0) — used when a
    // reverse hand-off from the carousel lands the page back on top of this
    // section (see HomeV3Page's use of `resetRef`). Deliberately a hard cut,
    // not a reverse playthrough: the page has already been teleported to the
    // top under CloudTransition's white-out, so the reel should be waiting
    // there too, not mid-reverse-play toward it.
    if (resetRef) {
      resetRef.current = () => {
        stopPlayLoop();
        releaseHold();
        playheadRef.current = 0;
        phaseRef.current = "armed";
        prevScrollYRef.current = getScrollY();
        drawScrollFrame(0);
      };
    }

    return () => {
      stopPlayLoop();
      releaseHold();
      startScrollPlayRef.current = () => {};
      if (resetRef) resetRef.current = null;
    };
  }, [drawScrollFrame, resetRef]);

  // Swallow the FIRST down/up that should start a run, before Lenis's
  // bubble-phase listener interpolates it into a 1.2s smooth scroll past
  // the CloudTransition line. After SCROLL_HOLD_MS the shared lock's own
  // capture block is gone, so further input is regular page scroll even
  // if the reel is still drawing.
  useEffect(() => {
    const triggerPx = () => (SEQUENCE_EXIT_VH / 100) * window.innerHeight;
    const inHeroWindow = () => getScrollY() < triggerPx() - 1;

    const swallow = (event) => {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleIntent = (dir, event) => {
      if (!autoplayDoneRef.current) return false;
      if (prefersReducedMotion()) return false;
      if (dir === 0) return false;
      if (overlayWipe.autoActive) return false;
      // Autoplay / CloudTransition already owns the page.
      if (isScrollLocked() && !holdingLockRef.current) return false;
      if (!inHeroWindow()) return false;

      if (phaseRef.current === "armed" && dir > 0) {
        swallow(event);
        startScrollPlayRef.current(1);
        return true;
      }
      if (phaseRef.current === "resting" && dir < 0) {
        swallow(event);
        startScrollPlayRef.current(-1);
        return true;
      }
      return false;
    };

    const onWheel = (event) => {
      const dir = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
      handleIntent(dir, event);
    };

    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      if (!SCROLL_KEYS.has(event.key)) return;
      let dir = KEY_DIRECTION[event.key] ?? 0;
      if ((event.key === " " || event.key === "Spacebar") && event.shiftKey) {
        dir = -1;
      } else if (
        event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        return;
      }
      handleIntent(dir, event);
    };

    let touchStartY = null;
    const onTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event) => {
      if (touchStartY == null) return;
      const y = event.touches?.[0]?.clientY;
      if (y == null) return;
      const delta = touchStartY - y;
      if (Math.abs(delta) < 12) return;
      handleIntent(delta > 0 ? 1 : -1, event);
    };
    const onTouchEnd = () => {
      touchStartY = null;
    };

    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: false,
    });

    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove, { capture: true });
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // Fallback if a scroll movement lands without our capture handler seeing
  // the originating event (scrollbar drag, Lenis programmatic). Starts the
  // same run; holdBriefly then lenis.stop()s whatever interpolation is
  // already in flight. Never force-scrolls.
  useLenis(() => {
    if (!autoplayDoneRef.current) return;
    if (prefersReducedMotion()) return;

    const y = getScrollY();
    const prevY = prevScrollYRef.current;
    prevScrollYRef.current = y;
    if (y === prevY) return;

    if (overlayWipe.autoActive) return;
    if (isScrollLocked() && !holdingLockRef.current) return;

    const trigger = (SEQUENCE_EXIT_VH / 100) * window.innerHeight;
    if (y >= trigger - 1) return;

    if (phaseRef.current === "armed" && y > prevY) {
      startScrollPlayRef.current(1);
      return;
    }

    if (phaseRef.current === "resting" && y < prevY) {
      const rect = sectionRef.current?.getBoundingClientRect();
      if (rect && rect.bottom > 0) startScrollPlayRef.current(-1);
    }
  });

  useEffect(() => {
    const handleResize = () => {
      canvasSizeRef.current = { width: 0, height: 0 };
      const usingScroll = lastDrawnScrollFrameRef.current >= 0;
      const frame = Math.max(
        0,
        usingScroll
          ? lastDrawnScrollFrameRef.current
          : lastDrawnFrameRef.current,
      );
      lastDrawnFrameRef.current = -1;
      lastDrawnScrollFrameRef.current = -1;
      if (usingScroll) {
        drawScrollFrame(frame);
      } else {
        drawFrame(frame);
      }
    };
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [drawFrame, drawScrollFrame]);

  return (
    <section
      ref={sectionRef}
      className="intro-hero-v3 relative z-[2] w-full"
      style={{
        height: `calc(100dvh + ${SEQUENCE_EXIT_VH}dvh + ${HANDOFF_HOLD_VH}dvh)`,
      }}
    >
      <svg aria-hidden="true" focusable="false" className="absolute w-0 h-0">
        <defs>
          <filter
            id="intro-hero-v2-title-filter"
            x="-20%"
            y="-40%"
            width="140%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.3974133432"
              numOctaves="3"
              seed="5708"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="9.15"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displacedImage"
            />
            <feGaussianBlur
              in="displacedImage"
              stdDeviation="0.5718799233436584"
            />
          </filter>
          <filter
            id="intro-hero-v2-desc-filter"
            x="-20%"
            y="-40%"
            width="140%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.3974133432"
              numOctaves="3"
              seed="5708"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="2.15"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displacedImage"
            />
            <feGaussianBlur
              in="displacedImage"
              stdDeviation="0.5718799233436584"
            />
          </filter>
        </defs>
      </svg>
      <div
        ref={pinRef}
        className="intro-hero-v3__pin relative w-full h-dvh overflow-hidden sticky top-0 bg-black"
      >
        <canvas
          ref={canvasRef}
          className="intro-hero-v3__canvas absolute inset-0 z-0 w-full h-full block"
        />
        {/* Held until `handoff`: RainOverlay polls for a sampleable source
            for a few seconds and then gives up, and this canvas has no
            pixels (nor even a backing size — setupCanvas runs on the first
            draw) until the reel starts on that same cue. */}
        {/* No z-index here (nor on .app-container / the row below): any of
            them creating its own stacking context would cap the h1's
            `mix-blend-overlay` backdrop at that boundary, so it can no
            longer "see" the canvas past it and the blend silently no-ops.
            Position + DOM order alone (canvas, this, then app-container)
            already paints these in the right order without a new context. */}
        <RainOverlay
          getVideo={getRainSource}
          active={handoff && rainActive}
          className="intro-hero-v3__droplets absolute inset-0 w-full h-full pointer-events-none"
        />
        <div className="app-container relative">
          <div className="flex flex-col md:flex-row justify-end md:justify-between w-full pb-[calc(32px+env(safe-area-inset-bottom,0px))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] h-dvh relative items-center md:items-end gap-16 md:gap-0">
            <h1
              ref={titleRef}
              className="intro-hero-v3__title mix-blend-overlay md:flex-auto max-w-[300px] md:max-w-full m-0 [font-family:var(--font-title)] text-[4rem] md:text-[clamp(2.75rem,7.63vw,6.86rem)] font-semibold leading-none tracking-tighter uppercase break-words text-white"
              aria-label={`${TITLE_STATIC_LINE} ${TITLE_PHRASES[TITLE_PHRASES.length - 1]} ${TITLE_FINAL_LINES.join(" ")}`}
            >
              <div className="intro-hero-v3__group flex flex-col">
                <span
                  className="intro-hero-v3__static block text-center md:text-left"
                  aria-hidden="true"
                >
                  {TITLE_STATIC_LINE}
                </span>
                <span className="intro-hero-v3__rotating block text-center md:text-left">
                  {TITLE_PHRASES.map((phrase) => (
                    <span
                      key={phrase}
                      className="intro-hero-v3__phrase"
                      aria-hidden="true"
                    >
                      {phrase === "the lather embrace you." ? (
                        <>
                          the lather
                          <br className="md:hidden" /> embrace you.
                        </>
                      ) : (
                        phrase
                      )}
                    </span>
                  ))}
                </span>
              </div>
              <div
                className="intro-hero-v3__final flex flex-col intro-hero-v3__group content-start text-center md:text-left w-full md:w-auto"
                aria-hidden="true"
              >
                {TITLE_FINAL_LINES.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </div>
            </h1>
            {/* Mobile-only "scroll down" label — HeroScrollCue's wheel
                affordance hides itself below 640px, this replaces it there.
                Stacked in-flow below the title (rather than absolutely
                positioned) so it always clears the title's actual rendered
                height instead of a fixed offset that the title's variable
                line count (2-4 lines depending on wrap) can collide with.
                A sibling of the h1, not a child: `mix-blend-overlay` lives on
                the h1 (not this container) precisely so this white cue paints
                unblended over the hero's dark lower half. */}
            <div
              className="intro-hero-v3__scroll-down items-center justify-center gap-[11px] text-white pointer-events-none"
              aria-hidden="true"
            >
              <img
                src={iconScrollChevron}
                alt=""
                className="intro-hero-v3__scroll-down-icon block w-[12px] h-[13px]"
              />
              <span className="font-semibold opacity-60 text-[16px] leading-none tracking-[1.12px] uppercase">
                swipe down
              </span>
            </div>
          </div>
        </div>
        {/* Scroll cue for the hero, living in the pin's own overlay rather
            than at page level: the pin is what carries it off screen, so it
            needs no scroll-bounded hide of its own to keep off the sections
            below. A sibling of the title block above rather than a child of
            it — the title carries `mix-blend-overlay`, and blend mode applies
            to the whole group, so a white cue inside it would blend away
            against the hero's dark lower half. */}
        <HeroScrollCue variant="right" />
      </div>
    </section>
  );
}
