import { isOverlayWipeOpaque } from "../overlayWipeState";

/**
 * How far `progressRef.step` can sit off an integer and still count as
 * rest. Matches the "t ∈ (0.02, 0.98)" skip window from the smoothness
 * pass: mid-swing does not need N8AO or a fresh water reflection.
 */
export const REST_EPS = 0.02;

export function isCarouselResting(progressRef) {
  const step = progressRef?.current?.step ?? 0;
  return Math.abs(step - Math.round(step)) < REST_EPS;
}

/**
 * Heavy fullscreen passes (N8AO, planar water reflections) only earn
 * their keep on a settled frame the user can actually see.
 *
 * Frozen, not destroyed: the last reflection RT / AO pass stays allocated
 * so the first rest frame after a swing has something to show, not a hole.
 */
export function shouldRunHeavyPasses({ progressRef, handoffActiveRef } = {}) {
  // Opaque wipe only — not the whole auto.active window. Fade-OUT is
  // still partly covered and is the right time to refresh the frozen RT
  // so the first fully-visible rest frame isn't a black water hole.
  if (isOverlayWipeOpaque()) return false;
  if (handoffActiveRef?.current) return false;
  if (progressRef && !isCarouselResting(progressRef)) return false;
  return true;
}
