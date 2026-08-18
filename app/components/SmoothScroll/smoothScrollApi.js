/**
 * Imperative bridge for non-React code (Scene.jsx) and shared scroll helpers.
 * The SmoothScroll provider registers the live Lenis instance on mount.
 */

let lenisInstance = null
const locks = new Set()
let wasStopped = false
let overflowHeld = false
let savedBodyOverflow = ''

function syncBodyOverflow() {
  if (typeof document === 'undefined') return
  const shouldHide = locks.size > 0
  if (shouldHide && !overflowHeld) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    overflowHeld = true
    return
  }
  if (!shouldHide && overflowHeld) {
    document.body.style.overflow = savedBodyOverflow
    savedBodyOverflow = ''
    overflowHeld = false
  }
}

function syncStopped() {
  syncBodyOverflow()
  if (!lenisInstance) return
  const shouldStop = locks.size > 0

  if (shouldStop) {
    if (!wasStopped) {
      lenisInstance.stop()
      wasStopped = true
    }
    return
  }

  if (!wasStopped) return

  // Only when transitioning stopped → running: resync Lenis to the real
  // window scroll so start() doesn't jump to a stale virtual position.
  const y = window.scrollY || window.pageYOffset || 0
  lenisInstance.scrollTo(y, { immediate: true })
  lenisInstance.start()
  wasStopped = false
}

export function registerLenis(instance) {
  lenisInstance = instance
  wasStopped = false
  if (instance) syncStopped()
}

export function getLenis() {
  return lenisInstance
}

export function isSmoothScrollActive() {
  return Boolean(lenisInstance) && locks.size === 0
}

/** Pause Lenis for a named owner (intro lock, carousel, drawer, …). */
export function acquireScrollLock(id) {
  if (!id) return
  if (locks.has(id)) return
  locks.add(id)
  syncStopped()
}

/** Release a named lock; Lenis restarts only when no locks remain. */
export function releaseScrollLock(id) {
  if (!id) return
  if (!locks.has(id)) return
  locks.delete(id)
  syncStopped()
}

export function getActiveScrollLocks() {
  return [...locks]
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__fluxScrollLocks = getActiveScrollLocks
}

/**
 * Scroll to an absolute Y. Uses Lenis when registered so virtual scroll stays
 * in sync; falls back to window.scrollTo otherwise.
 */
export function scrollToY(y, { immediate = true } = {}) {
  const top = Math.max(0, Number(y) || 0)
  if (lenisInstance) {
    lenisInstance.scrollTo(top, { immediate })
    return
  }
  if (immediate) window.scrollTo(0, top)
  else window.scrollTo({ top, behavior: 'smooth' })
}
