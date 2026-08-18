import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const REVEAL_SELECTOR = '[data-pdp-reveal]'

/**
 * GSAP motion for the PDP, gated with matchMedia prefers-reduced-motion.
 * - no-preference: scroll reveals + infinite marquee
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

      ScrollTrigger.refresh()

      return () => {
        marqueeTween?.kill()
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
