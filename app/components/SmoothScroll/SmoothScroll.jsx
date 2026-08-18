import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useLocation } from 'react-router-dom'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import {
  acquireScrollLock,
  getLenis,
  registerLenis,
  releaseScrollLock,
  scrollToY,
} from './smoothScrollApi'
import 'lenis/dist/lenis.css'

gsap.registerPlugin(ScrollTrigger)

const SmoothScrollContext = createContext({
  lenis: null,
  scrollTo: scrollToY,
  acquire: acquireScrollLock,
  release: releaseScrollLock,
})

/**
 * Site-wide Lenis smooth scroll, driven from GSAP's ticker and synced to
 * ScrollTrigger. Named locks (intro, carousel, drawers) pause Lenis without
 * tearing down the instance.
 */
export default function SmoothScroll({ children }) {
  const location = useLocation()
  const lenisRef = useRef(null)

  useEffect(() => {
    if (prefersReducedMotion()) {
      registerLenis(null)
      return undefined
    }

    const lenis = new Lenis({
      autoRaf: false,
      anchors: true,
      // Touch keeps native feel; wheel gets light smoothing (not heavy lag).
      syncTouch: false,
      smoothWheel: true,
      wheelMultiplier: 1,
      // Short duration = less “catch-up” lag and fewer late ST updates.
      duration: 0.7,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      // Avoid micro-updates that fight ScrollTrigger pins.
      touchMultiplier: 1.5,
    })

    lenisRef.current = lenis
    registerLenis(lenis)

    const onScroll = () => ScrollTrigger.update()
    lenis.on('scroll', onScroll)

    const tick = (time) => {
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.off('scroll', onScroll)
      lenis.destroy()
      lenisRef.current = null
      registerLenis(null)
    }
  }, [])

  // Route changes: refresh trigger positions and Lenis measurements.
  useEffect(() => {
    const lenis = lenisRef.current
    const frame = window.requestAnimationFrame(() => {
      lenis?.resize()
      ScrollTrigger.refresh()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.pathname, location.search, location.hash])

  const acquire = useCallback((id) => acquireScrollLock(id), [])
  const release = useCallback((id) => releaseScrollLock(id), [])
  const scrollTo = useCallback((y, opts) => scrollToY(y, opts), [])

  const value = useMemo(
    () => ({
      lenis: lenisRef.current ?? getLenis(),
      scrollTo,
      acquire,
      release,
    }),
    [acquire, release, scrollTo],
  )

  return (
    <SmoothScrollContext.Provider value={value}>
      {children}
    </SmoothScrollContext.Provider>
  )
}

export function useSmoothScroll() {
  return useContext(SmoothScrollContext)
}

/** Keep Lenis stopped while `active` is true (drawers, menus, preloader). */
export function useSmoothScrollLock(id, active) {
  const { acquire, release } = useSmoothScroll()
  useEffect(() => {
    if (!id) return undefined
    if (active) {
      acquire(id)
      return () => release(id)
    }
    release(id)
    return undefined
  }, [id, active, acquire, release])
}
