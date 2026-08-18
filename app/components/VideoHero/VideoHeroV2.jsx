import { useMemo, useRef } from "react";
import AnimatedTitle from "../AnimatedTitle/AnimatedTitle";
import AnimatedDescription from "../AnimatedDescription/AnimatedDescription";
import { usePreloader } from "../Preloader/PreloaderContext";
import homeVideoSrc from "../../assets/ranbir/home-video-c.mp4";

/** Letter counts for the bottom titles (spaces are not `.at-char` nodes). */
const BOTTOM_LEFT_CHARS = 10; // "FIVE STATES"
const BOTTOM_RIGHT_CHARS = 6; // "ONE YOU"
const BOTTOM_WAVE_CHARS = BOTTOM_LEFT_CHARS + BOTTOM_RIGHT_CHARS;

export default function VideoHeroV2() {
  const wrapRef = useRef(null);
  const stickyRef = useRef(null);
  // Gated on `handoff` (not fired unconditionally on mount) so this doesn't
  // compete with the intro sequence's own preload during boot — by the time
  // the boot hands off there's still ~450vh of scroll before this section is
  // reached, plenty of room for a background fetch of a ~1MB file. The
  // resource hint (not just the <video preload>) matters because browsers
  // throttle network fetching for offscreen <video> elements regardless of
  // their `preload` attribute — this bypasses that by fetching the bytes as
  // a plain resource, so they're already cache-warm once the element itself
  // is allowed to start decoding.
  const { handoff } = usePreloader();

  // Forward on enter, reverse on leave, and play again on re-enter.
  const textToggleTrigger = useMemo(
    () => ({
      trigger: wrapRef,
      start: "top top",
      end: "bottom bottom",
      toggleActions: "play reverse play reverse",
    }),
    [],
  );

  // Shared blur wave so left → right reads as one continuous title.
  const bottomBlurLeft = useMemo(
    () => ({
      charOffset: 0,
      waveLength: BOTTOM_WAVE_CHARS,
      entrySpan: {
        delay: 0,
        duration: 0.8,
        stagger: 0.02,
        chars: BOTTOM_LEFT_CHARS,
      },
    }),
    [],
  );
  const bottomBlurRight = useMemo(
    () => ({
      charOffset: BOTTOM_LEFT_CHARS,
      waveLength: BOTTOM_WAVE_CHARS,
      entrySpan: {
        delay: 0,
        duration: 0.8,
        stagger: 0.02,
        chars: BOTTOM_LEFT_CHARS,
      },
    }),
    [],
  );

  return (
    <div
      ref={wrapRef}
      className="vh-wrap relative w-full h-[300vh] z-[1] motion-reduce:h-svh"
    >
      {/* No isolation:isolate — would trap z-index inside and prevent the footer
          from painting over this sticky panel as it scrolls into view. */}
      <div
        ref={stickyRef}
        className="vh-sticky sticky top-0 w-full h-svh overflow-hidden bg-[#0d0603] motion-reduce:static"
      >
        {handoff && (
          <link rel="preload" as="video" type="video/mp4" href={homeVideoSrc} />
        )}
        <video
          className="vh-video absolute inset-0 w-full h-full object-cover object-top z-0"
          src={homeVideoSrc}
          preload="auto"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />

        <div
          className="vh-overlay absolute inset-0 z-[1] pointer-events-none bg-[linear-gradient(to_bottom,rgba(0,0,0,0.28)_0%,transparent_25%,transparent_50%,rgba(0,0,0,0.80)_100%),linear-gradient(to_right,rgba(0,0,0,0.40)_0%,transparent_50%),linear-gradient(to_left,rgba(0,0,0,0.18)_0%,transparent_40%)]"
          aria-hidden="true"
        />

        <div className="vh-mid-row absolute left-0 right-0 z-[2] top-[44%] -translate-y-1/2 flex flex-col items-start gap-3 overflow-hidden pointer-events-none px-[clamp(12px,3vw,40px)] md:top-1/2 md:flex-row md:items-center md:justify-between">
          <AnimatedDescription
            as="blockquote"
            className="vh-quote m-0 flex-shrink-0 text-[12px] max-w-[220px] [font-family:var(--font-body)] font-normal leading-[1.7] text-white/92 [will-change:transform,opacity] md:text-[clamp(12px,1.2vw,15px)] md:max-w-[260px]"
            scrollTrigger={textToggleTrigger}
            lines={[
              "Shift isn't about becoming",
              "someone else. It's about becoming",
              "exactly who the moment needs.",
            ]}
          />

          <AnimatedDescription
            as="p"
            className="vh-signature m-0 flex-shrink-0 self-end font-serif italic text-[clamp(0.85rem,4vw,1.1rem)] text-white opacity-[0.88] md:self-auto md:text-[clamp(1rem,2.2vw,1.6rem)]"
            scrollTrigger={textToggleTrigger}
            delay={0.2}
          >
            Ranbir Kapoor
          </AnimatedDescription>
        </div>

        <div className="vh-bottom absolute left-0 right-0 z-[2] bottom-[clamp(16px,3.5vw,44px)] flex justify-between items-end px-[clamp(12px,3vw,40px)] pointer-events-none overflow-visible">
          <AnimatedTitle
            as="span"
            className="vh-bottom__left vh-word inline-block leading-none m-0 [font-family:var(--font-title)] text-[clamp(28px,10vw,52px)] font-extrabold tracking-[-0.02em] uppercase md:text-[clamp(36px,8vw,108px)]"
            scrollTrigger={textToggleTrigger}
            blurSweep={bottomBlurLeft}
            segments={[
              { text: "FIVE ", className: "vh-word--white text-white" },
              { text: "STATES", className: "vh-word--teal text-[#4ecdc4]" },
            ]}
          />
          <AnimatedTitle
            as="span"
            className="vh-bottom__right vh-word inline-block leading-none m-0 [font-family:var(--font-title)] text-[clamp(28px,10vw,52px)] font-extrabold tracking-[-0.02em] uppercase md:text-[clamp(36px,8vw,108px)]"
            scrollTrigger={textToggleTrigger}
            delay={0.08}
            blurSweep={bottomBlurRight}
            segments={[
              { text: "O", className: "vh-word--white text-white" },
              { text: "N", className: "vh-word--teal text-[#4ecdc4]" },
              { text: "E YOU", className: "vh-word--white text-white" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
