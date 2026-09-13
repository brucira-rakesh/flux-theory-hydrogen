import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { loadVideoObjectUrl } from "./videoBlobCache";
import {
  createVideoTexture,
  installPlayFallback,
} from "./videoPlayFallback";
import { useLoaderManager } from "./useLoaderManager";

// One real <video> per URL, shared by every VideoPlaneV2 that points at it.
// Homepage scenes each have their own loop file (see Scene.v2.jsx's SCENES);
// the refcount is still here so a shared URL wouldn't spawn two elements.
// Torn down once nothing references it anymore, instead of once per mesh.
const cache = new Map(); // url -> { video, texture, refCount }

// How often the watchdog checks whether playback has silently stopped (see
// startWatchdog below) — some browsers pause/throttle an off-screen video
// used only as a WebGL texture source without firing a 'pause' event we can
// listen for, which is what read as the video "getting stuck after a
// while." Cheap enough to just poll instead of chasing every browser's own
// (undocumented, inconsistent) throttling heuristic.
const WATCHDOG_INTERVAL_MS = 2000;

// Incoming loop stays parked on frame 0 until the scene has swung in this
// far (see VideoPlaneV2's presence). Outgoing keeps decoding past this until
// it actually hits BACK — pausing it at 0.3 would freeze a still-on-screen
// plane. Matches the "1 at rest, 2 only in the middle of a swing" target.
const PLAY_ABOVE = 0.3;
const BACK_EPS = 0.02;
const PRESENCE_EPS = 0.0005;

function createVideo(url, priority) {
  const video = document.createElement("video");
  // loadVideoObjectUrl falls back to this element's original (possibly
  // cross-origin, VITE_CDN_URL) `src` if its own same-origin-ish blob fetch
  // fails — without this, a VideoTexture sampled from that fallback taints
  // the WebGL context's texImage2D the same way an uncredentialed <img> does.
  video.crossOrigin = "anonymous";
  // Both the property AND the content attribute: some browsers only honor
  // muted-autoplay reliably when `muted` is present as an actual attribute
  // (not just the IDL property) on a video created via createElement, since
  // it's never gone through HTML parsing — belt and suspenders against a
  // silently-rejected play() call.
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  // Deliberately NOT autoplay. Playback is now owned entirely by
  // syncPlayback below, which starts a clip only while a scene that actually
  // shows it is on screen. Leaving autoplay on would have every cached clip
  // start decoding the moment its data lands — the exact thundering herd
  // this hook is being changed to avoid — and syncPlayback would then have
  // to chase each one back down. The `canplay`/`loadedmetadata` listeners in
  // the hook below call syncPlayback, so an active clip still starts as soon
  // as it possibly can; this only removes the unconditional start.
  video.preload = "auto";
  // Kept inside the actual viewport (top-left corner) rather than pushed
  // off-canvas — some browsers' "pause offscreen video" power-saving
  // heuristics key off viewport intersection, and a video parked miles
  // outside the viewport reads as exactly that, which is what likely caused
  // playback to silently stall after a while.
  //
  // Safari Low Power Mode additionally treats opacity:0 (and display:none /
  // visibility:hidden) as "not visible" and pauses the element even when it
  // intersects the viewport — that's InvisibleAutoplayNotPermitted, and the
  // watchdog's play() loses to it. A 16px box at opacity 0.02 is still a
  // painted, in-viewport renderer to WebKit, but z-index:-1 sits it behind
  // the page so it never shows. CSS size is display-only: VideoTexture
  // uploads from video.videoWidth/videoHeight, so this does not touch
  // decode resolution or plane quality.
  video.style.cssText =
    "position:fixed; top:0; left:0; width:16px; height:16px; opacity:0.02; transform:translateZ(0); pointer-events:none; z-index:-1;";
  video.setAttribute("aria-hidden", "true");
  // Attached to the document (invisible, but present) rather than kept
  // detached — autoplay/loop is unreliable on a video element that's never
  // actually in the DOM in some browsers. Same attrs VideoHeroV2 uses for
  // its own (visible) DOM <video>; display:none is avoided since some
  // browsers stop paying attention to (and pause) display:none media.
  document.body.appendChild(video);
  // Held back until the file is fully in memory (see videoBlobCache). This is
  // the video the clip reveal CUES — it seeks it backwards so it wraps to its
  // own first frame exactly as the intro hands over — and that only works if
  // seeking is free. Streaming it left that seek at the mercy of a range
  // request, which is why the cut was clean locally and not deployed.
  loadVideoObjectUrl(url, { priority }).then((src) => {
    video.src = src;
    video.load();
    // Through syncPlayback rather than a bare play(), so a clip whose scene
    // is nowhere near the screen stays paused once its data arrives.
    const entry = cache.get(url);
    if (entry) syncPlayback(entry);
  });
  return video;
}

// The single place that decides whether a clip should be running: playing
// while at least one mounted plane showing it is on screen, paused
// otherwise.
//
// Everything that used to force playback unconditionally now routes through
// here. Previously this hook fought every mechanism that could stop an
// off-screen video — a `pause` listener that instantly restarted it, a 2s
// watchdog that did the same, autoplay, and a hidden in-viewport element
// specifically to defeat the browser's own off-screen power saving. The
// result was every scene's clip decoding forever no matter what was on
// screen, and THREE.VideoTexture uploading a fresh frame for each
// one every render — measured at 4-6 concurrent decodes and ~110ms/frame of
// time outside our own JS (jsMs ~20 against frameMs ~130).
//
// Those mechanisms were all guarding something real — clips silently
// stalling, autoplay rejection before a user gesture — so none of them are
// removed, only made conditional: they still force playback back on, but
// only for a clip that is supposed to be playing.
function syncPlayback(entry) {
  if (!entry) return;
  const { video } = entry;
  if (entry.activeCount > 0) {
    if (video.ended) video.currentTime = 0;
    if (video.paused) video.play().catch(() => {});
  } else if (!video.paused) {
    video.pause();
    // VideoTexture stops copying once paused. One last upload so the plane
    // keeps the frozen frame instead of going black.
    entry.texture.needsUpdate = true;
  }
}

// Forces playback back on whenever it silently drops, from whatever cause —
// browser power-saving throttling, a missed 'loop' wrap on some codecs, a
// tab backgrounding/foregrounding cycle, anything. Belt-and-suspenders
// alongside the specific event listeners below.
function startWatchdog(entry) {
  const id = setInterval(() => {
    // Only ever resumes a clip that is SUPPOSED to be playing — syncPlayback
    // makes that call. Unconditionally, this was one of the mechanisms
    // keeping every off-screen clip decoding forever.
    syncPlayback(entry);
  }, WATCHDOG_INTERVAL_MS);
  return () => clearInterval(id);
}

function acquire(url, priority) {
  let entry = cache.get(url);
  if (!entry) {
    const video = createVideo(url, priority);
    const texture = createVideoTexture(video);
    // `activeCount` counts mounted planes currently SHOWING this clip, which
    // is a different question from `refCount` (planes that merely reference
    // it). A clip shared by several scene slots keeps playing as long as any
    // one of them is on screen.
    entry = {
      video,
      texture,
      stopWatchdog: null,
      stopPlayback: installPlayFallback(video, texture),
      refCount: 0,
      activeCount: 0,
    };
    entry.stopWatchdog = startWatchdog(entry);
    cache.set(url, entry);
  }
  entry.refCount += 1;
  return entry;
}

function parkAtStart(entry) {
  const { video } = entry;
  if (!video.paused) {
    video.pause();
    entry.texture.needsUpdate = true;
  }
  if (video.readyState >= 1 && video.currentTime > 0.001) {
    video.currentTime = 0;
    entry.texture.needsUpdate = true;
  }
}

function presenceOf(progressRef, sceneIndex) {
  const step = progressRef?.current?.step;
  if (typeof step !== "number") return 1;
  return THREE.MathUtils.clamp(1 - Math.abs(step - sceneIndex), 0, 1);
}

function setActive(url, isActive) {
  const entry = cache.get(url);
  if (!entry) return;
  entry.activeCount += isActive ? 1 : -1;
  if (entry.activeCount < 0) entry.activeCount = 0;
  syncPlayback(entry);
}

function release(url) {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.stopWatchdog();
    entry.stopPlayback?.();
    entry.video.pause();
    entry.video.remove();
    entry.texture.dispose();
    cache.delete(url);
  }
}

// Returns a shared THREE.VideoTexture for `url`, playing on loop and muted.
// Unlike drei's useVideoTexture this never suspends — the texture exists
// (and starts loading) synchronously, it just shows whatever frame is
// currently decoded (blank/black until the video has data), so callers don't
// need a Suspense boundary or a fallback mesh.
//
// `onScreen` is the coarse gate (section in view AND in visibleIndices).
// When `gate` is passed (progressRef + sceneIndex), playback is tighter:
// incoming holds frame 0 until presence > PLAY_ABOVE, outgoing keeps
// decoding until BACK. Without `gate`, onScreen alone is the vote — the
// old one-or-two-visibleIndices behaviour.
// `priority`/`trackLoad` (both optional, in a trailing options object): see
// this hook's call site in VideoPlaneV2.jsx for why only the scene resting
// at FRONT on first paint passes them. `priority` is a Fetch Priority API
// hint ('high'/'low') threaded down to loadVideoObjectUrl so that scene's own
// file wins the browser's scheduler over the other four, which start
// fetching at the exact same moment (see videoBlobCache.js's own comment on
// that contention). `trackLoad`, separately, registers a LoadingManager item
// that only ends once THIS video actually has a decodable first frame — see
// the effect below — so PreloaderV2 holds the boot screen for it instead of
// revealing a page whose hero video is still mid-fetch, which is what used
// to read as "the first scene lags, then it's fine" (every later view reuses
// videoBlobCache's already-resolved blob, so only the very first paint ever
// paid this cost, invisibly, behind the preloader).
export function useVideoPlaneTexture(url, onScreen = true, gate = null, options = null) {
  const [texture, setTexture] = useState(null);
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const playingRef = useRef(false);
  const directionRef = useRef(1);
  const lastPresenceRef = useRef(null);
  const manager = useLoaderManager();
  const priority = options?.priority;
  const trackLoad = Boolean(options?.trackLoad);

  useEffect(() => {
    const entry = acquire(url, priority);
    setTexture(entry.texture);

    // Hold the preloader open for THIS video specifically — not just its
    // metadata, its first actually-decodable frame (readyState >= 2,
    // HAVE_CURRENT_DATA), matching what 'loadeddata' fires on. itemStart/End
    // must be exactly paired (see ScenePrewarm's identical concern) or the
    // preloader hangs on a count that never completes, hence `ended`.
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
      if (entry.video.readyState >= 2) {
        end();
      } else {
        entry.video.addEventListener("loadeddata", end, { once: true });
      }
      endLoadItem = () => {
        entry.video.removeEventListener("loadeddata", end);
        end();
      };
    }

    // play() can reject (e.g. no user gesture yet on some browsers, even
    // when muted) — retry on every signal that playback state might have
    // changed, rather than trusting a single call at mount time. The
    // watchdog in acquire() catches anything these miss. These now go
    // through syncPlayback, so they resume a clip only while it's on
    // screen; as bare play() calls the `pause` one in particular made an
    // off-screen clip literally impossible to stop.
    const sync = () => syncPlayback(entry);
    entry.video.addEventListener("loadedmetadata", sync);
    entry.video.addEventListener("canplay", sync);
    entry.video.addEventListener("pause", sync);
    entry.video.addEventListener("ended", sync);
    document.addEventListener("visibilitychange", sync);
    // A rejected autoplay is commonly unblocked by the page's first real
    // user gesture — catch that case too instead of leaving the video
    // stuck paused for the rest of the session.
    document.addEventListener("pointerdown", sync, { once: true });

    // Presence-gated planes: if we already rest at FRONT, vote on
    // immediately so the first frame isn't a paused hold waiting on useFrame.
    if (gateRef.current && onScreenRef.current) {
      const { progressRef, sceneIndex } = gateRef.current;
      if (presenceOf(progressRef, sceneIndex) > PLAY_ABOVE) {
        playingRef.current = true;
        setActive(url, true);
      }
    }

    return () => {
      entry.video.removeEventListener("loadedmetadata", sync);
      entry.video.removeEventListener("canplay", sync);
      entry.video.removeEventListener("pause", sync);
      entry.video.removeEventListener("ended", sync);
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("pointerdown", sync);
      if (playingRef.current) {
        setActive(url, false);
        playingRef.current = false;
      }
      // Unmounting before 'loadeddata' still has to release the manager
      // slot, or the preloader waits forever on an item nobody will finish —
      // same reasoning as ScenePrewarm's own endPrewarm.
      endLoadItem?.();
      release(url);
    };
    // priority/trackLoad/manager are effectively static per plane (the
    // options object a caller passes is only ever set once, mirroring the
    // `gate` prop's own exclusion below) — re-running this whole acquire/
    // release cycle over an identity change would be wrong, not just wasted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Coarse path: visibleIndices membership. Presence path (useFrame) owns
  // the vote when a carousel gate is wired up, so we don't double-count.
  //
  // Gated planes still have to drop their vote the moment `onScreen` goes
  // false — the Canvas frameloop is parked when the section is far from
  // view (see Scene.v2), and useFrame never runs to pause. Same reason
  // VideoPlaneV2 rewinds intro/outro on `visible === false`.
  const gated = gate != null;
  useEffect(() => {
    if (gated) {
      if (!onScreen) {
        if (playingRef.current) {
          playingRef.current = false;
          setActive(url, false);
        }
        const entry = cache.get(url);
        if (entry) parkAtStart(entry);
      }
      return undefined;
    }
    setActive(url, onScreen);
    return () => setActive(url, false);
  }, [url, onScreen, gated]);

  useFrame(() => {
    if (!gateRef.current) return;
    const entry = cache.get(url);
    if (!entry) return;

    const { progressRef, sceneIndex } = gateRef.current;
    let play = false;
    let park = false;
    if (!onScreenRef.current) {
      park = true;
    } else {
      const presence = presenceOf(progressRef, sceneIndex);
      const previous = lastPresenceRef.current ?? presence;
      lastPresenceRef.current = presence;
      const dPresence = presence - previous;
      if (dPresence > PRESENCE_EPS) directionRef.current = 1;
      else if (dPresence < -PRESENCE_EPS) directionRef.current = -1;

      if (presence <= BACK_EPS) {
        park = true;
      } else if (presence > PLAY_ABOVE) {
        play = true;
      } else if (directionRef.current < 0) {
        // Outgoing, still on screen, not yet BACK — keep the last live
        // frames uploading. Incoming in this band holds frame 0.
        play = true;
      } else {
        park = true;
      }
    }

    if (play !== playingRef.current) {
      playingRef.current = play;
      setActive(url, play);
    }
    if (park) parkAtStart(entry);
  });

  return texture;
}
