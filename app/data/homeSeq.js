// Home hero image sequences — extracted from ranbir-hero-autoplay.mp4 and
// hero-scroll-sequence.mp4 via ffmpeg + cwebp (native resolution), keeping
// every other extracted frame to halve total asset size.
// See src/assets/home-seq/{autoplay,scroll}.
//
// ---------------------------------------------------------------------------
// SWAPPING IN A MOBILE-SPECIFIC RENDER
// ---------------------------------------------------------------------------
// Drop portrait .webp frames into src/assets/home-seq/autoplay-mobile/ and
// src/assets/home-seq/scroll-mobile/ and they are picked up automatically —
// no code change needed. Rules:
//
//   * Frames sort by the trailing number in the filename (…_00042.webp), the
//     same as the desktop sets, so any zero-padded numbering works.
//   * A mobile folder that is EMPTY falls back to the desktop frames, so the
//     two sets can be added independently (mobile autoplay first, mobile
//     scroll later) without either half breaking.
//   * The two sets do NOT have to be the same length — everything downstream
//     reads AUTOPLAY_FRAME_COUNT / SCROLL_FRAME_COUNT, which resolve per
//     variant, and the scrub itself maps normalised scroll progress across
//     whatever count is active (see IntroHeroV2's SCRUB_FRACTION).
//     ONE number does not survive a length change on its own, though:
//     IntroHeroV2's TRANSITION_START_FRAME (the scroll frame the waterline
//     starts rising on) is an absolute index into the DESKTOP scroll set. It
//     is divided by SCROLL_FRAME_COUNT - 1, so a shorter/longer mobile set
//     still produces a valid fraction rather than breaking — but it will land
//     on a different visual moment. Re-check it against the mobile render.
//   * HOME_SEQ_FPS applies to whichever autoplay set is active, so a mobile
//     reel with a different frame count plays for a different duration. If
//     the mobile reel should last the same wall-clock time as the desktop
//     one, match its frame count or give it its own fps here.
//
// The variant is resolved ONCE at module load, from the viewport width at
// that moment (see utils/breakpoint.js). Crossing the breakpoint later —
// desktop window resized narrow, say — does not hot-swap the frames; that
// would mean re-downloading and re-decoding a whole sequence mid-scroll. A
// reload picks up the other set.
// ---------------------------------------------------------------------------

import { isDesktopViewport } from '../utils/breakpoint';

function sortedFrameUrls(modules) {
  return Object.entries(modules)
    .sort(([pathA], [pathB]) => {
      const numA = Number(pathA.match(/(\d+)\.webp$/)?.[1] ?? 0);
      const numB = Number(pathB.match(/(\d+)\.webp$/)?.[1] ?? 0);
      return numA - numB;
    })
    .map(([, url]) => url);
}

// Vite parses these statically, so the options MUST be an inline object
// literal at every call site — hoisting them into a shared const fails the
// build with "Expected the second argument to be an object literal".
const autoplayModules = import.meta.glob('../assets/home-seq/autoplay/*.webp', {
  eager: true,
  import: 'default',
});
const scrollModules = import.meta.glob('../assets/home-seq/scroll/*.webp', {
  eager: true,
  import: 'default',
});
const autoplayMobileModules = import.meta.glob(
  '../assets/home-seq/autoplay-mobile/*.webp',
  { eager: true, import: 'default' },
);
const scrollMobileModules = import.meta.glob(
  '../assets/home-seq/scroll-mobile/*.webp',
  { eager: true, import: 'default' },
);

const USE_MOBILE_SEQ = !isDesktopViewport();

/** Mobile frames when we're on a mobile viewport AND that set actually has
 *  frames in it; desktop frames otherwise. */
function pickVariant(desktopModules, mobileModules) {
  const mobile = USE_MOBILE_SEQ ? sortedFrameUrls(mobileModules) : [];
  return mobile.length > 0 ? mobile : sortedFrameUrls(desktopModules);
}

export const AUTOPLAY_FRAME_URLS = pickVariant(
  autoplayModules,
  autoplayMobileModules,
);
export const SCROLL_FRAME_URLS = pickVariant(
  scrollModules,
  scrollMobileModules,
);

export const AUTOPLAY_FRAME_COUNT = AUTOPLAY_FRAME_URLS.length;
export const SCROLL_FRAME_COUNT = SCROLL_FRAME_URLS.length;

/** True when either hero sequence above actually resolved to its mobile
 *  variant — exported for debugging/logging, nothing branches on it. */
export const HOME_SEQ_IS_MOBILE =
  USE_MOBILE_SEQ &&
  (Object.keys(autoplayMobileModules).length > 0 ||
    Object.keys(scrollMobileModules).length > 0);

/** Source video was 24fps; home-seq keeps every other extracted frame (halved
 *  file count/size), so playback runs at 12fps to preserve the original
 *  total duration. */
export const HOME_SEQ_FPS = 12;

export function getAutoplayFramePath(index) {
  const clamped = Math.max(0, Math.min(AUTOPLAY_FRAME_COUNT - 1, index));
  return AUTOPLAY_FRAME_URLS[clamped] ?? '';
}

export function getScrollFramePath(index) {
  const clamped = Math.max(0, Math.min(SCROLL_FRAME_COUNT - 1, index));
  return SCROLL_FRAME_URLS[clamped] ?? '';
}
