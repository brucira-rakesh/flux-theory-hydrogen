// Fetches a video file once, whole, and hands back an object URL for it.
//
// Everything the clip sequence does (see VideoPlaneV2's useClipReveal) assumes
// a seek is free: the loop is cued backwards so it wraps to its first frame at
// the cut, clips are re-cued to mirrored timestamps, parked scenes are rewound.
// Against a dev server on localhost that holds — the file is on disk and
// already complete, so `currentTime = x` lands on the next frame.
//
// Deployed it does not. A seek into a region the browser hasn't buffered
// issues an HTTP range request, and until it returns the element keeps
// presenting its LAST decoded frame — which a VideoTexture faithfully uploads.
// That is a stale frame sitting on the plane for as long as the round trip
// takes, at precisely the moment the cut needs the right one. Mid-clip stalls
// behave the same way, and deployed there are eight video elements plus the
// bottle GLBs competing for bandwidth, where locally there was no competition
// at all. It's the single biggest behavioural difference between the two, and
// it lands exactly where this feature is most sensitive.
//
// So the file is pulled down in full first and played from memory. Seeks then
// cost what they cost locally, and playback can't stall part way through.
// These are small (0.5-1.6MB each) and there are only a handful of distinct
// ones, so the memory is cheap next to the certainty.
const cache = new Map(); // url -> Promise<string> (object URL, or the original)

// Object URLs are deliberately never revoked: they're keyed by the module-
// level cache above, there are only ever a few, and they have to outlive any
// individual plane (several scenes share one file, and planes mount and
// unmount as the carousel turns). They live as long as the page, like the
// bundled asset URLs they stand in for.
// `priority` ('high' | 'low', the Fetch Priority API) only affects the FIRST
// caller for a given url — the fetch is already in flight for every caller
// after that, so there is nothing left for a later, differently-prioritized
// call to influence. Passed by Scene.v2.jsx's initially-front-most scene so
// its own loop/clip files win the scheduler over the other four scenes'
// (see this module's own comment on why there are several of these competing
// for bandwidth at once) — unsupported browsers just ignore the hint and get
// today's behaviour.
export function loadVideoObjectUrl(url, { priority } = {}) {
  if (!url) return Promise.resolve(url);
  const existing = cache.get(url);
  if (existing) return existing;

  const pending = fetch(url, priority ? { priority } : undefined)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status}`);
      return response.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    // Falling back to the plain URL keeps this a pure optimisation: if the
    // fetch is blocked or fails for any reason the video still plays, just
    // streamed the way it was before, rather than the plane going black.
    .catch(() => url);

  cache.set(url, pending);
  return pending;
}

// True when `time` is inside a buffered range, i.e. seeking there is a decode
// away rather than a network round trip. With the blob path above this is
// always true once the video has loaded; it's the guard for the fallback.
export function isBuffered(video, time) {
  if (!video) return false;
  const { buffered } = video;
  for (let i = 0; i < buffered.length; i++) {
    if (time >= buffered.start(i) && time <= buffered.end(i)) return true;
  }
  return false;
}
