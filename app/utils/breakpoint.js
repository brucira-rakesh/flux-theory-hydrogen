/**
 * One definition of "is this a desktop viewport", shared by the React hook
 * (hooks/useIsDesktop.js) and by the plain module-scope callers that pick a
 * frame-sequence variant at import time (data/homeSeq.js,
 * data/seawaveSequence.js).
 *
 * Mirrors Tailwind's default `lg` breakpoint (1024px), which is the same line
 * the page's own `lg:` / `lg:hidden` classes switch on — so the JS-side
 * branching can never disagree with the layout it sits inside.
 */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

/** SSR/no-window falls back to desktop — the larger asset set is the safe
 *  default when there's no viewport to measure. */
export function isDesktopViewport() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}
