import * as THREE from "three";

// Safari (and every iOS browser) in Low Power Mode rejects HTMLMediaElement.play()
// until a real user gesture — wheel/scroll does not count, and we cannot synthesize
// one. Paused seeks still work: the decoder will produce a frame for currentTime
// without entering the "playing" media-session state. This module hijacks play() /
// pause() / paused so existing clip-sequence code keeps working, and advances the
// playhead from rAF when native play is blocked.
//
// On Apple WebKit the texture is a 1:1 CanvasTexture blitted from the video
// (paused-video → VideoTexture uploads are unreliable). Decode resolution is
// unchanged — canvas width/height track videoWidth/videoHeight, no scale.

const currentTimeDesc = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "currentTime",
);
const pausedDesc = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "paused",
);
const endedDesc = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "ended",
);

export function isAppleWebKit() {
  return (
    typeof navigator !== "undefined" &&
    navigator.vendor === "Apple Computer, Inc."
  );
}

export function createVideoTexture(video) {
  const texture = isAppleWebKit()
    ? makeCanvasTexture(video)
    : new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.video = video;
  return texture;
}

function makeCanvasTexture(video) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.userData.canvas = canvas;
  texture.userData.ctx = ctx;
  // Prime width from metadata so the plane can size itself before the first blit.
  const onMeta = () => {
    if (video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.imageSmoothingEnabled = false;
    }
  };
  video.addEventListener("loadedmetadata", onMeta);
  texture.userData.dropMeta = () =>
    video.removeEventListener("loadedmetadata", onMeta);
  return texture;
}

export function mediaOf(texture) {
  return texture?.userData?.video ?? texture?.image ?? null;
}

export function installPlayFallback(video, texture) {
  if (video.dataset.playFallback === "1") return () => {};
  video.dataset.playFallback = "1";

  const nativePlay = video.play.bind(video);
  const nativePause = video.pause.bind(video);
  const nativePaused = () => pausedDesc.get.call(video);
  const canvas = texture.userData.canvas;
  const ctx = texture.userData.ctx;

  const clock = {
    running: false,
    finished: false,
    expected: 0,
    lastTs: 0,
  };
  let pumpRaf = null;
  let playGen = 0;

  function blit() {
    if (!ctx || !canvas) {
      texture.needsUpdate = true;
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = false;
    }
    ctx.drawImage(video, 0, 0, w, h);
    texture.needsUpdate = true;
  }

  video.addEventListener("seeked", blit);
  video.addEventListener("loadeddata", blit);

  function showing() {
    return clock.running || !nativePaused();
  }

  function advanceClock(now) {
    if (!clock.running) return;
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const dt = Math.min(0.1, (now - clock.lastTs) / 1000);
    clock.lastTs = now;
    let next = clock.expected + dt * (video.playbackRate || 1);
    if (video.loop) {
      next %= duration;
      if (next < 0) next += duration;
    } else if (next >= duration) {
      next = duration;
      clock.running = false;
      clock.finished = true;
      currentTimeDesc.set.call(video, next);
      blit();
      video.dispatchEvent(new Event("ended"));
      return;
    }
    clock.expected = next;
    currentTimeDesc.set.call(video, next);
  }

  function pump(now) {
    if (!showing()) {
      pumpRaf = null;
      return;
    }
    pumpRaf = requestAnimationFrame(pump);
    advanceClock(now);
    blit();
  }

  function ensurePump() {
    if (pumpRaf == null) {
      clock.lastTs = performance.now();
      pumpRaf = requestAnimationFrame(pump);
    }
  }

  function startClock() {
    clock.finished = false;
    if (!clock.running) {
      clock.running = true;
      clock.expected = currentTimeDesc.get.call(video);
      clock.lastTs = performance.now();
    }
    ensurePump();
  }

  function stopClock() {
    clock.running = false;
  }

  video.play = function playWithFallback() {
    const gen = ++playGen;
    clock.finished = false;
    let pending;
    try {
      pending = nativePlay();
    } catch {
      startClock();
      return Promise.resolve();
    }
    if (pending && typeof pending.then === "function") {
      // LPM rejects asynchronously (and sometimes never). Don't wait on it.
      const fallback = window.setTimeout(() => {
        if (gen !== playGen) return;
        if (nativePaused()) startClock();
      }, 0);
      return pending.then(
        () => {
          if (gen !== playGen) return;
          window.clearTimeout(fallback);
          stopClock();
          // Canvas path still has to copy frames — rvfc won't.
          if (ctx) ensurePump();
        },
        () => {
          if (gen !== playGen) return;
          window.clearTimeout(fallback);
          startClock();
        },
      );
    }
    if (nativePaused()) startClock();
    else if (ctx) ensurePump();
    return Promise.resolve();
  };

  video.pause = function pauseWithFallback() {
    playGen += 1;
    stopClock();
    nativePause();
    if (pumpRaf != null) {
      cancelAnimationFrame(pumpRaf);
      pumpRaf = null;
    }
  };

  try {
    Object.defineProperty(video, "paused", {
      configurable: true,
      enumerable: true,
      get() {
        if (clock.running) return false;
        return nativePaused();
      },
    });
    Object.defineProperty(video, "ended", {
      configurable: true,
      enumerable: true,
      get() {
        if (clock.finished) return true;
        if (clock.running) return false;
        return endedDesc.get.call(video);
      },
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      enumerable: true,
      get() {
        return currentTimeDesc.get.call(video);
      },
      set(value) {
        clock.expected = value;
        if (value < (video.duration || Infinity) - 0.0001) clock.finished = false;
        currentTimeDesc.set.call(video, value);
        // Seek while paused (park, cue, rewind) still has to land on the
        // canvas — VideoTexture would have done this via needsUpdate.
        blit();
      },
    });
  } catch {
    // Property redefinition can fail on a frozen host; play()/pause() still wrap.
  }

  return function disposePlayFallback() {
    stopClock();
    if (pumpRaf != null) {
      cancelAnimationFrame(pumpRaf);
      pumpRaf = null;
    }
    texture.userData.dropMeta?.();
    video.removeEventListener("seeked", blit);
    video.removeEventListener("loadeddata", blit);
    video.play = nativePlay;
    video.pause = nativePause;
    try {
      delete video.paused;
      delete video.ended;
      delete video.currentTime;
    } catch {
      // ignore
    }
    delete video.dataset.playFallback;
  };
}

// Same play() fallback for a real DOM <video> (hero, etc.). Pass a canvas to
// blit into at native resolution — CSS object-fit: cover does the layout, so
// quality matches a normal <video class="object-cover">. Omit canvas to drive
// the element in place (Chrome / visible video).
export function installDomVideoFallback(video, canvas = null) {
  const texture = { needsUpdate: false, userData: {} };
  if (canvas) {
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
    texture.userData.canvas = canvas;
    texture.userData.ctx = ctx;
  }
  return installPlayFallback(video, texture);
}

