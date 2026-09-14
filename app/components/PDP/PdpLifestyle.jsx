import { useMemo, useRef, useSyncExternalStore } from 'react'
import AnimatedTitle from '../AnimatedTitle/AnimatedTitle'
import AnimatedDescription from '../AnimatedDescription/AnimatedDescription'
import PdpAutoplayVideo from './PdpAutoplayVideo'

const MOBILE_LIFESTYLE_MQ = '(max-width: 640px)'

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

function LifestyleBackground({ banner, video, label }) {
  if (video?.length) {
    return (
      <PdpAutoplayVideo
        sources={video}
        poster={banner || undefined}
        className="pdp-lifestyle__banner pdp-lifestyle__video"
        ariaLabel={label}
        preferProgressiveMax
      />
    )
  }

  return (
    <img
      src={banner}
      alt=""
      className="pdp-lifestyle__banner"
      draggable={false}
    />
  )
}

/** Mobile ≤640px uses mobile_media when populated; otherwise desktop background_media. */
function resolveLifestyleBackground(lifestyle, isMobile) {
  const hasMobileMedia = Boolean(
    lifestyle.mobileVideo?.length || lifestyle.mobileBanner,
  )

  if (isMobile && hasMobileMedia) {
    if (lifestyle.mobileVideo?.length) {
      return {
        banner: lifestyle.mobileBanner ?? lifestyle.banner,
        video: lifestyle.mobileVideo,
      }
    }
    return {
      banner: lifestyle.mobileBanner ?? lifestyle.banner,
      video: null,
    }
  }

  return {
    banner: lifestyle.banner,
    video: lifestyle.video,
  }
}

function subscribeMobileLifestyle(onStoreChange) {
  const mq = window.matchMedia(MOBILE_LIFESTYLE_MQ)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getMobileLifestyleSnapshot() {
  return window.matchMedia(MOBILE_LIFESTYLE_MQ).matches
}

/** SSR + hydration must match — always desktop until after mount. */
function getMobileLifestyleServerSnapshot() {
  return false
}

export default function PdpLifestyle({ lifestyle, sectionRef: sectionRefProp }) {
  const sectionRef = useRef(null)
  // useSyncExternalStore: server snapshot is always `false` so hydration
  // matches SSR desktop media; client then switches to mobile when ≤640px.
  // Reading matchMedia in useState() caused poster/source mismatches.
  const isMobile = useSyncExternalStore(
    subscribeMobileLifestyle,
    getMobileLifestyleSnapshot,
    getMobileLifestyleServerSnapshot,
  )

  const background = useMemo(
    () => resolveLifestyleBackground(lifestyle, isMobile),
    [lifestyle, isMobile],
  )
  const titleLines = useMemo(() => titleLinesFrom(lifestyle.title), [lifestyle.title])
  const blurbText = useMemo(() => blurbTextFrom(lifestyle.blurb), [lifestyle.blurb])
  const hasVideo = Boolean(background.video?.length)
  const sectionLabel = Array.isArray(lifestyle.title)
    ? lifestyle.title.join(' ')
    : lifestyle.title

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
      ref={(node) => {
        sectionRef.current = node
        if (sectionRefProp) sectionRefProp.current = node
      }}
      className="pdp-lifestyle"
      aria-label={sectionLabel}
    >
      <div className="pdp-lifestyle__stage">
        <LifestyleBackground
          banner={background.banner}
          video={background.video}
          label={sectionLabel}
        />
        {/* Bottle overlay only for static image backgrounds — skip when video */}
        {!hasVideo && lifestyle.bottle ? (
          <img
            src={lifestyle.bottle}
            alt=""
            className="pdp-lifestyle__bottle"
            draggable={false}
          />
        ) : null}
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
