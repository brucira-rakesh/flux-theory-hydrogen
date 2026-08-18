import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useLenis } from "lenis/react";
import { usePreloader } from "../Preloader/PreloaderContext";
import { prefersReducedMotion } from "../../hooks/useSpotlight";
import { useScrollLock } from "../../hooks/useScrollLock";
import RainOverlay from "../RainEffect/RainOverlay";
import { setupCanvas } from "../../utils/frameSequence";
import { createSequenceLoader } from "../../utils/sequenceLoader";
import {
  AUTOPLAY_FRAME_COUNT,
  HOME_SEQ_FPS,
  SCROLL_FRAME_COUNT,
  getScrollFramePath,
} from "../../data/homeSeq";
import "./IntroHeroV2.css";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/** Seconds before the autoplay reel finishes that the title/desc reveal
 *  should start — so the copy is already arriving as the last frames land.
 *  Exported so other components (HomeV2Page's header) can time their own
 *  reveal to land alongside this one instead of firing on raw `handoff`. */
const COPY_REVEAL_LEAD_SEC = 1.1;
const AUTOPLAY_DURATION_SEC = AUTOPLAY_FRAME_COUNT / HOME_SEQ_FPS;
export const COPY_REVEAL_DELAY_SEC = Math.max(
  0,
  AUTOPLAY_DURATION_SEC - COPY_REVEAL_LEAD_SEC,
);
/** The <h1>'s permanent (non-animated) filter — see IntroHeroV2.css. */
const TITLE_BASE_FILTER = "url(#intro-hero-v2-title-filter)";
/** The <p>'s own copy of the same filter, so its blur amount/timing can
 *  differ from the title's without them fighting over one shared node. */
const DESC_BASE_FILTER = "url(#intro-hero-v2-desc-filter)";

/** Full-bleed cover-fit draw — the hero canvas fills the viewport, no letterboxing. */
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

/**
 * Draws a sequence frame into a canvas, resizing the drawing buffer only
 * when the CSS size actually changed. Shared by the autoplay and
 * scroll-scrub draws below — both target the SAME canvas element, just
 * different frame sequences/loaders at different points in the timeline.
 */
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

/**
 * IntroHeroV2 — a 150dvh section whose top 100dvh (the canvas + droplet
 * overlay) is pinned in place via ScrollTrigger for the remaining 25dvh of
 * scroll. The SAME canvas plays two sequences back to back:
 *   1. the autoplay hero reel, time-driven, starting on the preloader's
 *      handoff cue (PreloaderContext's `handoff` flag);
 *   2. the scroll sequence, scrubbed to native scroll position across the
 *      pin's 25dvh of scroll room — finishing exactly when the pin releases.
 */
export default function IntroHeroV2({ onAutoplayDone } = {}) {
  const { handoff, sequenceLoader } = usePreloader();
  const lenis = useLenis();
  // Starts already "done" under reduced motion: there's no reel to play there
  // (PreloaderV2 hands off immediately and provides no sequenceLoader), so the
  // scroll lock below must not sit on the page for the reel's nominal duration.
  const [autoplayDone, setAutoplayDone] = useState(() => prefersReducedMotion());
  const [rainActive, setRainActive] = useState(true);

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

  // The loader (and its already-decoded frames) comes from PreloaderContext
  // — this is the SAME instance PreloaderV2 preloaded before handing off, so
  // there's no second fetch/decode pass fighting it for the main thread.
  // Paint whatever's loaded as soon as the loader shows up.
  useEffect(() => {
    if (!sequenceLoader) return;
    drawFrame(0);
  }, [sequenceLoader, drawFrame]);

  // Play through the autoplay sequence once, starting on the preloader's handoff cue.
  useEffect(() => {
    if (!handoff || startedRef.current) return undefined;
    startedRef.current = true;

    // No reel under reduced motion — report the reel as finished right away so
    // whatever is gated on it (scroll lock, SceneV2's PostFX) isn't held back.
    if (prefersReducedMotion()) {
      onAutoplayDone?.();
      return undefined;
    }

    const tick = (timestamp) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsedSec = (timestamp - startTimeRef.current) / 1000;
      const frame = Math.min(
        AUTOPLAY_FRAME_COUNT - 1,
        Math.floor(elapsedSec * HOME_SEQ_FPS),
      );

      drawFrame(frame);

      if (frame < AUTOPLAY_FRAME_COUNT - 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAutoplayDone(true);
        onAutoplayDone?.();
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [handoff, drawFrame, onAutoplayDone]);

  // Reveal the title/desc with a fade + blur, char/word stagger — timed via
  // `delay` so it starts just before the autoplay reel above finishes
  // (COPY_REVEAL_DELAY_SEC), rather than waiting for it to fully complete.
  useGSAP(
    () => {
      if (!handoff || prefersReducedMotion()) return undefined;
      const titleEl = titleRef.current;
      const descEl = descRef.current;
      if (!titleEl || !descEl) return undefined;

      const titleSplit = SplitText.create(titleEl, {
        type: "chars",
        charsClass: "ih-char",
      });
      const descSplit = SplitText.create(descEl, {
        type: "words",
        wordsClass: "ih-word",
      });

      // Neither the title's chars nor the desc's words may get their own
      // `filter` — any non-"none" filter forces a span onto its own
      // compositing layer, which cuts it out of the shared
      // background-clip/mix-blend-mode gradient fill on the <h1> (and would
      // otherwise fragment the <p>'s SVG-filter text effect the same way).
      // So chars/words stagger in on opacity/y only, and the "blur" half of
      // the reveal is a single tween on each element itself — both already
      // own the SVG noise/displace filter, so adding a blur() term is safe;
      // TITLE_BASE_FILTER/DESC_BASE_FILTER preserve each element's own filter.
      gsap.set(titleEl, { filter: `${TITLE_BASE_FILTER} blur(19px)` });
      gsap.set(descEl, { filter: `${DESC_BASE_FILTER} blur(1px)` });
      gsap.set(titleSplit.chars, { opacity: 0, y: 14 });
      gsap.set(descSplit.words, { opacity: 0, y: 14 });

      const tl = gsap.timeline({ delay: COPY_REVEAL_DELAY_SEC });
      tl.to(
        titleEl,
        {
          filter: `${TITLE_BASE_FILTER} blur(0px)`,
          duration: 1,
          ease: "power2.out",
          onComplete: () => gsap.set(titleEl, { clearProps: "filter" }),
        },
        0,
      )
        .to(
          titleSplit.chars,
          {
            opacity: 1,
            y: 0,
            duration: 1,
            stagger: 0.03,
            ease: "power2.out",
          },
          0,
        )
        .to(
          descEl,
          {
            filter: `${DESC_BASE_FILTER} blur(0px)`,
            duration: 0.8,
            ease: "power2.out",
            onComplete: () => gsap.set(descEl, { clearProps: "filter" }),
          },
          "<0.25",
        )
        .to(
          descSplit.words,
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.05,
            ease: "power2.out",
          },
          "<",
        );

      return () => {
        tl.kill();
        titleSplit.revert();
        descSplit.revert();
      };
    },
    { dependencies: [handoff], scope: pinRef },
  );

  // Hold scroll frozen from mount through the loader boot AND the autoplay reel
  // — a wheel/touch/keyboard tick during either would nudge the pinned
  // ScrollTrigger's progress, so the scroll-scrub draw below starts racing the
  // autoplay rAF loop for the same canvas. The window this holds for is a
  // superset of the preloader's own lock; useScrollLock is ref-counted, so the
  // overlay clearing partway through doesn't release it early.
  useScrollLock(!autoplayDone);

  // Nothing could scroll while the lock was up, so ScrollTrigger has been
  // sitting on measurements taken against a non-scrollable document (and pages
  // this heavy keep growing during the boot as sequences/canvases settle).
  // Re-measure once, at the moment scroll actually becomes possible, so the pin
  // below starts scrubbing from correct start/end offsets rather than whatever
  // the page looked like at mount.
  useEffect(() => {
    if (!autoplayDone) return undefined;
    const id = requestAnimationFrame(() => {
      lenis?.resize();
      ScrollTrigger.refresh();
    });
    return () => cancelAnimationFrame(id);
  }, [autoplayDone, lenis]);

  const getCanvasSource = useCallback(() => canvasRef.current, []);

  // ScrollTrigger's onUpdate closure is created once at mount (see effect
  // below with empty-ish deps), so it can't see later `autoplayDone` state
  // updates directly — mirror it into a ref it can read live.
  const autoplayDoneRef = useRef(autoplayDone);
  useEffect(() => {
    autoplayDoneRef.current = autoplayDone;
  }, [autoplayDone]);

  // Pause the rain overlay's own rAF loops when the section is well out of
  // view — RainOverlay tears down its raindrops/renderer entirely while
  // `active` is false. rootMargin adds a 50vh buffer below the viewport so
  // it doesn't thrash on/off right at the edge, and stays running slightly
  // past the fold instead of cutting out the instant it clips.
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

  // --- Scroll-scrubbed second sequence (hero-scroll-sequence.mp4 frames) ---
  // Own loader — these frames aren't part of PreloaderV2's `sequence` prop
  // (only the autoplay reel gates the boot), so this is the only place
  // they're fetched/decoded.
  const lastDrawnScrollFrameRef = useRef(-1);
  const scrollLoaderRef = useRef(null);

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

  // Pin the top 100dvh (canvas + droplets) for the section's remaining
  // 25dvh of scroll room, scrubbing scroll-sequence frames onto it across
  // that distance — the pin releases exactly as the sequence finishes.
  useEffect(() => {
    const section = sectionRef.current;
    const pinEl = pinRef.current;
    if (!section || !pinEl) return undefined;

    const st = ScrollTrigger.create({
      trigger: section,
      start: "top top",
      end: "bottom bottom",
      pin: pinEl,
      // The section's own 150dvh height already reserves the scroll room —
      // don't let ScrollTrigger insert a second spacer on top of it.
      pinSpacing: false,
      scrub: true,
      onUpdate: (self) => {
        // Ignore scroll-driven frames until the autoplay reel has finished —
        // otherwise a scroll tick during autoplay races the autoplay rAF
        // loop for the same canvas and the two sequences paint over each
        // other.
        if (!autoplayDoneRef.current) return;
        const frame = Math.round(self.progress * (SCROLL_FRAME_COUNT - 1));
        drawScrollFrame(frame);
      },
    });

    return () => {
      st.kill();
    };
  }, [drawScrollFrame]);

  // Re-draw the current frame on resize so the cover-fit stays correct —
  // whichever sequence last drew wins (autoplay before scroll takes over).
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
      className="intro-hero-v2 relative w-full h-[150dvh] bg-black"
    >
      {/* isolate — blend group root: without it, the title's mix-blend-mode
          doesn't reliably blend against the canvas/droplets below once the
          z-indexed copy wrapper sits between them. */}
      <div
        ref={pinRef}
        className="intro-hero-v2__pin relative w-full h-dvh overflow-hidden bg-black isolate"
        aria-hidden="true"
      >
        <canvas
          ref={canvasRef}
          className="intro-hero-v2__canvas absolute inset-0 z-0 w-full h-full block"
        />
        <RainOverlay
          getVideo={getCanvasSource}
          active={rainActive}
          className="intro-hero-v2__droplets absolute inset-0 z-1 w-full h-full pointer-events-none"
        />
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
        <div className="app-container">
          <div className="flex justify-between w-full pb-6 h-screen z-1 relative items-end mix-blend-overlay">
            <h1
              ref={titleRef}
              className="intro-hero-v2__title flex-auto max-w-[min(724px,50vw)] m-0 [font-family:var(--font-title)] text-[clamp(2.75rem,7.63vw,6.86rem)] font-semibold leading-none tracking-tighter uppercase break-words text-white"
            >
              This is where it all begins.
            </h1>
            <p
              ref={descRef}
              className="intro-hero-v2__desc isolate flex-initial w-[min(243px,17vw)] m-0 [font-family:var(--font-body)] text-[clamp(0.875rem,1.25vw,1.125rem)] font-medium leading-[normal] text-right text-white"
            >
              Every situation reveals a different side of you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
