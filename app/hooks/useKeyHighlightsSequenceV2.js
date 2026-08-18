import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FRAME_COUNT,
  SCROLL_MULTIPLIER,
  getActiveHighlightIndex,
  getFramePath,
  getHighlightScrollProgress,
  getHighlightStartFrame,
} from '../data/highlights'
import {
  drawFrameContain,
  prefersReducedMotion,
  progressToFrame,
  progressToFrameFloat,
  setupCanvas,
} from '../utils/frameSequence'
import { createSequenceLoader } from '../utils/sequenceLoader'

// Lerp factor per frame at 60 fps — higher = snappier, lower = smoother.
// 0.12 gives a ~8-frame ease-out tail which reads as buttery without lag.
const LERP_FACTOR = 0.12
const BG_COLOR = '#d0d1db'

/**
 * V2 of useKeyHighlightsSequence — instead of the progressive
 * prefetch-around-playhead cache, this preloads the FULL frame sequence up
 * front (same `createSequenceLoader` PreloaderV2/IntroHeroV2 use) and holds
 * off wiring up scroll/draw entirely until every frame has loaded. `ready`
 * is exposed so the component can gate its own reveal on it too.
 */
export function useKeyHighlightsSequenceV2() {
  const sectionRef = useRef(null)
  const stickyRef = useRef(null)
  const visualRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)

  const loaderRef = useRef(null)
  const metricsRef = useRef({ top: 0, scrollable: 1 })
  const lastRenderedFrameRef = useRef(-1)
  const lastTargetFrameRef = useRef(-1)
  const currentFrameFloatRef = useRef(0)
  const activeIndexRef = useRef(0)
  const rafRef = useRef(null)
  const resizeRafRef = useRef(null)
  const canvasSizeRef = useRef({ width: 0, height: 0 })
  const inViewRef = useRef(false)
  const loopActiveRef = useRef(false)
  const startLoopRef = useRef(() => {})
  const lastTimestampRef = useRef(0)

  const [activeIndex, setActiveIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const isReducedMotion = useMemo(() => prefersReducedMotion(), [])
  const reducedMotionRef = useRef(isReducedMotion)

  // Full preload, gated the same way PreloaderV2 gates its own boot: nothing
  // downstream runs until every frame has settled.
  useEffect(() => {
    const loader = createSequenceLoader({ frameCount: FRAME_COUNT, getFramePath })
    loaderRef.current = loader
    let cancelled = false

    loader.preloadSequence().then(() => {
      if (!cancelled) setReady(true)
    })

    return () => {
      cancelled = true
      loaderRef.current = null
    }
  }, [])

  const updateMetrics = useCallback(() => {
    const section = sectionRef.current
    if (!section) return

    const rect = section.getBoundingClientRect()
    const viewport = window.innerHeight

    metricsRef.current = {
      top: window.scrollY + rect.top,
      scrollable: Math.max(1, section.offsetHeight - viewport),
      viewport,
    }
  }, [])

  const readScrollProgress = useCallback(() => {
    const { top, scrollable } = metricsRef.current
    const raw = (window.scrollY - top) / scrollable
    return Math.min(1, Math.max(0, raw))
  }, [])

  const drawFrame = useCallback((frameIndex, force = false) => {
    const canvas = canvasRef.current
    const loader = loaderRef.current
    if (!canvas || !loader) return

    const image = loader.getLoadedFrame(frameIndex)
    if (!image) return
    if (!force && frameIndex === lastRenderedFrameRef.current) return

    // Size the drawing buffer to the CSS-sized canvas (not the full stage).
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const needsResize =
      force ||
      !ctxRef.current ||
      canvasSizeRef.current.width !== cw ||
      canvasSizeRef.current.height !== ch

    if (needsResize) {
      const setup = setupCanvas(canvas, canvas, ctxRef)
      if (!setup) return
      canvasSizeRef.current = { width: setup.width, height: setup.height }
      lastRenderedFrameRef.current = -1
    }

    const ctx = ctxRef.current
    if (!ctx) return

    const { width, height } = canvasSizeRef.current
    const drew = drawFrameContain(ctx, image, width, height, BG_COLOR)
    if (drew) lastRenderedFrameRef.current = frameIndex
  }, [])

  const syncActiveIndex = useCallback((frame) => {
    const next = getActiveHighlightIndex(frame)
    if (next !== activeIndexRef.current) {
      activeIndexRef.current = next
      setActiveIndex(next)
    }
  }, [])

  const stopLoop = useCallback(() => {
    loopActiveRef.current = false
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const handleResize = useCallback(() => {
    if (resizeRafRef.current != null) return
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null
      updateMetrics()
      lastRenderedFrameRef.current = -1
      const progress = readScrollProgress()
      const frameFloat = progressToFrameFloat(progress)
      const frame = Math.round(frameFloat)
      currentFrameFloatRef.current = frameFloat
      drawFrame(frame, true)
      syncActiveIndex(frame)
    })
  }, [drawFrame, readScrollProgress, syncActiveIndex, updateMetrics])

  const handleScroll = useCallback(() => {
    if (!inViewRef.current) return
    startLoopRef.current()
  }, [])

  const scrollToHighlight = useCallback(
    (index) => {
      if (!ready) return

      if (reducedMotionRef.current) {
        const frame = getHighlightStartFrame(index)
        drawFrame(frame, true)
        syncActiveIndex(frame)
        return
      }

      updateMetrics()
      const { top, scrollable } = metricsRef.current
      const progress = getHighlightScrollProgress(index)
      const targetY = top + progress * scrollable
      window.scrollTo({ top: targetY, behavior: 'smooth' })
      startLoopRef.current()
    },
    [drawFrame, ready, syncActiveIndex, updateMetrics],
  )

  // Everything below only wires up once every frame has loaded.
  useEffect(() => {
    if (!ready) return undefined

    const motionReduced = isReducedMotion

    const startLoop = () => {
      if (loopActiveRef.current) return
      loopActiveRef.current = true
      lastTimestampRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    }

    startLoopRef.current = startLoop

    const tick = (timestamp) => {
      if (!loopActiveRef.current) return

      const dt = lastTimestampRef.current
        ? Math.min(timestamp - lastTimestampRef.current, 64)
        : 16.67
      lastTimestampRef.current = timestamp
      const alpha = 1 - Math.pow(1 - LERP_FACTOR, dt / 16.67)

      const progress = readScrollProgress()
      const targetFloat = progressToFrameFloat(progress)
      lastTargetFrameRef.current = Math.round(targetFloat)

      const prev = currentFrameFloatRef.current
      const next = prev + (targetFloat - prev) * alpha
      currentFrameFloatRef.current = next

      const frameIndex = Math.round(next)
      const settled = Math.abs(next - targetFloat) < 0.5

      if (frameIndex !== lastRenderedFrameRef.current) {
        drawFrame(frameIndex)
        syncActiveIndex(frameIndex)
      }

      // Keep lerping until settled — do NOT spin forever just because the
      // section is on-screen (that was burning a full rAF alongside WebGL).
      if (!settled) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      loopActiveRef.current = false
      rafRef.current = null
    }

    updateMetrics()

    const initialProgress = motionReduced ? 0 : readScrollProgress()
    const initialFloat = motionReduced ? 0 : progressToFrameFloat(initialProgress)
    const initialFrame = Math.round(initialFloat)
    currentFrameFloatRef.current = initialFloat
    lastTargetFrameRef.current = initialFrame
    syncActiveIndex(initialFrame)
    drawFrame(initialFrame, true)

    // Second pass after layout — first paint can run before .kh-visual has size.
    const layoutPass = requestAnimationFrame(() => {
      drawFrame(lastTargetFrameRef.current, true)
    })

    if (!motionReduced) {
      window.addEventListener('scroll', handleScroll, { passive: true })
    }

    window.addEventListener('resize', handleResize, { passive: true })

    const onVisibility = () => {
      if (document.hidden || motionReduced) return
      updateMetrics()
      const progress = readScrollProgress()
      const frame = progressToFrame(progress)
      lastTargetFrameRef.current = frame
      drawFrame(frame, true)
      syncActiveIndex(frame)
    }

    document.addEventListener('visibilitychange', onVisibility)

    let resizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize)
      if (visualRef.current) resizeObserver.observe(visualRef.current)
      if (sectionRef.current) resizeObserver.observe(sectionRef.current)
    }

    let intersectionObserver
    if (typeof IntersectionObserver !== 'undefined' && sectionRef.current) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          inViewRef.current = Boolean(entry?.isIntersecting)
          if (inViewRef.current && !motionReduced) {
            updateMetrics()
            // One sync pass when entering view; scroll events drive the loop.
            startLoop()
          } else if (!inViewRef.current) {
            stopLoop()
          }
        },
        { root: null, threshold: 0, rootMargin: '12% 0px' },
      )
      intersectionObserver.observe(sectionRef.current)
    }

    return () => {
      cancelAnimationFrame(layoutPass)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      stopLoop()
      if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current)
    }
  }, [
    ready,
    drawFrame,
    handleResize,
    handleScroll,
    readScrollProgress,
    stopLoop,
    syncActiveIndex,
    updateMetrics,
    isReducedMotion,
  ])

  return {
    sectionRef,
    stickyRef,
    visualRef,
    canvasRef,
    activeIndex,
    ready,
    reducedMotion: isReducedMotion,
    scrollMultiplier: isReducedMotion ? 1 : SCROLL_MULTIPLIER,
    scrollToHighlight,
  }
}
