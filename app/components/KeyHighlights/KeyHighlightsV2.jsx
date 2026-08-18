import { forwardRef } from "react";
import { highlights } from "../../data/highlights";
import { useKeyHighlightsSequenceV2 } from "../../hooks/useKeyHighlightsSequenceV2";
import AnimatedTitle from "../AnimatedTitle/AnimatedTitle";
import AnimatedDescription from "../AnimatedDescription/AnimatedDescription";

/**
 * Tailwind rewrite of KeyHighlights — no companion .css file, every rule
 * from KeyHighlights.css re-expressed as Tailwind utilities. Labels are
 * `khv2-*` (not `kh-*`) because the legacy KeyHighlights.jsx/css is still
 * statically imported elsewhere in the app (HomePage), so its unscoped,
 * unlayered `.kh-*` rules stay globally loaded and would otherwise beat
 * these Tailwind utilities in the cascade despite matching class names.
 *
 * Mobile-first: unprefixed classes are the stacked mobile layout, `md:`
 * (>=768px) brings back the absolute-positioned tablet layout, `lg:`
 * (>=1024px) steps sizing up to the full desktop scale — standard Tailwind
 * breakpoints instead of one-off `max-[…]:` overrides.
 *
 * Frame loading is gated via useKeyHighlightsSequenceV2: the section holds
 * its layout, but the visual only fades in once every sequence frame has
 * finished preloading — the same "wait for the sequence" gating PreloaderV2
 * uses for the intro reel.
 *
 * Forwards its outer `<section>` node via ref so the page can measure it
 * (e.g. HomeV2Page swaps HeaderV2 into its alternate/light-bg mode for as
 * long as this section sits under the header, back to normal past it).
 */
const KeyHighlightsV2 = forwardRef(
  function KeyHighlightsV2(_props, forwardedRef) {
    const {
      sectionRef,
      stickyRef,
      visualRef,
      canvasRef,
      activeIndex,
      ready,
      reducedMotion,
      scrollMultiplier,
      scrollToHighlight,
    } = useKeyHighlightsSequenceV2();

    const active = highlights[activeIndex];
    const descLines = active.description.split("\n");

    return (
      <section
        ref={(node) => {
          sectionRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className={`khv2-root relative z-[1] bg-[#d0d1db] text-black ${
          reducedMotion
            ? "h-auto min-h-dvh"
            : "h-[calc(var(--kh-scroll-mult)*100dvh)]"
        }`}
        style={{ "--kh-scroll-mult": scrollMultiplier }}
        aria-label="Key highlights"
      >
        <div
          ref={stickyRef}
          className={`khv2-sticky overflow-clip isolate bg-[#d0d1db] ${
            reducedMotion ? "relative h-auto min-h-dvh" : "sticky top-0 h-dvh"
          }`}
        >
          <div className="khv2-layout relative flex w-full h-full min-h-dvh flex-col items-stretch justify-center box-border pb-[5.75rem] md:block md:pb-0">
            <div
              ref={visualRef}
              className={`khv2-visual relative z-[1] order-2 grid w-full h-[min(42dvh,320px)] shrink-0 place-items-center bg-[#d0d1db] pointer-events-none transition-opacity duration-500 ease-out md:absolute md:inset-0 md:order-none md:h-auto md:w-auto ${
                ready ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
            >
              <canvas
                ref={canvasRef}
                className="khv2-canvas block w-[min(78vw,360px)] h-[min(36vh,280px)] [contain:strict] [will-change:contents] md:w-[min(48vw,560px)] md:h-[min(52vh,440px)] lg:w-[min(52vw,720px)] lg:h-[min(58vh,520px)]"
              />
            </div>

            <div
              className="khv2-title relative z-[2] order-1 max-w-none px-5 pb-[0.35rem] text-center pointer-events-auto md:absolute md:left-[clamp(1.25rem,2.85vw,2.55rem)] md:top-1/2 md:order-none md:max-w-[min(46vw,22rem)] md:-translate-y-1/2 md:px-0 md:pb-0 md:pointer-events-none md:text-left lg:max-w-[min(42vw,28rem)]"
              aria-live="polite"
            >
              <AnimatedTitle
                key={active.id}
                as="h2"
                className="khv2-title__text m-0 [font-family:var(--font-title)] text-[clamp(2.25rem,11vw,3.25rem)] font-semibold leading-none tracking-[-0.05em] uppercase text-black opacity-90 md:text-[clamp(2.25rem,4.5vw,3.5rem)] lg:text-[clamp(2.5rem,5vw,4.5rem)]"
                replayKey={active.id}
                blurSweep
              >
                {active.title}
              </AnimatedTitle>
            </div>

            <div
              className="khv2-desc relative z-2 order-1 mx-auto w-auto max-w-[22rem] px-5 pb-[0.85rem] text-center pointer-events-auto md:absolute md:right-[clamp(1.25rem,3.5vw,3.25rem)] md:top-1/2 md:order-none md:mx-0 md:w-[min(220px,24vw)] md:max-w-none md:-translate-y-1/2 md:px-0 md:pb-0 md:pointer-events-none md:text-left lg:w-[min(264px,22vw)]"
              aria-live="polite"
              aria-atomic="true"
            >
              <AnimatedDescription
                key={active.id}
                className="khv2-desc__text m-0 [font-family:var(--font-body)] text-[clamp(0.875rem,1.1vw,1rem)] font-medium leading-[1.35] text-black whitespace-pre-line"
                replayKey={active.id}
                lines={descLines}
              />
            </div>

            <nav
              className="khv2-nav absolute z-3 left-1/2 order-3 -translate-x-1/2 bottom-[clamp(1rem,3vh,1.5rem)] mt-0 w-[calc(100%-2rem)] max-w-none box-border overflow-visible p-0 md:order-none md:bottom-[clamp(1.25rem,3.5vh,2.6rem)] md:w-max md:max-w-[calc(100%-1.5rem)] lg:max-w-[calc(100%-2rem)]"
              aria-label="Product highlights"
            >
              <ul className="khv2-nav__list m-0 flex w-full min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-[0.65rem] p-0 list-none md:w-max md:flex-nowrap md:gap-[clamp(0.65rem,1.6vw,1.25rem)] lg:gap-[clamp(0.85rem,2.2vw,2.4rem)]">
                {highlights.map((item, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <li key={item.id} className="khv2-nav__item m-0">
                      <button
                        type="button"
                        disabled={!ready}
                        className={`khv2-nav__btn inline-flex items-center gap-1.75 border-0 bg-transparent p-0 cursor-pointer [font-family:var(--font-body)] text-[0.65rem] font-medium tracking-[0.02em] uppercase leading-normal whitespace-nowrap text-black transition-opacity duration-[320ms] ease-in-out disabled:cursor-not-allowed disabled:pointer-events-none md:text-[0.7rem] md:gap-2 lg:text-sm lg:gap-3.5 ${
                          isActive
                            ? "is-active opacity-100"
                            : "opacity-[0.33] hover:opacity-[0.62] focus-visible:opacity-[0.62]"
                        }`}
                        aria-current={isActive ? "step" : undefined}
                        onClick={() => scrollToHighlight(index)}
                      >
                        <span
                          className={`khv2-nav__bullet size-1.5 shrink-0 rounded-full border bg-black transition-all duration-320 ease-in-out ${
                            isActive ? "opacity-100 " : "opacity-35"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="khv2-nav__label whitespace-nowrap">
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      </section>
    );
  },
);

export default KeyHighlightsV2;
