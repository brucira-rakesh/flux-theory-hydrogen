import { useLayoutEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import AnimatedTitle from "../AnimatedTitle/AnimatedTitle";
import { getScrollRoot } from "../../utils/scrollRoot";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { prefersReducedMotion } from "../../hooks/useSpotlight";
import heroBgSrc from "../../assets/ranbir/bg-v3-hero.webp";
import heroBgVideoSrc from "../../assets/ranbir/ranbir-flux.mp4";
import "./VideoHeroV3.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * VideoHeroV3 — Figma node 2810-2736, used by HomeV3Page right before
 * FooterV3.
 *
 * Sibling of VideoHeroV2, not a variant of it: that one stages two swapping
 * captions across a 300vh scrub. This frame only ever shows one static
 * caption, so there's no swap state machine or AnimatedTitle phrase-cycle
 * here — just the same sticky-video shell, trimmed down.
 *
 * The caption is `position: fixed`, dead-center in the viewport, for this
 * section's entire `.vh3-wrap` — not `position: sticky`. An independent
 * sticky layer (an earlier version of this) was tried so the caption could
 * hold center for longer than the video panel's own `sticky` stretch, but a
 * sticky element's "am I stuck yet" threshold is computed off its own box,
 * and that computation turned out too fragile to hold a fixed screen-center
 * position reliably (drifted with scroll instead of pinning). `fixed` has
 * no such threshold to get wrong — it's centered on the viewport, full stop,
 * for as long as it's allowed to paint at all.
 *
 * "As long as it's allowed to paint" is doing the work `sticky`'s release
 * used to: `.vh3-wrap` clips with `clip-path: inset(0)` (chosen over
 * `overflow: hidden` because `clip-path` never turns an element into a
 * scroll container, so it can't perturb `.vh3-sticky`'s own sticky math the
 * way `overflow: hidden` here once did). `.vh3-wrap` has `position: relative`
 * plus a `z-index`, which establishes a stacking context — so the fixed
 * caption, despite being positioned relative to the viewport, still paints
 * within that stacking context and gets clipped by it. The caption is only
 * ever painted for the stretch of scroll where the wrap's own (scrolling)
 * box still overlaps the viewport's vertical center: invisible before the
 * wrap scrolls that far up (reveal), dead-center once it does.
 *
 * Reveal and hold both come from the clip alone, but the tail end doesn't —
 * a straight clip-off there just cuts the caption away mid-screen, which
 * reads as it vanishing rather than leaving. Instead, once the wrap's
 * bottom edge scrolls up to where the clip would start eating the caption,
 * a scroll listener hands the caption off from `fixed` (centered on the
 * viewport) to `absolute` pinned to the very bottom of `.vh3-wrap` (which is
 * `position: relative`, so that's a real anchor, not a guess). The handoff
 * math (see the effect below) lands the box in the exact same screen
 * position either way, so the swap itself is invisible — from the caption's
 * own motion alone you can't tell it happened. From that point on it's
 * ordinary flow content bound to the wrap's box, so it rides up and off
 * screen together with the rest of the section exactly the way `.vh3-sticky`
 * already does when IT releases — same exit, just handed to a different
 * element. Scrolling back down past the handoff point reverses it the same
 * way, back to centered `fixed`, so it isn't a one-way latch.
 *
 * HomeV3Page composes this with FooterV3 using the same sticky-reveal
 * wrapper HomeV2Page already uses for VideoHeroV2 + Footer: this section
 * scrolls in normal flow while its own inner panel stays pinned, then
 * releases and the footer (pulled up underneath, `sticky top-0`) holds in
 * its place — which is what reads as the video "clipping" against the
 * footer as you keep scrolling.
 */
const CAPTION_LEFT_CHARS = 7; // "EMBRACE"
const CAPTION_RIGHT_CHARS = 8; // "YOUR" + "FLUX" (space isn't a char)
const CAPTION_WAVE_CHARS = CAPTION_LEFT_CHARS + CAPTION_RIGHT_CHARS;

export default function VideoHeroV3() {
  const wrapRef = useRef(null);
  const stickyRef = useRef(null);
  const bgRef = useRef(null);
  const captionRef = useRef(null);
  const captionLeftRef = useRef(null);
  const captionRightRef = useRef(null);
  const isDesktop = useIsDesktop();

  // Shared blur wave so "EMBRACE" and "YOUR FLUX" read as one continuous
  // title, letter-by-letter — mirrors VideoHeroV2's bottom caption treatment
  // instead of any travel/slide motion.
  const captionBlurLeft = useMemo(
    () => ({
      charOffset: 0,
      waveLength: CAPTION_WAVE_CHARS,
      loop: 1.5,
      entrySpan: {
        delay: 0,
        duration: 0.8,
        stagger: 0.02,
        chars: CAPTION_LEFT_CHARS,
      },
    }),
    [],
  );
  const captionBlurRight = useMemo(
    () => ({
      charOffset: CAPTION_LEFT_CHARS,
      waveLength: CAPTION_WAVE_CHARS,
      loop: 1.5,
      entrySpan: {
        delay: 0.08,
        duration: 0.8,
        stagger: 0.02,
        chars: CAPTION_LEFT_CHARS,
      },
    }),
    [],
  );

  // Hands the caption from `fixed` (viewport-centered) to `absolute`
  // (pinned to `.vh3-wrap`'s bottom edge) at the instant the clip would
  // otherwise start eating it — see the component comment for why. Direct
  // style writes on a plain DOM read, not React state: this has to run every
  // scroll tick, and re-rendering React for that would be needless work (and
  // a frame of lag) for something that never touches the render tree.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const caption = captionRef.current;
    if (!wrap || !caption) return undefined;

    let stuck = null;
    let ticking = false;

    const apply = () => {
      ticking = false;
      const wrapRect = wrap.getBoundingClientRect();
      const captionHalf = caption.offsetHeight / 2;
      const threshold = window.innerHeight / 2 + captionHalf;
      const shouldStick = wrapRect.bottom <= threshold;
      if (shouldStick === stuck) return;
      stuck = shouldStick;
      if (stuck) {
        caption.style.position = "absolute";
        caption.style.top = "auto";
        caption.style.bottom = "0";
        caption.style.transform = "none";
      } else {
        caption.style.position = "fixed";
        caption.style.top = "50%";
        caption.style.bottom = "auto";
        caption.style.transform = "translateY(-50%)";
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    };

    apply();
    const scroller = getScrollRoot() ?? window;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Parallax entrance: the background media starts offset -20% up and
  // scrubs down to its resting position (translateY 0) as `.vh3-wrap`
  // travels from just below the viewport to flush with its top — the same
  // span `.vh3-sticky` covers before it pins, so the media is already at
  // rest the instant the panel locks in place. Re-bound on `isDesktop`
  // since the video/img swap to a different DOM node at that breakpoint.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const wrap = wrapRef.current;
    const bg = bgRef.current;
    if (!wrap || !bg) return undefined;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        bg,
        { yPercent: -20 },
        {
          yPercent: 0,
          ease: "none",
          scrollTrigger: {
            trigger: wrap,
            start: "top bottom",
            end: "top top",
            scroller: getScrollRoot() ?? undefined,
            scrub: true,
            // markers: true,
          },
        },
      );
    }, wrap);

    return () => ctx.revert();
  }, [isDesktop]);

  // Mobile-only: "EMBRACE" and "YOUR FLUX" start centered (stacked, see the
  // CSS media query) and, once, nudge apart horizontally in opposite
  // directions — top word 15% left, bottom word 15% right — as `.vh3-wrap`'s
  // top edge crosses 80% of the viewport. Plays once and stays put: no
  // scrub, no reverse on scroll-back. Desktop keeps the static side-by-side
  // split above, so this is skipped entirely there.
  useLayoutEffect(() => {
    if (isDesktop) return undefined;
    const wrap = wrapRef.current;
    const left = captionLeftRef.current;
    const right = captionRightRef.current;
    if (!wrap || !left || !right) return undefined;

    const ctx = gsap.context(() => {
      gsap.set([left, right], { xPercent: 0 });

      gsap
        .timeline({
          scrollTrigger: {
            trigger: wrap,
            start: "30% 80%",
            scroller: getScrollRoot() ?? undefined,
            once: true,
            // markers: true,
          },
        })
        .to(left, { xPercent: -15, duration: 0.8, ease: "power2.out" }, 0)
        .to(right, { xPercent: 15, duration: 0.8, ease: "power2.out" }, 0);
    }, wrap);

    return () => ctx.revert();
  }, [isDesktop]);

  return (
    <div
      ref={wrapRef}
      className="vh3-wrap relative w-full h-[100vh] md:h-[150vh] z-[21] [clip-path:inset(0)] motion-reduce:h-svh"
    >
      {/* z-[21], not the usual z-[1] (see VideoHeroV2's own note) — this
          section is pulled up under SceneV2's tail (see HomeV3Page's
          negative-margin/CloudTransition hand-off convention), and
          `.scene-v2` sits at z-index:20 (Scene.v2.css) so later sections
          painted over it in HomeV2Page. Here VideoHeroV3 IS the later
          section: while CloudTransition's wipe is mid-flight (or misses a
          frame on a hard flick) both panels are briefly on screen at once,
          and without outranking 20 the still-visible tail of the outgoing
          carousel would paint over this incoming panel instead of the
          other way around.
          No isolation:isolate — FooterV3 needs to paint over this sticky
          panel as it scrolls up from below (see VideoHeroV2's own note). */}
      <div
        ref={stickyRef}
        className="vh3-sticky sticky top-0 w-full h-svh overflow-hidden bg-[#0d1b24] motion-reduce:static"
      >
        {isDesktop ? (
          <video
            ref={bgRef}
            className="vh3-video absolute inset-0 w-full h-full object-cover z-0"
            src={heroBgVideoSrc}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
          />
        ) : (
          <img
            ref={bgRef}
            className="vh3-video absolute inset-0 w-full h-full object-cover z-0"
            src={heroBgSrc}
            alt=""
            aria-hidden="true"
          />
        )}

        <div
          className="vh3-overlay absolute inset-0 z-[1] pointer-events-none"
          aria-hidden="true"
        />
      </div>

      {/* Sibling of `.vh3-sticky`, not nested inside it — see the component
          comment above for why. `pointer-events-none` since it paints over
          the video (and, right at the clip boundary, can graze FooterV3).
          `mix-blend-exclusion` inverts against whatever's directly under it
          (video, overlay, footer during the tail) instead of sitting as
          flat white — reads as "burned into" the section rather than laid
          over it. The `scrollTrigger` on each word ties AnimatedTitle's
          char-by-char blur-in to `.vh3-wrap` itself (not the caption's own
          box, whose position/visibility swap this quarter shouldn't also
          have to drive a reveal), timed to roughly when the clip in the
          component comment above first lets the caption paint at all. */}
      <div
        ref={captionRef}
        className="vh3-caption fixed inset-x-0 top-1/2 z-[2] flex justify-between items-center px-[clamp(16px,4vw,56px)] pb-8 pointer-events-none mix-blend-exclusion"
      >
        <span ref={captionLeftRef} className="vh3-word-slide">
          <AnimatedTitle
            as="span"
            className="vh3-word font-bold text-[clamp(32px,14vw,56px)] lg:font-semibold lg:text-[clamp(28px,6.5vw,96px)]"
            scrollTrigger={{ trigger: wrapRef, start: "top 50%" }}
            blurSweep={captionBlurLeft}
          >
            EMBRACE
          </AnimatedTitle>
        </span>
        <span ref={captionRightRef} className="vh3-word-slide">
          <AnimatedTitle
            as="span"
            className="vh3-word font-bold text-[clamp(32px,14vw,56px)] lg:font-semibold lg:text-[clamp(28px,6.5vw,96px)]"
            delay={0.08}
            scrollTrigger={{ trigger: wrapRef, start: "top 50%" }}
            blurSweep={captionBlurRight}
          >
            YOUR FLUX
          </AnimatedTitle>
        </span>
      </div>
    </div>
  );
}
