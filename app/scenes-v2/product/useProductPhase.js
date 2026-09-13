import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

// Whether scroll has carried past the carousel's own owned range and into
// product's, expressed as a live ref rather than a second ScrollTrigger/
// sticky section — it reads the exact same window.scrollY + sectionRef
// geometry swingCarousel.js already measures for the carousel above it, just
// further down the SAME .scene-v2__scroll-section (see Scene.v2.jsx's own
// height calc). Once the carousel's wheel-lock releases past its last step
// (see swingCarousel.js's beginGesture failing past maxStep ->
// releaseScroll()), native scroll carries straight on into this range with
// nothing else to hand off — no second Canvas, no second sticky div, no
// scroll-position jump.
//
// This used to ALSO return a `phaseRef` — 0..1 progress across a scrub
// distance — which drove the flythrough's camera/room motion. That motion is
// now played on a timer by useProductAutoZoom (which owns its own phaseRef),
// so nothing scrubs against scroll position any more and the scrub distance
// itself is gone (see constants.js's SCROLL_LENGTH_VH).
//
// `activeRef` is the one remaining output, and note it is NOT the right
// thing to gate the room's own motion on: it is false at the exact moment
// the forward cloud transition lands, because that transition's auto-scroll
// targets startPx itself and rounding leaves the page a hair short. See
// useProductAutoZoom's onScreenRef, which is what consumers actually use.
// This is still the correct signal for the handoff's reverse watcher, whose
// whole job is to notice scroll leaving this range.
export function useProductPhase({ sectionRef, carouselOwnedVh }) {
  const activeRef = useRef(false);

  useFrame(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sectionTop = rect.top + window.scrollY;
    const vh = window.innerHeight / 100;
    const startPx = sectionTop + carouselOwnedVh * vh;
    activeRef.current = window.scrollY >= startPx;
  });

  return { activeRef };
}
