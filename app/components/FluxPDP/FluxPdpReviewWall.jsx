import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import arrowLeft from '~/assets/pdp/reviews/arrow-left.svg';
import arrowRight from '~/assets/pdp/reviews/arrow-right.svg';
import starFilled from '~/assets/pdp/reviews/star-filled.svg';
import {getAvatarProps} from '~/utils/avatar';

const TITLE_DURATION = 0.8;
const TITLE_STAGGER = 0.02;
const TITLE_SWEEP_BLUR = 5;

const HEADLINE = ['REAL PEOPLE.', 'REAL ROUTINES.'];

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

function ReviewerAvatar({name, photoUrl, className = ''}) {
  const rootClass = ['flux-pdp-review-wall__avatar', className]
    .filter(Boolean)
    .join(' ');

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={rootClass}
        width={61}
        height={61}
        draggable={false}
      />
    );
  }
  const {initials, background} = getAvatarProps(name);
  return (
    <div
      className={`${rootClass} flux-pdp-review-wall__avatar--initials`}
      style={{background}}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

function ReviewerBlock({name, rating, avatar}) {
  return (
    <div className="flux-pdp-review-wall__reviewer">
      <ReviewerAvatar name={name} photoUrl={avatar} />
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
              rating={column.reviewer.rating}
              avatar={column.reviewer.avatar}
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
 * State 2 — has reviews wall.
 * Desktop: Figma 3108:3066. Mobile: Figma 337:31 (summary stack + swipe cards).
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

  const stackReviewers = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const card of cards) {
      const name = card.reviewer?.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        name,
        avatar: card.reviewer.avatar ?? null,
      });
      if (list.length >= 5) break;
    }
    return list;
  }, [cards]);

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
              <div className="flux-pdp-review-wall__rating-block">
                <p className="flux-pdp-review-wall__rating">
                  <span className="flux-pdp-review-wall__rating-num">
                    {summary.rating}
                  </span>
                  <span className="flux-pdp-review-wall__rating-suffix">/5</span>
                </p>
                {/* Mobile (Figma 337:31): trust sits under the score. Hidden on
                    desktop where the avatar stack carries the same line. */}
                <p className="flux-pdp-review-wall__trust-line flux-pdp-review-wall__trust-line--mobile">
                  {summary.trust}
                </p>
              </div>
              <p className="flux-pdp-review-wall__summary-body">
                {summary.body}
              </p>
            </div>

            <div className="flux-pdp-review-wall__trust">
              {stackReviewers.length > 0 ? (
                <div className="flux-pdp-review-wall__avatar-stack">
                  {stackReviewers.map((reviewer) => (
                    <ReviewerAvatar
                      key={reviewer.name}
                      name={reviewer.name}
                      photoUrl={reviewer.avatar}
                      className="flux-pdp-review-wall__avatar--stack"
                    />
                  ))}
                </div>
              ) : null}
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

          <div className="flux-pdp-review-wall__grid-shell">
            <div className="flux-pdp-review-wall__grid" ref={gridRef}>
              {cards.map((column) => (
                <ReviewColumn key={column.id} column={column} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
