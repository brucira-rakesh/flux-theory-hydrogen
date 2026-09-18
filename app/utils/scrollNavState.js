/**
 * Shared with useSeawaveSeq's engage probe and CloudTransition's auto-wipe
 * triggers: both react to a scroll position/direction *crossing* their own
 * line, with no way to tell a user scrolling into that section apart from a
 * PageProgress rail jump that is only passing through on its way further
 * down the page. A tweened `lenis.scrollTo()` still fires every intermediate
 * Lenis tick, so without this those sections hijack the tween exactly as if
 * the user had scrolled there natively — stopping it at their own pin
 * instead of letting it reach the requested section.
 *
 * PageProgress sets `skippingSections` for the duration of a rail-driven
 * jump; the sections above skip their own crossing detection (but keep
 * updating their prev-position bookkeeping) while it's set, so a jump can
 * sail straight through them and they pick back up correctly, as "already
 * past", once it lands.
 */
export const scrollNavState = {
  skippingSections: false,
  /**
   * Installed by CloudTransition on mount (cleared on unmount). A rail jump
   * lands the page on the far side of the Seawave↔SceneV2 seam without ever
   * scrolling across it, so that component's own forward/reverse crossing
   * bookkeeping is left describing a position the page is no longer at — and
   * its forward trigger is still ARMED, which means the next downward scroll
   * replays the whole freeze/clouds/teleport wipe on top of wherever the rail
   * just put the user.
   *
   * Call this AFTER the jump has landed with whether the page is now on the
   * Seawave side (`true` — a later downward crossing should still play the
   * wipe) or already past it (`false`). It re-primes every prev-position ref
   * from the live marker, so neither direction misfires.
   */
  syncSeamAfterJump: null,
  /**
   * Installed by SeawaveSteam on mount (cleared on unmount). The intro
   * handoff's waterline sheet — the solid slab of TRANSITION_COLOR that
   * covers IntroHeroV2's pin as it hands over — is driven by IntroHeroV2's
   * ScrollTrigger on the way DOWN, and is only ever taken back off by the
   * reveal tween SeawaveSteam starts once Seawave ENGAGES.
   *
   * A rail jump from the top of the page skips that engage entirely: the
   * hero's trigger still runs to progress 1 as the page teleports past it
   * (so the sheet goes fully opaque), but nothing ever starts the reveal —
   * leaving a full-screen opaque sheet sitting over whatever the rail landed
   * on, which is what read as "the clouds part onto the wrong thing".
   *
   * Call this whenever the rail carries the page past Seawave (see
   * useSeawaveSeq's "story" target `leave()`): it asserts the handoff as
   * already finished — sheet gone, reveal at 1 — with no tween, since the
   * nav clouds are the wipe here.
   */
  completeIntroHandoff: null,
  /**
   * Installed by SeawaveSteam on mount (cleared on unmount); the mirror of
   * completeIntroHandoff, called by useSeawaveSeq's `exitUp()`.
   *
   * Scrolling back UP out of Seawave hands the page to IntroHeroV2, whose
   * pin becomes visible again as soon as its ScrollTrigger leaves progress
   * 1. But the waterline sheet is still finished from the descent (reveal
   * at 1, portal parked), and SeawaveSteam only rearms it once
   * `introTransitionProgressRef` drops back under 0.999 — which, because
   * that value is power3-eased, does not happen until ~21dvh further up.
   * For that whole stretch nothing opaque covers the top of the viewport:
   * the hero pops in bare, then the sheet snaps back over it. Both halves
   * of that read as one glitch.
   *
   * exitUp calls this in the same synchronous block as release(), so the
   * sheet is opaque again on the very frame the pin is uncovered.
   */
  rearmIntroHandoff: null,
  /**
   * Set by useSeawaveSeq's `exitUp()`; cleared by CloudTransition once the
   * seam marker has actually risen back above the forward trigger line.
   *
   * SeawaveSeq parks with its bottom edge ON that marker, so markerTop sits
   * at exactly AUTOPLAY_TRIGGER_MARKER_VH for its whole run — where natural
   * cloud coverage is already ~0.89. The only thing holding the wipe off
   * during Seawave is `!isScrollLocked()` in CloudTransition's cover branch.
   *
   * exitUp releases that lock while the page is STILL parked on the line
   * (the scroll away from it is a tween issued immediately after), so for
   * exactly one frame all of CloudTransition's cover conditions held and the
   * clouds painted a near-full white-out before the tween moved the marker
   * off the line. That was the one-frame white flash on the reverse handoff.
   *
   * This keeps coverage pinned at 0 across that gap — not on a timer, but
   * until the marker itself proves the page has moved.
   */
  suppressSeamCover: false,
  /**
   * 0..1, written by useSeawaveSeq's `paint()` across the last
   * SEAWAVE_HANDOFF_LEAD_FRAMES frames of the final forward run, read by
   * CloudTransition's render loop as a coverage FLOOR.
   *
   * CloudTransition otherwise forces coverage to 0 for as long as anything
   * holds the scroll lock (SeawaveSeq parks its pin right on the forward
   * trigger line, where natural coverage is already ~0.89 — see that guard).
   * That guard is what made the hand-off strictly sequential: the wipe could
   * not begin until Seawave had played every frame and released. This value
   * is the one sanctioned exception — a playhead-scrubbed ramp Seawave hands
   * the clouds so they gather over its own closing frames.
   *
   * Cleared by whichever side finishes the hand-off: CloudTransition when its
   * forward wipe actually fires (from there the auto-complete's own timeline
   * owns coverage), and useSeawaveSeq on every path that abandons the final
   * run — reverse re-entry, exitUp, reset, unmount.
   */
  seamLeadCover: 0,
  /**
   * Installed by CloudTransition on mount (cleared on unmount); called by
   * useSeawaveSeq when `seamLeadCover` first goes above 0.
   *
   * CloudTransition's GL loop is normally restarted from its Lenis tick
   * callback, which only runs on real scroll events — and Lenis is STOPPED
   * for the whole time Seawave holds the scroll lock, which is exactly when
   * the lead ramp needs painting. Without an explicit kick the loop stays
   * dead and the gather never appears.
   */
  startSeamCoverLoop: null,
};
