import {useLayoutEffect, useRef} from 'react';
import gsap from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {SplitText} from 'gsap/SplitText';
import founderPhoto from '~/assets/pdp/founder-testimonial.png';

gsap.registerPlugin(SplitText, ScrollTrigger);

/** Dim default — lighter/muted but fully readable on the dark photo. */
const QUOTE_COLOR_DIM = 'rgba(184, 220, 232, 0.48)';
/** Filled quote color — matches `.flux-pdp-quote__text`. */
const QUOTE_COLOR_FULL = '#b8dce8';

/**
 * Contained founder card — Figma 3101:2354.
 *
 * Pins the whole section at the viewport top while the quote color-fills.
 * Photo is static (no parallax).
 */
const FOUNDER_QUOTE_P1 =
  'Flux was born from a desire to rethink the everyday. We bring together thoughtful design, intelligent innovation, and uncompromising performance to create products that elevate the modern home.';

const FOUNDER_QUOTE_P2 =
  "Because true luxury isn't about having more. It's about experiencing better.";

const FOUNDER_NAME = 'Ranbir Kapoor';
const FOUNDER_ROLE = 'CEO & CO-FOUNDER';

export default function FluxPdpTestimonial() {
  const sectionRef = useRef(null);
  const quoteRef = useRef(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const quote = quoteRef.current;
    if (!section || !quote) return undefined;

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (reduceMotion) {
      // No SplitText — CSS full color on `.flux-pdp-quote__text`, no pin.
      return undefined;
    }

    let split;

    const ctx = gsap.context(() => {
      split = SplitText.create(quote, {
        type: 'words',
        wordsClass: 'word',
      });

      const words = split.words;
      if (!words?.length) return;

      gsap.set(words, {color: QUOTE_COLOR_DIM});

      gsap
        .timeline({
          scrollTrigger: {
            trigger: section,
            start: 'top top',
            end: '+=150%',
            pin: true,
            scrub: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        })
        .to(
          words,
          {
            color: QUOTE_COLOR_FULL,
            stagger: 0.08,
            ease: 'none',
            duration: 0.05,
          },
          0,
        );
    }, section);

    requestAnimationFrame(() => ScrollTrigger.refresh());

    return () => {
      ctx.revert();
      split?.revert?.();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="flux-pdp-quote founder-quote"
      aria-label="Founder note"
    >
      <div className="flux-pdp-quote__pin">
        <div className="flux-pdp-quote__card">
          <div className="flux-pdp-quote__media" aria-hidden="true">
            <img
              className="flux-pdp-quote__photo"
              src={founderPhoto}
              alt=""
              draggable={false}
            />
          </div>
          <blockquote className="flux-pdp-quote__copy">
            <div ref={quoteRef} className="flux-pdp-quote__text">
              <p>
                <span aria-hidden="true">“</span>
                {FOUNDER_QUOTE_P1}
              </p>
              <p>
                {FOUNDER_QUOTE_P2}
                <span aria-hidden="true">”</span>
              </p>
            </div>
            <footer className="flux-pdp-quote__byline">
              <cite className="flux-pdp-quote__name">{FOUNDER_NAME}</cite>
              <p className="flux-pdp-quote__role">{FOUNDER_ROLE}</p>
            </footer>
          </blockquote>
        </div>
      </div>
    </section>
  );
}
