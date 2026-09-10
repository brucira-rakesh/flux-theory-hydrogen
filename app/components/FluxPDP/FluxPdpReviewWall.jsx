import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import arrowLeft from '~/assets/pdp/reviews/arrow-left.svg';
import arrowRight from '~/assets/pdp/reviews/arrow-right.svg';
import avatarFallback1 from '~/assets/pdp/reviews/avatar-1.png';
import avatarFallback2 from '~/assets/pdp/reviews/avatar-2.png';
import avatarFallback3 from '~/assets/pdp/reviews/avatar-3.png';
import avatarFallback4 from '~/assets/pdp/reviews/avatar-4.png';
import avatarFallback5 from '~/assets/pdp/reviews/avatar-5.png';
import starFilled from '~/assets/pdp/reviews/star-filled.svg';

const TITLE_DURATION = 0.8;
const TITLE_STAGGER = 0.02;
const TITLE_SWEEP_BLUR = 5;

const HEADLINE = ['REAL PEOPLE.', 'REAL ROUTINES.'];

const FALLBACK_AVATARS = [
  avatarFallback1,
  avatarFallback2,
  avatarFallback3,
  avatarFallback4,
  avatarFallback5,
];

function StarRow({size = 12, count = 5, className = ''}) {
  return (
    <div className={className} role="img" aria-label={`${count} out of 5 stars`}>
      {Array.from({length: count}, (_, index) => (
        <img
          key={index}
          src={starFilled}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      ))}
    </div>
  );
}

function ReviewerBlock({name, avatar, rating}) {
  return (
    <div className="flux-pdp-review-wall__reviewer">
      <img
        className="flux-pdp-review-wall__avatar"
        src={avatar}
        alt=""
        width={61}
        height={61}
        draggable={false}
      />
      <div className="flux-pdp-review-wall__reviewer-meta">
        <p className="flux-pdp-review-wall__name">{name}</p>
        <StarRow
          size={12}
          count={rating}
          className="flux-pdp-review-wall__mini-stars"
        />
      </div>
    </div>
  );
}

function ReviewColumn({column}) {
  return (
    <div className="flux-pdp-review-wall__col">
      {column.order.map((slot) => {
        if (slot === 'reviewer') {
          return (
            <ReviewerBlock
              key={`${column.id}-reviewer`}
              name={column.reviewer.name}
              avatar={column.reviewer.avatar}
              rating={column.reviewer.rating}
            />
          );
        }
        if (slot === 'photo' && column.photo) {
          return (
            <div
              key={`${column.id}-photo`}
              className="flux-pdp-review-wall__photo-card"
            >
              <img src={column.photo} alt="" draggable={false} />
            </div>
          );
        }
        if (slot === 'quote' && column.quote) {
          return (
            <div
              key={`${column.id}-quote`}
              className="flux-pdp-review-wall__quote-card"
            >
              <p>{column.quote}</p>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * State 2 — has reviews wall (Figma frame 3108:3066).
 * Data comes from the product loader (Judge.me, server-side).
 *
 * @param {{
 *   summary: {rating: string, body: string, trust: string, avatars?: string[]},
 *   cards: Array<{
 *     id: string,
 *     order: Array<'reviewer' | 'photo' | 'quote'>,
 *     reviewer: {name: string, rating: number, avatar?: string | null},
 *     quote?: string | null,
 *     photo?: string | null,
 *   }>,
 *   onWriteReview?: () => void,
 * }} props
 */
export default function FluxPdpReviewWall({summary, cards, onWriteReview}) {
  const sectionRef = useRef(null);
  const gridRef = useRef(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

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

  const stackAvatars = [
    ...(summary.avatars ?? []),
    ...FALLBACK_AVATARS,
  ].slice(0, 5);

  const columns = cards.map((card, index) => ({
    ...card,
    reviewer: {
      ...card.reviewer,
      // Prefer Judge.me avatar; never use the review photo as a face avatar
      // (that caused a second broken/mis-cropped image in the header).
      avatar:
        card.reviewer.avatar ||
        FALLBACK_AVATARS[index % FALLBACK_AVATARS.length],
    },
  }));

  const cardKey = cards.map((card) => card.id).join('|');

  const measureScroll = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }
    const max = Math.max(0, grid.scrollWidth - grid.clientWidth);
    const left = grid.scrollLeft;
    setCanScrollPrev(left > 2);
    setCanScrollNext(left < max - 2);
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;

    measureScroll();

    const onScroll = () => measureScroll();
    grid.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('resize', measureScroll);

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measureScroll)
        : null;
    ro?.observe(grid);

    return () => {
      grid.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measureScroll);
      ro?.disconnect();
    };
  }, [measureScroll, cardKey]);

  const scrollByCard = (direction) => {
    const grid = gridRef.current;
    if (!grid) return;
    const sample = grid.querySelector('.flux-pdp-review-wall__col');
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap || '0') || 0;
    const step =
      sample instanceof HTMLElement
        ? sample.getBoundingClientRect().width + gap
        : grid.clientWidth * 0.75;
    grid.scrollBy({left: direction * step, behavior: 'smooth'});
  };

  return (
    <section
      ref={sectionRef}
      id="reviews"
      className="flux-pdp-review-wall"
      aria-label="Customer reviews"
    >
      <div className="flux-pdp-review-wall__inner">
        <div className="flux-pdp-review-wall__head">
          <AnimatedTitle
            as="h2"
            className="flux-pdp-review-wall__title"
            lines={HEADLINE}
            duration={TITLE_DURATION}
            stagger={TITLE_STAGGER}
            blurSweep={titleBlurSweep}
            scrollTrigger={scrollTrigger}
          />
          <div className="flux-pdp-review-wall__nav">
            <button
              type="button"
              className="flux-pdp-review-wall__nav-btn"
              aria-label="Previous reviews"
              disabled={!canScrollPrev}
              onClick={() => scrollByCard(-1)}
            >
              <img src={arrowLeft} alt="" width={12} height={8} />
            </button>
            <button
              type="button"
              className="flux-pdp-review-wall__nav-btn"
              aria-label="Next reviews"
              disabled={!canScrollNext}
              onClick={() => scrollByCard(1)}
            >
              <img src={arrowRight} alt="" width={12} height={8} />
            </button>
          </div>
        </div>

        <div className="flux-pdp-review-wall__rail">
          <aside className="flux-pdp-review-wall__summary">
            <div className="flux-pdp-review-wall__rating-row">
              <p className="flux-pdp-review-wall__rating">
                <span className="flux-pdp-review-wall__rating-num">
                  {summary.rating}
                </span>
                <span className="flux-pdp-review-wall__rating-suffix">/5</span>
              </p>
              <p className="flux-pdp-review-wall__summary-body">
                {summary.body}
              </p>
            </div>

            <div className="flux-pdp-review-wall__trust">
              <div className="flux-pdp-review-wall__avatar-stack">
                {stackAvatars.map((src, index) => (
                  <img
                    key={`${src}-${index}`}
                    src={src}
                    alt=""
                    width={39}
                    height={39}
                    draggable={false}
                  />
                ))}
              </div>
              <div className="flux-pdp-review-wall__trust-meta">
                <StarRow
                  size={12}
                  count={5}
                  className="flux-pdp-review-wall__mini-stars"
                />
                <p className="flux-pdp-review-wall__trust-line">
                  {summary.trust}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="flux-pdp-review-wall__cta"
              onClick={() => onWriteReview?.()}
            >
              Write a Review
            </button>
          </aside>

          <div className="flux-pdp-review-wall__grid" ref={gridRef}>
            {columns.map((column) => (
              <ReviewColumn key={column.id} column={column} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
