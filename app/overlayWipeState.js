/**
 * Live coverage of CloudTransition's Seawave↔bathroom wipe.
 *
 * Written every CloudTransition tick (and zeroed when that loop stops).
 * Read by overlay GL (SeawaveClouds / SeawaveSteam) so they can park
 * themselves under a fully white screen — no React, no extra rAF.
 *
 * `autoActive` / `consumeGesture` are also the carousel's "this wipe owns
 * the current flick" signal (see swingCarousel.js) — not for teleport
 * targets or trigger lines.
 */
export const overlayWipe = {
  cover: 0,
  autoActive: false,
  // Set by CloudTransition when a wipe finishes and the originating
  // gesture has already gone quiet — the next wheel tick is leftover
  // momentum, not a new scene request. Cleared by swingCarousel when it
  // swallows that tick.
  consumeGesture: false,
};

/** Shader guarantees an opaque core from ~0.72 (see CloudTransition's
 *  `max(density, smoothstep(0.72, 1.0, uProgress))`). 0.7 is "the user
 *  cannot see anything behind the wipe." */
export function isOverlayWipeOpaque() {
  return overlayWipe.cover >= 0.7;
}
