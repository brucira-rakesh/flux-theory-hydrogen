import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReactLenis, useLenis } from "lenis/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { PreloaderV2 } from "../components/Preloader/Preloader.v2";
import { usePreloader } from "../components/Preloader/PreloaderContext";
import { prefersReducedMotion } from "../hooks/useSpotlight";
import IntroHeroV2, {
  COPY_REVEAL_DELAY_SEC,
} from "../components/IntroHero/IntroHeroV2";
import { AUTOPLAY_FRAME_COUNT, getAutoplayFramePath } from "../data/homeSeq";
import SceneV2 from "../Scene.v2";
import Seawave from "../Seawave";
import CloudTransition from "../CloudTransition";
import Product from "./Product";
import VideoHeroV2 from "../components/VideoHero/VideoHeroV2";
import Footer from "../components/Footer/Footer";
import HeaderV2 from "../components/Header/HeaderV2";
import KeyHighlightsV2 from "../components/KeyHighlights/KeyHighlightsV2";
import { useDebugGui } from "../scenes-v2/useDebugGui";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Module-level so the reference is stable across renders — PreloaderV2's
// preload effect re-runs whenever this object identity changes.
const introSequence = {
  frameCount: AUTOPLAY_FRAME_COUNT,
  getFramePath: getAutoplayFramePath,
};

// Reads PreloaderContext (only available under <PreloaderV2>) so HeaderV2
// itself stays decoupled from the preloader — it just takes `visible`. Timed
// to land with IntroHeroV2's own title/desc reveal (COPY_REVEAL_DELAY_SEC
// after `handoff`) rather than firing on raw handoff, so the header doesn't
// arrive well ahead of the copy it sits above.
function SiteHeaderReveal(props) {
  const { handoff } = usePreloader();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!handoff) return undefined;
    if (prefersReducedMotion()) {
      setRevealed(true);
      return undefined;
    }
    const id = window.setTimeout(
      () => setRevealed(true),
      COPY_REVEAL_DELAY_SEC * 1000,
    );
    return () => window.clearTimeout(id);
  }, [handoff]);

  return <HeaderV2 {...props} visible={revealed} />;
}

// How far from the viewport top the fixed header actually sits (top-3/top-6
// plus its own height) — used as the probe line for "is a section currently
// underneath the header" below, rather than a plain top-of-viewport check.
const HEADER_BAND_PX = 64;

// Swaps HeaderV2 into "dark" mode (solid white panel, black text) for as
// long as `sectionRef`'s element covers the header band, "light" (glass,
// white text) otherwise. Reads scroll off Lenis's own tick — same source
// ScrollTrigger.update() above uses — instead of a native 'scroll' listener,
// since Lenis doesn't reliably dispatch those for programmatic scrolling.
function useHeaderModeOverSection(sectionRef) {
  const [overSection, setOverSection] = useState(false);

  useLenis(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isOver = rect.top <= HEADER_BAND_PX && rect.bottom >= 0;
    setOverSection((prev) => (prev === isOver ? prev : isOver));
  });

  return overSection;
}

export const HomeV2Page = () => {
  const rootRef = useRef(null);
  const lenisRef = useRef(null);
  const keyHighlightsRef = useRef(null);
  // Zero-height marker sitting in the flow exactly on the Seawave -> SceneV2
  // boundary — CloudTransition reads its viewport-space top to place the cloud
  // wipe over the canvas swap seam.
  const seawaveToSceneRef = useRef(null);
  // IntroHeroV2's autoplay reel is still playing (and pinned full-viewport
  // over SceneV2) for the first ~AUTOPLAY_FRAME_COUNT frames after handoff —
  // no point paying for SceneV2's PostFX composer/bloom pass while it's
  // invisible underneath. Gate it on the reel finishing instead.
  const [introAutoplayDone, setIntroAutoplayDone] = useState(false);
  const headerMode = useHeaderModeOverSection(keyHighlightsRef)
    ? "dark"
    : "light";
  // One shared lil-gui panel for the whole page — SceneV2 and ProductV2 each
  // add their own named sub-folder to it instead of spawning a second
  // floating debug panel (see their own `gui` prop / useDebugGui).
  const gui = useDebugGui("Home V2 Tweaks");

  // Native scroll restoration is disabled app-wide (see main.jsx), so this
  // just needs to force top-of-page on every mount — React Router doesn't
  // reset scroll on navigation by itself.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    lenisRef.current?.lenis?.scrollTo(0, { immediate: true });
  }, []);

  // Keep ScrollTrigger in sync with Lenis's (possibly smoothed) scroll position.
  useLenis(() => {
    ScrollTrigger.update();
  });

  // The Lenis instance itself is created asynchronously inside <ReactLenis>
  // (after this page's mount-time layout effect above already ran), so its
  // internal scroll target must be reset separately once it exists.
  const lenis = useLenis();
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true });
  }, [lenis]);

  useGSAP(
    () => {
      // autoRaf is off on <ReactLenis>, so drive it from gsap's own ticker —
      // two competing rAF loops is what causes scroll jitter/reflow.
      const raf = (time) => {
        lenisRef.current?.lenis?.raf(time * 1000);
      };
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      // Page-scoped gsap/ScrollTrigger animations go here.

      const refresh = requestAnimationFrame(() => ScrollTrigger.refresh());

      return () => {
        cancelAnimationFrame(refresh);
        gsap.ticker.remove(raf);
      };
    },
    { scope: rootRef },
  );

  return (
    <PreloaderV2 sequence={introSequence}>
      <ReactLenis
        root
        ref={lenisRef}
        options={{ autoRaf: false, duration: 1.2, smoothWheel: true }}
      >
        <SiteHeaderReveal logoTo="/home" mode={headerMode} />
        <CloudTransition boundaryRef={seawaveToSceneRef} />
        <main ref={rootRef}>
          <IntroHeroV2 onAutoplayDone={() => setIntroAutoplayDone(true)} />
          <Seawave />
          {/* Seam marker between the two sticky WebGL sections — drives the
              cloud wipe below. Zero height so it never affects layout. */}
          <div ref={seawaveToSceneRef} aria-hidden="true" />
          {/* <SceneV2 postFxEnabled={introAutoplayDone} /> */}
          {/* <ProductShelfV2 /> */}
          <SceneV2 postFxEnabled={introAutoplayDone} gui={gui} />
          <KeyHighlightsV2 ref={keyHighlightsRef} />
          {/* Gated on `lenis` (not mounted unconditionally): Product's own
              effect reuses whichever Lenis instance useLenis() resolves to
              on its FIRST render (see Product.jsx's contextLenis comment) —
              mounting it before this page's root Lenis instance exists would
              make it wrongly conclude it owns none and spin up a second,
              competing Lenis instance. */}
          {lenis && <Product />}
        </main>
        <div className="relative">
          {/* z-[1], normal flow (see VideoHeroV2) — stays on top and scrolls
              up and away over the footer beneath it. */}
          <VideoHeroV2 />

          {/* Pulled up by 100svh so it starts already tucked under the tail
              end of the hero's scroll, hidden behind it (lower z-index).
              The trailing 100svh spacer inside gives the sticky footer real
              room to hold at top-0 while the hero scrolls off above it,
              instead of releasing immediately — the spacer's height exactly
              cancels the negative margin, so it adds no extra page length.
              Background matches the footer so the hold phase reads as one
              continuous panel, not a gap. */}
          <div className="relative z-0 -mt-[100svh] bg-[#cacaca]">
            <div className="sticky top-0">
              <Footer />
            </div>
            <div className="h-[100svh]" aria-hidden="true" />
          </div>
        </div>
      </ReactLenis>
    </PreloaderV2>
  );
};
