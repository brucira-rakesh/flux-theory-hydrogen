// Home hero image sequences — extracted from ranbir-hero-autoplay.mp4 and
// hero-scroll-sequence.mp4 via ffmpeg + cwebp (native resolution), keeping
// every other extracted frame to halve total asset size.
// See src/assets/home-seq/{autoplay,scroll}.

function sortedFrameUrls(modules) {
  return Object.entries(modules)
    .sort(([pathA], [pathB]) => {
      const numA = Number(pathA.match(/(\d+)\.webp$/)?.[1] ?? 0);
      const numB = Number(pathB.match(/(\d+)\.webp$/)?.[1] ?? 0);
      return numA - numB;
    })
    .map(([, url]) => url);
}

const autoplayModules = import.meta.glob("../assets/home-seq/autoplay/*.webp", {
  eager: true,
  import: "default",
});
const scrollModules = import.meta.glob("../assets/home-seq/scroll/*.webp", {
  eager: true,
  import: "default",
});

export const AUTOPLAY_FRAME_URLS = sortedFrameUrls(autoplayModules);
export const SCROLL_FRAME_URLS = sortedFrameUrls(scrollModules);

export const AUTOPLAY_FRAME_COUNT = AUTOPLAY_FRAME_URLS.length;
export const SCROLL_FRAME_COUNT = SCROLL_FRAME_URLS.length;

/** Source video was 24fps; home-seq keeps every other extracted frame (halved
 *  file count/size), so playback runs at 12fps to preserve the original
 *  total duration. */
export const HOME_SEQ_FPS = 12;

export function getAutoplayFramePath(index) {
  const clamped = Math.max(0, Math.min(AUTOPLAY_FRAME_COUNT - 1, index));
  return AUTOPLAY_FRAME_URLS[clamped] ?? "";
}

export function getScrollFramePath(index) {
  const clamped = Math.max(0, Math.min(SCROLL_FRAME_COUNT - 1, index));
  return SCROLL_FRAME_URLS[clamped] ?? "";
}
