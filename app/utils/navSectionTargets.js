/**
 * How a PageProgress rail click actually reaches a section.
 *
 * The three rail destinations are NOT scroll positions — they are states each
 * section enters through its own gesture/crossing detection:
 *
 *   * SeawaveSeq pins and starts playing only when its engage probe sees a
 *     genuine downward CROSSING of its own line (see useSeawaveSeq's probe:
 *     `prevScrollY < line && scrollY >= line`). Teleporting the page straight
 *     onto that line lands it already past, with prevScrollY updated to match,
 *     so the crossing is never observed — then or ever again.
 *   * The swing carousel's resting step lives in its own `stepRef`, adopted
 *     from scroll only on a false->true `inRange()` crossing seen inside a
 *     wheel/touch handler (see swingCarousel's updateRangeState).
 *   * Product's room doesn't exist at all until useSceneToProductHandoff's
 *     `trigger()` has run — reachable only via the carousel's onForwardEdge at
 *     its last step. Scrolling to product's range with that un-run leaves the
 *     room's materials at opacity 0 and its lights off.
 *
 * So each of those owners registers an imperative entry point here instead,
 * and PageProgress calls it at the exact moment NavCloudTransition's wipe
 * fully covers the frame — every swap below happens unseen.
 *
 * `enter()` puts the page AND the section's own state where the rail label
 * promises; returning false means "I can't right now" (e.g. product's assets
 * haven't loaded), and the caller falls back to a plain scroll.
 * `leave()` is called on every OTHER registered section first, so a section
 * that currently owns the screen (product's room swapped in, Seawave holding
 * the scroll lock) tears that down rather than being stranded.
 */
const targets = new Map();

/**
 * Which section, if any, is currently holding the scroll lock as a legitimate
 * part of its own nav-reachable state. PageProgress refuses to navigate while
 * scroll is locked (a lock holder owns the playhead — jumping out from under
 * it strands its ref count), but a section THIS module can cleanly `leave()`
 * is the one exception: without it, clicking "Our Story" would pin Seawave and
 * then leave the whole rail dead until the user scrubbed all 899 frames.
 */
let scrollOwner = null;

export function registerNavSectionTarget(id, handlers) {
  targets.set(id, handlers);
  return () => {
    if (targets.get(id) === handlers) targets.delete(id);
    if (scrollOwner === id) scrollOwner = null;
  };
}

export function setNavSectionScrollOwner(id) {
  scrollOwner = id;
}

export function clearNavSectionScrollOwner(id) {
  if (scrollOwner === id) scrollOwner = null;
}

/** True when the current scroll lock belongs to a section the rail can hand
 *  off cleanly — see `scrollOwner`. */
export function navSectionHoldsScroll() {
  return scrollOwner !== null;
}

/**
 * Tears down every section except `id`, then hands control to that section's
 * own entry point. Returns false if nothing is registered for `id` (or it
 * declined), so the caller can fall back to a plain scroll.
 */
export function enterNavSection(id) {
  targets.forEach((handlers, key) => {
    if (key !== id) handlers.leave?.();
  });
  const target = targets.get(id);
  if (!target?.enter) return false;
  return target.enter() !== false;
}
