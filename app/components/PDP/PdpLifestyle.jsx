import { useMemo, useRef } from 'react'
import AnimatedTitle from '../AnimatedTitle/AnimatedTitle'
import AnimatedDescription from '../AnimatedDescription/AnimatedDescription'

const TITLE_DURATION = 0.8
const TITLE_STAGGER = 0.02
const DESC_DURATION = 0.55
const DESC_STAGGER = 0.045

/**
 * Letter-wave peak (px). Home / VideoHero use AnimatedTitle's default of 5.
 * 17 was the old parent rest-state, not a wave amplitude — with no parent
 * filter it would be a 17px dissolve on 96px type (~34px stacked before).
 * 5 matches the working Home wave; still visible on this larger title.
 */
const TITLE_SWEEP_BLUR = 5

/** Split title into two display lines when it isn't already an array. */
function titleLinesFrom(title) {
  if (Array.isArray(title)) return title
  const words = String(title ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length <= 2) return [words.join(' ')]
  const mid = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
}

/** One wrapping paragraph — do not split on periods into stacked lines. */
function blurbTextFrom(blurb) {
  if (Array.isArray(blurb)) return blurb.join(' ').trim()
  return String(blurb ?? '').trim()
}

export default function PdpLifestyle({ lifestyle }) {
  const sectionRef = useRef(null)
  const titleLines = useMemo(() => titleLinesFrom(lifestyle.title), [lifestyle.title])
  const blurbText = useMemo(() => blurbTextFrom(lifestyle.blurb), [lifestyle.blurb])

  const scrollTrigger = useMemo(
    () => ({
      trigger: sectionRef,
      start: 'top 80%',
      // Must end AFTER start in scroll order — short sections break with
      // `bottom bottom` and the blur wave never stays armed.
      end: 'bottom top',
      toggleActions: 'play none none none',
    }),
    [],
  )

  const titleBlurSweep = useMemo(
    () => ({
      loop: 4,
      letter: 1.6,
      step: 0.09,
      blur: TITLE_SWEEP_BLUR,
      postReveal: 0.4,
    }),
    [],
  )

  return (
    <section
      ref={sectionRef}
      className="pdp-lifestyle"
      aria-label={
        Array.isArray(lifestyle.title) ? lifestyle.title.join(' ') : lifestyle.title
      }
    >
      <div className="pdp-lifestyle__stage">
        <img
          src={lifestyle.banner}
          alt=""
          className="pdp-lifestyle__banner"
          draggable={false}
        />
        <img
          src={lifestyle.bottle}
          alt=""
          className="pdp-lifestyle__bottle"
          draggable={false}
        />
        <div className="pdp-lifestyle__copy">
          <AnimatedTitle
            as="h2"
            className="pdp-lifestyle__title"
            lines={titleLines}
            duration={TITLE_DURATION}
            stagger={TITLE_STAGGER}
            blurSweep={titleBlurSweep}
            scrollTrigger={scrollTrigger}
          />
          <AnimatedDescription
            className="pdp-lifestyle__blurb"
            delay={0.18}
            duration={DESC_DURATION}
            stagger={DESC_STAGGER}
            scrollTrigger={scrollTrigger}
          >
            {blurbText}
          </AnimatedDescription>
        </div>
      </div>
    </section>
  )
}
