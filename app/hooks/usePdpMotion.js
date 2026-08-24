import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const REVEAL_SELECTOR = '[data-pdp-reveal]'
/** Side-by-side details layout — matches ProductPage.css `@media (max-width: 960px)`. */
const DETAILS_PARALLAX_MQ = '(min-width: 961px)'
/**
 * Directional parallax travel (px). Section entering → y start (image sits high);
 * section exiting → y end (image lags downward vs accordion text). Total 140px.
 */
const DETAILS_BOTTLE_PARALLAX_START = -70
const DETAILS_BOTTLE_PARALLAX_END = 70

function scheduleDetailsParallaxRefresh() {
  requestAnimationFrame(() => ScrollTrigger.refresh())
  window.setTimeout(() => ScrollTrigger.refresh(), 120)
  window.setTimeout(() => ScrollTrigger.refresh(), 750)
}

/**
 * Scroll-scrub parallax on the Product Details bottle (desktop side-by-side only).
 * @returns {(() => void) | undefined} cleanup
 */
function setupDetailsBottleParallax(detailsSection, detailsBottle) {
  gsap.set(detailsBottle, { y: DETAILS_BOTTLE_PARALLAX_START, force3D: true })

  const tween = gsap.to(detailsBottle, {
    y: DETAILS_BOTTLE_PARALLAX_END,
    ease: 'none',
    scrollTrigger: {
      trigger: detailsSection,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      invalidateOnRefresh: true,
    },
  })

  scheduleDetailsParallaxRefresh()

  const refreshAfterImage = () => ScrollTrigger.refresh()
  if (detailsBottle.complete) {
    requestAnimationFrame(refreshAfterImage)
  } else {
    detailsBottle.addEventListener('load', refreshAfterImage, { once: true })
  }

  return () => {
    detailsBottle.removeEventListener('load', refreshAfterImage)
    tween.scrollTrigger?.kill()
    tween.kill()
    gsap.set(detailsBottle, { clearProps: 'transform' })
  }
}

/**
 * GSAP motion for the PDP, gated with matchMedia prefers-reduced-motion.
 * - no-preference: scroll reveals + infinite marquee + details-bottle parallax (desktop)
 * - reduce: instant final states, marquee frozen, CSS motion class applied
 */
export function usePdpMotion(pageRef, { enabled = true, replayKey } = {}) {
  useEffect(() => {
    if (!enabled) return undefined

    const page = pageRef.current
    if (!page) return undefined

    const mm = gsap.matchMedia()

    // Only create motion when the user has no reduced-motion preference.
    // When the query stops matching (or reduce is on), GSAP reverts automatically.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      page.classList.remove('pdp-page--reduce-motion')

      const reveals = gsap.utils.toArray(page.querySelectorAll(REVEAL_SELECTOR))

      reveals.forEach((el) => {
        const y = Number(el.dataset.pdpRevealY ?? 28)
        gsap.from(el, {
          opacity: 0,
          y,
          duration: 0.7,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        })
      })

      const marqueeTrack = page.querySelector('.pdp-marquee__track')
      let marqueeTween
      if (marqueeTrack) {
        const distance = marqueeTrack.scrollWidth / 3
        gsap.set(marqueeTrack, { x: 0 })
        marqueeTween = gsap.to(marqueeTrack, {
          x: -distance,
          duration: 28,
          ease: 'none',
          repeat: -1,
        })
      }

      // Product Details bottle — directional scroll-scrub parallax beside the accordion.
      const detailsSection = page.querySelector('.pdp-details')
      const detailsBottle = detailsSection?.querySelector('[data-pdp-details-bottle]')
      let detailsParallaxMm
      let cleanupDetailsParallax
      if (detailsSection && detailsBottle) {
        detailsParallaxMm = gsap.matchMedia()
        detailsParallaxMm.add(DETAILS_PARALLAX_MQ, () => {
          cleanupDetailsParallax = setupDetailsBottleParallax(detailsSection, detailsBottle)
          return () => {
            cleanupDetailsParallax?.()
            cleanupDetailsParallax = undefined
          }
        })
      }

      scheduleDetailsParallaxRefresh()

      return () => {
        marqueeTween?.kill()
        detailsParallaxMm?.revert()
      }
    })

    mm.add('(prefers-reduced-motion: reduce)', () => {
      page.classList.add('pdp-page--reduce-motion')
      return () => {
        page.classList.remove('pdp-page--reduce-motion')
      }
    })

    return () => {
      mm.revert()
      page.classList.remove('pdp-page--reduce-motion')
    }
  }, [pageRef, enabled, replayKey])
}
