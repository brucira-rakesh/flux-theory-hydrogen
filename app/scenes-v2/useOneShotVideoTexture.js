import { useEffect, useMemo, useRef, useState } from "react";
import { loadVideoObjectUrl } from "./videoBlobCache";
import {
  createVideoTexture,
  installPlayFallback,
} from "./videoPlayFallback";
import { useLoaderManager } from "./useLoaderManager";

// Companion to useVideoPlaneTexture (the always-looping "center" video), for
// the ONE-SHOT clips each scene plays around it: the intro that runs as the
// scene swings into view, and the outro (the intro, reversed, built by
// scripts/make-outros.mjs) that runs as it swings out. See
// VideoPlaneV2's useClipSequence for the sequencing.
//
// Deliberately NOT refcount-shared by URL the way useVideoPlaneTexture is:
// every scene points at the same two files today, but during a single
// carousel step TWO scenes are on screen at once, each running its own clip
// at its own playhead — sharing one <video> would make them fight over it.
// One element per plane instead; each file is fetched once and served from
// the HTTP cache after that.
//
// Also unlike the loop hook: no autoplay, no watchdog, no `loop`. Playback
// here is driven entirely by the carousel's own progress (see VideoPlaneV2)
// — a watchdog that "helpfully" resumed a paused video would restart clips
// that are meant to be sitting parked on their first frame.
function createOneShotVideo() {
  const video = document.createElement("video");
  // See useVideoPlaneTexture's createVideo — same fallback-to-cross-origin-src
  // taint risk if loadVideoObjectUrl's blob fetch ever fails.
  video.crossOrigin = "anonymous";
  // Same muted-autoplay belt-and-suspenders as the loop hook: the property,
  // the IDL default, AND the content attribute, since this element never
  // goes through HTML parsing. play() is still gated on some browsers
  // without all three.
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.loop = false; // one-shot; the sequence decides when it runs
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  // Same hide as useVideoPlaneTexture — Safari Low Power Mode pauses
  // opacity:0 / 2px sources even when they're in the viewport. CSS box is
  // display-only; decode/upload still uses videoWidth x videoHeight.
  video.style.cssText =
    "position:fixed; top:0; left:0; width:16px; height:16px; opacity:0.02; transform:translateZ(0); pointer-events:none; z-index:-1;";
  video.setAttribute("aria-hidden", "true");
  document.body.appendChild(video);
  return video;
}

// Returns { texture, videoRef } for this plane's own private copy of `url`,
// parked on frame 0 and paused. Never suspends (same contract as
// useVideoPlaneTexture): `texture` is null until the effect has run, then a
// live VideoTexture. The element itself comes back through a REF rather than
// as a plain value — its playhead is driven every frame by the caller (see
// useClipSequence), which is exactly what a ref is for.
// `options.priority` ('high'/'low', Fetch Priority API) and
// `options.trackLoad` mirror useVideoPlaneTexture's own — see that hook's
// comment. Only the initially-front-most scene's clips pass them (see
// VideoPlaneV2), so its intro wins the scheduler over the other four scenes'
// and PreloaderV2 holds until it actually has a decoded first frame.
export function useOneShotVideoTexture(url, options = null) {
  const videoRef = useRef(null);
  const [texture, setTexture] = useState(null);
  const manager = useLoaderManager();
  const priority = options?.priority;
  const trackLoad = Boolean(options?.trackLoad);

  useEffect(() => {
    if (!url) return undefined;
    const video = createOneShotVideo();
    const videoTexture = createVideoTexture(video);
    const stopPlayback = installPlayFallback(video, videoTexture);
    // Source is attached only once the whole file is in memory (see
    // videoBlobCache) — every seek this clip's sequence performs has to be a
    // decode, never a network round trip, or the cut lands on a stale frame.
    let cancelled = false;
    loadVideoObjectUrl(url, { priority }).then((src) => {
      if (cancelled) return;
      video.src = src;
      video.load();
    });

    // Same "hold the preloader for this exact file" as useVideoPlaneTexture
    // — itemStart/End paired via `ended` so an early unmount can't leave the
    // manager waiting on a slot nothing will ever finish.
    let endLoadItem;
    if (trackLoad) {
      const itemId = `video:${url}`;
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        manager.itemEnd(itemId);
      };
      manager.itemStart(itemId);
      if (video.readyState >= 2) {
        end();
      } else {
        video.addEventListener("loadeddata", end, { once: true });
      }
      endLoadItem = () => {
        video.removeEventListener("loadeddata", end);
        end();
      };
    }
    // Nudge the first frame into the decoder immediately instead of waiting
    // for the first play(). The intro opens on a black frame that a waiting
    // scene sits on for a beat before playing (see INTRO_START_PRESENCE) —
    // that only reads as an intentional black screen if the decoder has
    // actually produced the frame.
    const primeFirstFrame = () => {
      if (video.currentTime === 0) video.currentTime = 0.0001;
    };
    video.addEventListener("loadeddata", primeFirstFrame, { once: true });
    videoRef.current = video;
    // Same shape as useVideoPlaneTexture's own state sync: a <video> element
    // and its VideoTexture are imperative, external objects that can only be
    // created here, and the texture has to reach React (it's a `map` prop) —
    // there's no way to do that without a setState from inside the effect
    // that made it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTexture(videoTexture);

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", primeFirstFrame);
      // Unmounting before 'loadeddata' still has to release the manager
      // slot, or the preloader waits forever on an item nobody will finish.
      endLoadItem?.();
      videoRef.current = null;
      stopPlayback();
      video.pause();
      video.remove();
      video.removeAttribute("src");
      video.load(); // releases the decoder / drops any in-flight fetch
      videoTexture.dispose();
      setTexture(null);
    };
    // priority/trackLoad/manager are set once per plane by the caller, same
    // as `url`'s own sibling deps elsewhere in this file — not meant to
    // re-run this create/destroy cycle on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return useMemo(() => ({ texture, videoRef }), [texture]);
}
