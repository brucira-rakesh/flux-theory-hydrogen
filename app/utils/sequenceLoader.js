const PRELOAD_CONCURRENCY = 8

/**
 * Ceiling on how long a single frame's `img.decode()` is allowed to gate that
 * frame's load.
 *
 * decode() is only ever an optimisation here: `onload` has already fired, so
 * the image IS usable and drawable — decode() just moves the decode cost off
 * the first drawImage. But in Chrome it does not settle at all while the
 * document is hidden, and it never rejects either, so a page loaded in a
 * background tab (opened in a new tab, then switched to later) would sit on
 * an unresolved promise forever: every frame stays 'loading', preloadSequence
 * never resolves, and whatever is gated on it — PreloaderV2's boot overlay —
 * hangs permanently with no way back, even once the tab is focused again.
 */
const DECODE_TIMEOUT_MS = 2000

/**
 * Generic frame-sequence preloader — decoupled from any single sequence's
 * asset paths (unlike frameSequence.js's createFrameCache, which is wired
 * directly to the KeyHighlights chip frames). Callers supply frameCount and
 * getFramePath so this can preload any numbered image sequence.
 */
export function createSequenceLoader({ frameCount, getFramePath, concurrency = PRELOAD_CONCURRENCY }) {
  const images = new Array(frameCount)
  const status = new Array(frameCount).fill('idle')
  const waiters = new Array(frameCount).fill(null).map(() => [])

  function resolveWaiters(index, image) {
    const list = waiters[index]
    while (list.length) list.shift()(image)
  }

  function loadFrame(index) {
    if (index < 0 || index >= frameCount) return Promise.resolve(null)
    if (status[index] === 'loaded') return Promise.resolve(images[index])
    if (status[index] === 'failed') return Promise.resolve(null)

    if (status[index] === 'loading') {
      return new Promise((resolve) => {
        waiters[index].push(resolve)
      })
    }

    status[index] = 'loading'

    return new Promise((resolve) => {
      const img = new Image()
      // Frames are drawn into a 2D canvas that other code later reads back
      // (getImageData) or feeds into WebGL (texImage2D) — loaded cross-origin
      // (VITE_CDN_URL) without this, either throws a SecurityError on a
      // "tainted" canvas even though the CDN sends CORS headers.
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'

      const finish = (result) => {
        if (result) {
          images[index] = result
          status[index] = 'loaded'
        } else {
          status[index] = 'failed'
        }
        resolveWaiters(index, result)
        resolve(result)
      }

      img.onload = async () => {
        try {
          // Raced, never awaited bare — see DECODE_TIMEOUT_MS. A hidden
          // document leaves this pending indefinitely, and the frame is
          // already fully usable without it.
          if (img.decode) {
            await Promise.race([
              img.decode(),
              new Promise((resolve) => {
                setTimeout(resolve, DECODE_TIMEOUT_MS)
              }),
            ])
          }
        } catch {
          // decode() can reject on some browsers — image is still usable
        }
        finish(img)
      }

      img.onerror = () => finish(null)
      img.src = getFramePath(index)
    })
  }

  function getLoadedFrame(index) {
    return status[index] === 'loaded' ? images[index] : null
  }

  /**
   * Loads every frame with bounded concurrency.
   *
   * Resolves once `readyCount` frames have settled (loaded or failed) so a
   * caller can un-gate (e.g. PreloaderV2's boot overlay) without waiting on
   * the tail of the reel. Remaining frames keep loading in the background
   * on this same instance. Omit `readyCount` (or pass >= frameCount) to
   * wait for the full sequence, matching the original behaviour.
   *
   * onProgress fires as (index, ratio) against the FULL frameCount, so a
   * progress bar still tracks the real download even after the gate trips.
   *
   * `stride` > 1 loads coarse-to-fine: every `stride`-th frame first (0, 10,
   * 20… for 10), then the remaining frames from the beginning. A scrub
   * anywhere in the reel then has a nearby frame to show early, instead of
   * only the front of the sequence being ready. Default 1 = plain in order.
   */
  function preloadSequence(onProgress, { readyCount, stride = 1 } = {}) {
    if (frameCount <= 0) return Promise.resolve()

    const step = Math.max(1, Math.floor(stride))
    const order = []
    for (let i = 0; i < frameCount; i += step) order.push(i)
    if (step > 1) {
      for (let i = 0; i < frameCount; i += 1) {
        if (i % step !== 0) order.push(i)
      }
    }

    const gateAt = Math.min(
      frameCount,
      Math.max(1, readyCount ?? frameCount),
    )
    let settledCount = 0
    let gated = false

    return new Promise((resolve) => {
      let inFlight = 0
      let nextIndex = 0

      const tripGate = () => {
        if (gated || settledCount < gateAt) return
        gated = true
        resolve()
      }

      const pump = () => {
        if (nextIndex >= frameCount && inFlight === 0) {
          tripGate()
          return
        }

        while (inFlight < concurrency && nextIndex < frameCount) {
          const index = order[nextIndex]
          nextIndex += 1
          inFlight += 1

          loadFrame(index).then((img) => {
            inFlight -= 1
            settledCount += 1
            onProgress?.(index, settledCount / frameCount, Boolean(img))
            tripGate()
            pump()
          })
        }
      }

      pump()
    })
  }

  return {
    loadFrame,
    getLoadedFrame,
    preloadSequence,
    getStatus: (index) => status[index],
  }
}
