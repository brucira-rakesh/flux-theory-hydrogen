import { useEffect } from 'react'
import { useLenis } from 'lenis/react'

/**
 * Freezes page scroll for as long as `locked` is true, then hands control back.
 *
 * Three layers, because each one alone leaves a way through:
 *  - a capture-phase input block on window — the only layer that actually
 *    holds. Lenis has its own window listener, and so does swingCarousel; both
 *    are bubble-phase, and swingCarousel calls `lenis.start()` on any tick that
 *    lands outside its own section (which is every tick while the intro hero is
 *    on screen), happily un-stopping a Lenis some other component deliberately
 *    stopped. Capture phase on window is the earliest point in the propagation
 *    path, so stopImmediatePropagation() there means neither of them ever sees
 *    the event. Same trick CloudTransition uses for its forward wipe.
 *  - `lenis.stop()` — Lenis's virtual scroll state is independent of the native
 *    one (a plain `window.scrollTo(0, 0)` doesn't touch it), so without this a
 *    tick that did get through would advance Lenis, and with it every
 *    ScrollTrigger reading off Lenis's tick.
 *  - `overflow: hidden` on html/body — stops native scrollbar drag, which
 *    reaches neither of the layers above. Note it does NOT stop Lenis: Lenis
 *    scrolls programmatically, and an overflow:hidden document still scrolls
 *    programmatically.
 *
 * Ref-counted at module scope: several components can hold the lock over
 * overlapping windows (e.g. a preloader's boot and an intro reel that outlasts
 * it) without restoring each other's saved overflow, or resuming Lenis while
 * another holder still wants it stopped. The saved styles are restored — and
 * Lenis resumed — only once the last holder lets go.
 */
let holders = 0
let savedHtmlOverflow = ''
let savedBodyOverflow = ''

/** Whether anything currently holds the scroll lock. Anyone who calls
 *  `lenis.start()` off its own bookkeeping has to check this first, or it will
 *  resume a Lenis that something else froze on purpose. */
export function isScrollLocked() {
  return holders > 0
}

const SCROLL_KEYS = new Set([
  ' ',
  'Spacebar',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
])

function isTextEntry(target) {
  if (!target || typeof target.tagName !== 'string') return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function blockInput(event) {
  if (holders === 0) return
  // Keys only — a blanket keydown block would swallow Tab/Escape and typing.
  if (event.type === 'keydown') {
    if (!SCROLL_KEYS.has(event.key) || isTextEntry(event.target)) return
  }
  if (event.cancelable) event.preventDefault()
  event.stopImmediatePropagation()
}

const BLOCKED_EVENTS = ['wheel', 'touchmove', 'keydown']

function acquire() {
  holders += 1
  if (holders > 1) return
  const html = document.documentElement
  const { body } = document
  savedHtmlOverflow = html.style.overflow
  savedBodyOverflow = body.style.overflow
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  for (const type of BLOCKED_EVENTS) {
    window.addEventListener(type, blockInput, { capture: true, passive: false })
  }
}

function release() {
  holders = Math.max(0, holders - 1)
  if (holders > 0) return
  document.documentElement.style.overflow = savedHtmlOverflow
  document.body.style.overflow = savedBodyOverflow
  for (const type of BLOCKED_EVENTS) {
    window.removeEventListener(type, blockInput, { capture: true })
  }
}

// Driven off the shared count rather than this consumer's own `locked` flag, so
// the last release is what resumes Lenis.
function syncLenis(lenis) {
  if (!lenis) return
  if (holders > 0) lenis.stop()
  else lenis.start()
}

export function useScrollLock(locked) {
  // The Lenis instance is created asynchronously by <ReactLenis> (in its own
  // mount effect, i.e. after this one on first render), so `lenis` is a real
  // dependency here — the stop has to be re-applied when the instance arrives,
  // not only when `locked` flips.
  const lenis = useLenis()

  useEffect(() => {
    if (!locked) {
      syncLenis(lenis)
      return undefined
    }
    acquire()
    syncLenis(lenis)
    return () => {
      release()
      syncLenis(lenis)
    }
  }, [lenis, locked])
}
