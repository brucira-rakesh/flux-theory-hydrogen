import { useRef } from "react";
import { useLenis } from "lenis/react";
import "./HeroScrollCue.css";
import { getScrollY } from "../../utils/scrollRoot";

// Desktop-only placements. Both are `absolute`, NOT `fixed`: each cue is
// rendered inside its own section's pinned, viewport-filling overlay —
// `right` inside IntroHeroV3's `.intro-hero-v3__pin` (bottom-right corner),
// `center` inside `.scene-v2`, the middle carousel scene (centered at the
// bottom). Sitting in the pin means the sticky box itself carries the cue
// on and off screen, so neither one needs any scroll-bounded show/hide of
// its own to stay out of the other sections' way.
const VARIANT_POSITION_CLASSES = {
  right: "right-[clamp(20px,2.8vw,40px)]",
  // Full-width row + flex centering rather than `left-1/2` + a centering
  // translate: the entrance keyframe below animates `transform`, which
  // would clobber that translate for as long as it runs.
  center: "left-0 right-0 flex justify-center",
};

/**
 * "Scroll to explore" affordance pinned to the bottom of its section's
 * overlay.
 *
 * `fadeOutAt`: px of TOTAL page scroll over which the cue fades out — right
 * for the hero-intro cue, which should only compete for attention before
 * the user has scrolled at all. Pass 0 to opt out entirely, which is what
 * the carousel's centered cue wants: it is already scoped to its own
 * section by living inside that section's pin, so page scroll says nothing
 * about whether it should be on screen.
 */
const HeroScrollCue = ({
  fadeOutAt = 80,
  variant = "right",
  className = "",
}) => {
  const elRef = useRef(null);

  useLenis(() => {
    const el = elRef.current;
    if (!el || !fadeOutAt) return;
    el.style.opacity = String(1 - Math.min(getScrollY() / fadeOutAt, 1));
  });

  return (
    <div
      ref={elRef}
      className={`hero__scroll-cue absolute ${VARIANT_POSITION_CLASSES[variant]} bottom-[clamp(20px,3.4vh,32px)] z-40 text-white pointer-events-none ${className}`}
      aria-hidden="true"
      // The entrance keyframe's fill-mode holds its final opacity/transform
      // at the "animation" cascade origin, which outranks the inline
      // opacity the scroll listener above sets — so the fade-on-scroll
      // never visibly applies until the entrance animation itself is
      // cleared once it's done running.
      onAnimationEnd={(event) => {
        event.currentTarget.style.animation = "none";
      }}
    >
      <div className="hero__scroll-cue-track">
        <svg
          className="hero__scroll-cue-svg"
          width="26"
          height="42"
          viewBox="0 0 26 42"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="1.5"
            y="1.5"
            width="23"
            height="39"
            rx="11.5"
            // fill="currentColor"
            // fillOpacity="0.2"
            opacity={0.2}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        {/* The wheel dot lives outside the SVG so the loop can animate box
            `height` (dot -> vertical pill -> dot) rather than SVG geometry. */}
        <div className="hero__scroll-cue-dot" />
      </div>
    </div>
  );
};

export default HeroScrollCue;
