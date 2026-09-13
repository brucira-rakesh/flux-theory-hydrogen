/**
 * Which element is actually scrolling.
 *
 * On desktop the page scrolls the document, exactly as it always has, and
 * every helper here falls through to the plain `window` API — so nothing about
 * the desktop scroll path changes.
 *
 * On mobile the document is frozen (`position: fixed` body, see index.css)
 * and scrolling moves into an inner container. That is the ONLY thing that
 * stops Chrome Android and iOS Safari from collapsing their URL bar on
 * scroll: both browsers hide their chrome in response to the ROOT scroller
 * moving, and neither exposes a way to opt out of it. With the root pinned,
 * the bar stays put — and, as a direct consequence, so does the viewport
 * height every `dvh`/`svh` box on the page is measured against, so nothing
 * resizes or jumps mid-scroll either.
 *
 * The cost is that `window.scrollY` reads 0 forever in that mode, so every
 * consumer that cares about scroll position has to come through here instead.
 * Geometry is unaffected: `getBoundingClientRect()` stays viewport-relative
 * and the container fills the viewport exactly, so every rect-based
 * measurement on the page (the Seawave engage probe, CloudTransition's seam
 * marker, the header-over-section test) keeps working untouched.
 */

/** CSS selector for the scroll container, shared with ScrollTrigger's
 *  `scroller` default (see HomeV2Page) — ScrollTrigger resolves it lazily
 *  when each trigger is created, which is what lets that default be set
 *  before the element exists. */
export const SCROLL_ROOT_SELECTOR = '[data-scroll-root]';

/**
 * Element mode is a plain FLAG, and the element itself is resolved lazily
 * from the selector on first use — deliberately, rather than registering a
 * node.
 *
 * React runs effects child-first, so every consumer below (useSeawaveSeq's
 * wiring, CloudTransition's setup) mounts and takes its first scroll reading
 * BEFORE the page component that owns the container gets an effect at all. A
 * registered node would still be null for all of them. A flag can be set
 * during the owner's render — ahead of its children rendering, let alone
 * mounting — while the lookup it implies is deferred until the DOM exists.
 */
let elementMode = false;
let cached = null;

/** Turn element scrolling on/off. Safe to call during render: it touches no
 *  DOM. Must be turned back off on unmount, or routes that scroll the
 *  document will keep resolving against a container that no longer exists. */
export function setElementScrollRoot(enabled) {
  elementMode = Boolean(enabled);
  if (!elementMode) cached = null;
}

/** The scrolling element, or null when the document itself scrolls.
 *  Re-queries if the cached node has been detached (route remount). */
export function getScrollRoot() {
  if (!elementMode) return null;
  if (!cached || !cached.isConnected) {
    cached = document.querySelector(SCROLL_ROOT_SELECTOR);
  }
  return cached;
}

/** Current scroll offset, from whichever scroller is active. */
export function getScrollY() {
  const scroller = getScrollRoot();
  return scroller ? scroller.scrollTop : window.scrollY;
}

/** Immediate, non-smooth jump. Used for the boot-time "force top of page"
 *  resets, which must not animate. */
export function scrollRootTo(y) {
  const scroller = getScrollRoot();
  if (scroller) {
    scroller.scrollTop = y;
    return;
  }
  window.scrollTo(0, y);
}

/** Smooth native scroll — only ever the fallback path for when Lenis hasn't
 *  been handed over yet; Lenis's own scrollTo knows about its wrapper and is
 *  preferred wherever an instance is available. */
export function scrollRootToSmooth(y) {
  const scroller = getScrollRoot();
  if (scroller) {
    scroller.scrollTo({ top: y, behavior: 'smooth' });
    return;
  }
  window.scrollTo({ top: y, behavior: 'smooth' });
}

/** The element whose `overflow` has to be frozen to hold scroll still —
 *  html/body when the document scrolls, the container when it doesn't.
 *  See useScrollLock. */
export function getScrollLockTargets() {
  const scroller = getScrollRoot();
  if (scroller) return [scroller];
  return [document.documentElement, document.body];
}
