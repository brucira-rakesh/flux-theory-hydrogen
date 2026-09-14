import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { ReactLenis, useLenis } from 'lenis/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { PreloaderV2 } from '../components/Preloader/Preloader.v2';
import IntroHeroV3, {
  HANDOFF_HOLD_VH,
} from '../components/IntroHero/IntroHeroV3';
import { AUTOPLAY_FRAME_COUNT, getAutoplayFramePath } from '../data/homeSeq';
import CloudTransition from '../CloudTransition';
import HeaderV2 from '../components/Header/HeaderV2';
import FooterV3 from '../components/Footer/FooterV3';
import VideoHeroV3 from '../components/VideoHero/VideoHeroV3';
import ProductV3 from '../components/ProductV3/ProductV3';
import Scenev2mweb from '../scenes-v2/mobile/Scenev2mweb';
import { useDebugGui } from '../scenes-v2/useDebugGui';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { isDesktopViewport } from '../utils/breakpoint';
import {
  SCROLL_ROOT_SELECTOR,
  scrollRootTo,
  setElementScrollRoot,
} from '../utils/scrollRoot';

// Desktop-only carousel — keep Three/R3F out of the mobile HomeV3 chunk.
const SceneV2 = lazy(() => import('../Scene.v2'));

gsap.registerPlugin(ScrollTrigger, useGSAP);

// See HomeV2Page for why this is decided once at module load rather than
// reactively — flipping it later would have to tear down the Lenis instance
// and every ScrollTrigger on the page mid-scroll.
const USE_ELEMENT_SCROLLER = !isDesktopViewport();

// Scroll room between the carousel's LAST scene and the closing cloud wipe's
// trigger line, in vh.
//
// Without it the two coincide exactly: the wipe arms one viewport above its
// boundary marker, the marker sits HANDOFF_HOLD_VH above the end of the
// carousel section, and the section reserves STICKY_RELEASE_VH (100vh) past
// its last step — so `trailingHoldVh` of HANDOFF_HOLD_VH put the trigger line
// precisely on the last step's resting scroll position, and simply ARRIVING
// at the last scene played the transition. Paid for by lengthening the
// section (the marker is placed from its bottom, so the extra room pushes the
// marker, and with it the trigger, that much further down): reaching the last
// scene now rests there, and one more forward scroll is what crosses into the
// wipe.
const LAST_SCENE_EXIT_VH = 40;

// CloudTransition defaults are 800/800, tuned for Seawave's already-near-
// white pin. Every HomeV3 seam plays a full 0→1 gather (skipInCover below),
// so those freeze the page for 1.6s before the next section drops in.
// CloudTransition also teleports the moment the gather is opaque enough
// to hide the seam, so the IN leg often finishes even sooner than this.
const CLOUD_WIPE_IN_MS = 280;
const CLOUD_WIPE_OUT_MS = 360;

// Module-level so PreloaderV2's preload effect doesn't re-run on every render.
//
// `readyCount` is the boot gate, not the full reel: the overlay used to wait
// on all 46 frames (~5MB) before the reveal tween even started. Half the
// sequence is enough for autoplay to begin on handoff; the rest keeps
// loading on the same SequenceLoader during the reveal / first second of
// playback (drawSequenceFrame already no-ops missing frames).
const introSequence = {
  frameCount: AUTOPLAY_FRAME_COUNT,
  getFramePath: getAutoplayFramePath,
  readyCount: Math.ceil(AUTOPLAY_FRAME_COUNT / 2),
};

export const HomeV3Page = ({productCards} = {}) => {
  const rootRef = useRef(null);
  const lenisRef = useRef(null);
  // Zero-height markers at the seams CloudTransition wipes across — one
  // between the hero and the carousel, one between the carousel and the
  // closing panel.
  const heroToCarouselRef = useRef(null);
  const carouselToEndRef = useRef(null);
  // Imperative reset handle for IntroHeroV3's own scroll-sequence playhead —
  // see the CloudTransition usage below. Reversing out of the carousel
  // should land back on the hero's own untouched start (top of page, frame
  // 0), not wherever its last-held frame was when the user first left it.
  const introResetRef = useRef(null);
  const gui = useDebugGui('Home V3 Tweaks');
  // SceneV2's carousel is desktop-only — mobile uses Scenev2mweb's
  // swipe-controlled frame sequence instead (see the render below). Reactive, unlike
  // USE_ELEMENT_SCROLLER above, so it also gates SceneV2 mounting its WebGL
  // context on a resize across the breakpoint (see useIsDesktop's docstring).
  const isDesktop = useIsDesktop();

  if (USE_ELEMENT_SCROLLER) {
    setElementScrollRoot(true);
    ScrollTrigger.defaults({ scroller: SCROLL_ROOT_SELECTOR });
  }

  useLayoutEffect(() => {
    if (!USE_ELEMENT_SCROLLER) return undefined;
    const html = document.documentElement;
    html.dataset.scrollRootActive = 'true';
    return () => {
      setElementScrollRoot(false);
      delete html.dataset.scrollRootActive;
      ScrollTrigger.defaults({ scroller: undefined });
    };
  }, []);

  useLayoutEffect(() => {
    scrollRootTo(0);
    lenisRef.current?.lenis?.scrollTo(0, { immediate: true });
  }, []);

  useLenis(() => {
    ScrollTrigger.update();
  });

  const lenis = useLenis();
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true });
  }, [lenis]);

  useGSAP(
    () => {
      const raf = (time) => {
        lenisRef.current?.lenis?.raf(time * 1000);
      };
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      const refresh = requestAnimationFrame(() => ScrollTrigger.refresh());

      return () => {
        cancelAnimationFrame(refresh);
        gsap.ticker.remove(raf);
      };
    },
    { scope: rootRef },
  );

  return (
    <PreloaderV2 sequence={introSequence} stillMinOpacity={0.3} showStillRain>
      <ReactLenis
        root={USE_ELEMENT_SCROLLER ? 'asChild' : true}
        ref={lenisRef}
        {...(USE_ELEMENT_SCROLLER ? { 'data-scroll-root': '' } : null)}
        options={{
          autoRaf: false,
          duration: 1.2,
          smoothWheel: true,
          // Touch scroll driven by Lenis instead of the browser, and only in
          // element-scroller (mobile) mode.
          //
          // A native touch fling is a compositor animation: the main thread
          // is told where the page went a frame or two after it got there,
          // and nothing JS can do cancels one already in flight — not
          // `overflow: hidden`, not a `touchmove` preventDefault, not a
          // programmatic scroll. That is what let a hard flick up out of
          // ProductV3 sail clean through Scenev2mweb and sit in the hero for
          // a moment before the pin could drag it back (see useScenev2mweb's
          // pin and settle notes for the section end of this).
          //
          // With syncTouch, Lenis preventDefaults the touchmove and moves the
          // scroller itself, so that fling never exists: inertia becomes a JS
          // animation on the main thread, `lenis.stop()` ends it on the exact
          // frame the pin asks for, and every position the page passes
          // through is one the pin probe actually sees. Same code path on iOS
          // Safari, Chrome and Firefox — none of it leans on one engine's
          // scroll behaviour.
          //
          // Desktop is untouched: it keeps native wheel + smoothWheel.
          //
          // Tuning knobs, both left at their defaults because those are the
          // closest match to the native feel being replaced: `syncTouchLerp`
          // (how tightly inertia tracks) and `touchInertiaExponent` (how far
          // a flick throws). Note also that Lenis now owns touchmove here, so
          // any scrollable overlay added to this page needs
          // `data-lenis-prevent` on it.
          ...(USE_ELEMENT_SCROLLER ? { syncTouch: true } : null),
        }}
      >
        <HeaderV2 logoTo="/" mode="light" visible />
        <main ref={rootRef}>
          {/* Each seam below follows the same shape, and it is deliberate:
              the boundary marker is placed HANDOFF_HOLD_VH ABOVE the end of
              the pinned section it follows, and the next section is then
              pulled up by that same amount so it still starts exactly at the
              marker (which is where CloudTransition's wipe teleports to, and
              therefore where that section must be perfectly framed).

              The point is the trigger, not the landing. CloudTransition arms
              one viewport above the marker; a `sticky top-0` pin stops
              sticking one viewport before its own container ends. Marker at
              the container's end makes those the same scroll position, so
              the pin starts lifting on the same frame the wipe is still
              deciding to fire — that is the sliver of the next section that
              was showing through. Lifting the marker gives the pin that much
              room to still be fully stuck across the trigger, its one-tick
              debounce, and the entire gather-in. */}
          <div className="relative">
            <IntroHeroV3 resetRef={introResetRef} />
            {/* Same marker either way — IntroHeroV3's pin/hold geometry
                doesn't branch on isDesktop, so the seam sits at the same
                spot on mobile as it does on desktop (see the CloudTransition
                usage below for each). */}
            <div
              ref={heroToCarouselRef}
              className="absolute left-0 w-px h-0"
              style={{ bottom: `${HANDOFF_HOLD_VH}dvh` }}
              aria-hidden="true"
            />
          </div>

          {isDesktop ? (
            <>
              {/* Neither boundary here has a Seawave-style lead-in ramp
                  feeding scrollNavState.seamLeadCover, so `cover` at the
                  trigger instant is never naturally pre-built the way
                  CloudTransition's default skip-the-gather shortcut assumes
                  — always play the full gather-in (see CloudTransition's own
                  skipInCover comment). */}
              <CloudTransition
                boundaryRef={heroToCarouselRef}
                skipInCover={Infinity}
                gatherFrom={0}
                inMs={CLOUD_WIPE_IN_MS}
                outMs={CLOUD_WIPE_OUT_MS}
                // Reversing out of the carousel should re-enter the hero at
                // its own untouched start, not resume from wherever its
                // scroll-sequence was last left — see introResetRef above.
                reverseLandTarget={0}
                onReverseLand={() => introResetRef.current?.()}
              />

              <div
                className="relative"
                style={{ marginTop: `-${HANDOFF_HOLD_VH}dvh` }}
              >
                {/* Carousel only — the scene-to-product handoff (bottle
                    flight, room flythrough, hotspots) that normally follows
                    the last scene is switched off here, so scrolling on from
                    it hands straight to the cloud transition below
                    instead. */}
                <Suspense fallback={null}>
                  <SceneV2
                    gui={gui}
                    productEnabled={false}
                    trailingHoldVh={HANDOFF_HOLD_VH + LAST_SCENE_EXIT_VH}
                    // Centered scroll cue, drawn inside SceneV2's own pinned
                    // overlay (see there) — the hero's cue lives in
                    // IntroHeroV3's pin the same way.
                    scrollCue
                  />
                </Suspense>
                <div
                  ref={carouselToEndRef}
                  className="absolute left-0 w-px h-0"
                  style={{ bottom: `${HANDOFF_HOLD_VH}dvh` }}
                  aria-hidden="true"
                />
              </div>
              <CloudTransition
                boundaryRef={carouselToEndRef}
                skipInCover={Infinity}
                gatherFrom={0}
                inMs={CLOUD_WIPE_IN_MS}
                outMs={CLOUD_WIPE_OUT_MS}
              />

              {/* Normal scroll flow from here on, same as VideoHeroV3 below
                  it — only the carousel's own exit needs the cloud wipe, so
                  ProductV3 is the one pulled up onto the boundary marker and
                  VideoHeroV3 simply follows it in flow with no further
                  hand-off. */}
              <div style={{ marginTop: `-${HANDOFF_HOLD_VH}dvh` }}>
                <ProductV3 products={productCards} />
              </div>
            </>
          ) : (
            <>
              {/* No pinned canvas on mobile — Scenev2mweb's swipe-controlled
                  frame sequence is normal scroll flow, not a sticky section
                  like SceneV2. But the hand-off still crosses the same seam
                  IntroHeroV3 leaves behind (heroToCarouselRef, above), so it
                  gets the same cloud wipe masking it, then falls straight
                  into ProductV3 in normal flow. */}
              <CloudTransition
                boundaryRef={heroToCarouselRef}
                skipInCover={Infinity}
                gatherFrom={0}
                inMs={CLOUD_WIPE_IN_MS}
                outMs={CLOUD_WIPE_OUT_MS}
                // Same pair as the desktop boundary above: swiping back off
                // Scenev2mweb's first scene releases its pin upward, which
                // is what carries the marker across this boundary's reverse
                // line. Landing at 0 puts the page on the hero's own top
                // rather than part-way down its pin, and the reset hands the
                // reel back its untouched frame 0 — without these the wipe
                // dropped the user mid-hero on whatever frame it was left.
                reverseLandTarget={0}
                onReverseLand={() => introResetRef.current?.()}
              />
              {/* z-[3] — above IntroHeroV3's own z-[2]. The marker sits
                  HANDOFF_HOLD_VH short of the hero's pin fully clearing the
                  viewport (that gap is what keeps the pin covering through
                  the trigger/gather — see the seam comment above), so once
                  CloudTransition lands here the outgoing pin is still
                  mid-slide behind this section for that same distance.
                  SceneV2 papers over the equivalent gap on desktop just by
                  being an opaque canvas at z-20; this section needs the same
                  explicit lift since plain normal-flow content has no
                  z-index of its own and would otherwise lose to the hero's
                  positioned z-[2] regardless of DOM order, leaving its tail
                  visible on top instead of hidden behind. */}
              <div
                className="relative z-[3]"
                style={{ marginTop: `-${HANDOFF_HOLD_VH}dvh` }}
              >
                {/* showHeader=false — HeaderV2 above is already fixed over
                    the whole page, so Scenev2mweb's own nav pill (its
                    Figma layout's header, meant for standalone use) would
                    otherwise double up with it right here. */}
                <Scenev2mweb showHeader={false} />
              </div>
              <ProductV3 products={productCards} />
            </>
          )}

          <VideoHeroV3 />

          <FooterV3 />
        </main>
      </ReactLenis>
    </PreloaderV2>
  );
};
