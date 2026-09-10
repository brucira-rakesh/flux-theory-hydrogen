import {useMemo, useRef} from 'react';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import lifestylePhoto from '~/assets/pdp/reviews/lifestyle.png';
import starEmpty from '~/assets/pdp/reviews/star-empty.svg';

const TITLE_DURATION = 0.8;
const TITLE_STAGGER = 0.02;
const TITLE_SWEEP_BLUR = 5;

const HEADLINE = ['BE THE FIRST TO', 'SHARE YOUR FLUX.'];
const BODY =
  'Loved your experience? Tell us what you think and help others discover their new everyday ritual.';

/**
 * State 1 — no reviews yet (Figma PDP_Option band ~3108:3180 / 3110:3195).
 *
 * @param {{
 *   onWriteReview?: () => void,
 *   onStarClick?: (rating: number) => void,
 * }} props
 */
export default function FluxPdpReviewEmpty({
  onWriteReview,
  onStarClick,
}) {
  const sectionRef = useRef(null);

  const scrollTrigger = useMemo(
    () => ({
      trigger: sectionRef,
      start: 'top 80%',
      end: 'bottom top',
      toggleActions: 'play none none none',
    }),
    [],
  );

  const titleBlurSweep = useMemo(
    () => ({
      loop: 4,
      letter: 1.6,
      step: 0.09,
      blur: TITLE_SWEEP_BLUR,
      postReveal: 0.4,
    }),
    [],
  );

  return (
    <section
      ref={sectionRef}
      id="reviews"
      className="flux-pdp-reviews flux-pdp-reviews--empty"
      aria-label="Write a review"
    >
      <img
        className="flux-pdp-reviews__photo"
        src={lifestylePhoto}
        alt=""
        draggable={false}
      />
      <div className="flux-pdp-reviews__shell">
        <div className="flux-pdp-reviews__scrim" aria-hidden="true" />

        <div className="flux-pdp-reviews__content">
          <AnimatedTitle
            as="h2"
            className="flux-pdp-reviews__title"
            lines={HEADLINE}
            duration={TITLE_DURATION}
            stagger={TITLE_STAGGER}
            blurSweep={titleBlurSweep}
            scrollTrigger={scrollTrigger}
          />
          <p className="flux-pdp-reviews__body">{BODY}</p>
          <div
            className="flux-pdp-reviews__stars"
            role="group"
            aria-label="Rate this product"
          >
            {Array.from({length: 5}, (_, index) => {
              const value = index + 1;
              return (
                <button
                  key={value}
                  type="button"
                  className="flux-pdp-reviews__star-btn"
                  aria-label={`Rate ${value} star${value === 1 ? '' : 's'}`}
                  onClick={() => onStarClick?.(value)}
                >
                  <img
                    className="flux-pdp-reviews__star"
                    src={starEmpty}
                    alt=""
                    width={39}
                    height={39}
                    draggable={false}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="flux-pdp-reviews__cta"
            onClick={() => onWriteReview?.()}
          >
            Write a Review
          </button>
        </div>
      </div>
    </section>
  );
}
