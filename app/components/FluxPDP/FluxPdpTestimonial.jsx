import {useLayoutEffect, useRef} from 'react';
import gsap from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {SplitText} from 'gsap/SplitText';
import founderPhoto from '~/assets/pdp/founder-testimonial.png';
import {getScrollRoot} from '~/utils/scrollRoot';

gsap.registerPlugin(SplitText, ScrollTrigger);

/** Dim default — lighter/muted but fully readable on the dark photo. */
const QUOTE_COLOR_DIM = 'rgba(184, 220, 232, 0.48)';
/** Filled quote color — matches `.flux-pdp-quote__text`. */
const QUOTE_COLOR_FULL = '#b8dce8';

/**
 * Contained founder card — Figma 3101:2354.
 *
 * Scroll sequence while pinned:
 * 1) Card zooms to fill the section
 * 2) Quote color-fills word by word
 * 3) Card zooms back to the inset frame
 *
 * Must NOT sit under a transformed ancestor (e.g. data-pdp-reveal) — that
 * breaks ScrollTrigger pin (fixed positioning escapes to the transformed parent).
 */
const FOUNDER_QUOTE_P1 =
  'Flux was born from a desire to rethink the everyday. We bring together thoughtful design, intelligent innovation, and uncompromising performance to create products that elevate the modern home.';

const FOUNDER_QUOTE_P2 =
  "Because true luxury isn't about having more. It's about experiencing better.";

const FOUNDER_NAME = 'Ranbir Kapoor';
const FOUNDER_ROLE = 'CEO & CO-FOUNDER';

/** Scale needed for the card to cover the full section (incl. white padding).
 * Uses layout sizes (offset*) so mid-scrub transforms don't skew the measure.
 * Slight overshoot hides subpixel gaps (header sliver / white edges). */
function fillScaleFor(section, card) {
  const sw = section.offsetWidth;
  const sh = section.offsetHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  if (cw <= 0 || ch <= 0) return 1;
  return Math.max(sw / cw, sh / ch) * 1.02;
}

export default function FluxPdpTestimonial({onPinActiveChange}) {
  const sectionRef = useRef(null);
  const cardRef = useRef(null);
  const quoteRef = useRef(null);
  const photoRef = useRef(null);
  const onPinActiveChangeRef = useRef(onPinActiveChange);
  onPinActiveChangeRef.current = onPinActiveChange;

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const card = cardRef.current;
    const quote = quoteRef.current;
    if (!section || !card || !quote) return undefined;

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (reduceMotion) {
      // No SplitText — CSS full color on `.flux-pdp-quote__text`, no pin.
      onPinActiveChangeRef.current?.(false);
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
      gsap.set(card, {transformOrigin: '50% 50%', scale: 1, force3D: true});

      const reportPin = (active) => {
        section.classList.toggle('is-pinned', Boolean(active));
        onPinActiveChangeRef.current?.(Boolean(active));
      };

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=220%',
          pin: true,
          // Soft scrub syncs better with Lenis than scrub:true (less fight
          // when scrolling back through the pin).
          scrub: 0.45,
          anticipatePin: 1,
          fastScrollEnd: true,
          invalidateOnRefresh: true,
          scroller: getScrollRoot() ?? undefined,
          onToggle: (self) => reportPin(self.isActive),
        },
      });

      // Zoom card to fill the section (covers white/inset padding) on all viewports.
      tl.to(card, {
        scale: () => fillScaleFor(section, card),
        ease: 'none',
        duration: 0.35,
      });

      // Word fill: step colors only when the filled count changes — avoids
      // interpolating `color` on ~40 nodes every scroll frame (jank on reverse).
      const fill = {t: 0};
      let filledCount = 0;
      tl.to(fill, {
        t: 1,
        ease: 'none',
        duration: 0.5,
        onUpdate: () => {
          const next = Math.round(fill.t * words.length);
          if (next === filledCount) return;
          if (next > filledCount) {
            for (let i = filledCount; i < next; i += 1) {
              words[i].style.color = QUOTE_COLOR_FULL;
            }
          } else {
            for (let i = next; i < filledCount; i += 1) {
              words[i].style.color = QUOTE_COLOR_DIM;
            }
          }
          filledCount = next;
        },
      });

      tl.to(card, {
        scale: 1,
        ease: 'none',
        duration: 0.35,
      });
    }, section);

    const refresh = () => ScrollTrigger.refresh();
    requestAnimationFrame(refresh);

    // Card height is aspect-ratio based; refresh after the photo loads so
    // pin distance / fill scale aren't measured against an empty box.
    const photo = photoRef.current;
    if (photo && !photo.complete) {
      photo.addEventListener('load', refresh, {once: true});
    } else {
      requestAnimationFrame(refresh);
    }

    return () => {
      photo?.removeEventListener('load', refresh);
      section.classList.remove('is-pinned');
      onPinActiveChangeRef.current?.(false);
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
        <div ref={cardRef} className="flux-pdp-quote__card">
          <div className="flux-pdp-quote__media" aria-hidden="true">
            <img
              ref={photoRef}
              className="flux-pdp-quote__photo"
              src={founderPhoto}
              alt=""
              draggable={false}
            />
          </div>
          <blockquote className="flux-pdp-quote__copy">
            <div ref={quoteRef} className="flux-pdp-quote__text">
              {/* Divs (not <p>) so SplitText word wrappers stay valid HTML —
                  browsers hoist <div> out of <p> and break the scrub fill. */}
              <div>
                <span aria-hidden="true">“</span>
                {FOUNDER_QUOTE_P1}
              </div>
              <div>
                {FOUNDER_QUOTE_P2}
                <span aria-hidden="true">”</span>
              </div>
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
