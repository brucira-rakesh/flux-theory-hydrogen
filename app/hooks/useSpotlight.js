import { useCallback, useEffect, useRef } from 'react'

const LERP = 0.14
const EPSILON = 0.001

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function getRadius(width) {
  return Math.min(220, Math.max(120, width * 0.12))
}

export function useSpotlight(containerRef, { disabled = false } = {}) {
  const targetRef = useRef({ x: 0.5, y: 0.55 })
  const currentRef = useRef({ x: 0.5, y: 0.55 })
  const rafRef = useRef(null)
  const radiusRef = useRef(160)
  const runTickRef = useRef(() => {})
  const scheduleTickRef = useRef(() => {})

  const applySpot = useCallback((x, y, radius) => {
    const el = containerRef.current
    if (!el) return

    const px = `${x * 100}%`
    const py = `${y * 100}%`
    const mask = `radial-gradient(circle ${radius}px at ${px} ${py}, #000 0%, #000 42%, transparent 72%)`

    el.style.setProperty('--spot-x', px)
    el.style.setProperty('--spot-y', py)
    el.style.setProperty('--spot-mask', mask)
  }, [containerRef])

  useEffect(() => {
    runTickRef.current = () => {
      const radius = radiusRef.current
      const target = targetRef.current
      let current = currentRef.current

      current = {
        x: current.x + (target.x - current.x) * LERP,
        y: current.y + (target.y - current.y) * LERP,
      }
      currentRef.current = current
      applySpot(current.x, current.y, radius)

      const dx = Math.abs(target.x - current.x)
      const dy = Math.abs(target.y - current.y)

      if (dx > EPSILON || dy > EPSILON) {
        rafRef.current = requestAnimationFrame(() => runTickRef.current())
        return
      }

      currentRef.current = target
      applySpot(target.x, target.y, radius)
      rafRef.current = null
    }

    scheduleTickRef.current = () => {
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => runTickRef.current())
      }
    }
  }, [applySpot])

  const setFromEvent = useCallback(
    (clientX, clientY) => {
      const el = containerRef.current
      if (!el || disabled) return

      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return

      radiusRef.current = getRadius(rect.width)
      targetRef.current = {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      }
      scheduleTickRef.current()
    },
    [containerRef, disabled],
  )

  const resetSpot = useCallback(() => {
    const el = containerRef.current
    radiusRef.current = getRadius(el?.clientWidth ?? 1200)
    targetRef.current = { x: 0.5, y: 0.55 }
    scheduleTickRef.current()
  }, [containerRef])

  useEffect(() => {
    if (disabled) return undefined

    const el = containerRef.current
    radiusRef.current = getRadius(el?.clientWidth ?? 1200)
    applySpot(currentRef.current.x, currentRef.current.y, radiusRef.current)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [applySpot, containerRef, disabled])

  return { setFromEvent, resetSpot }
}
