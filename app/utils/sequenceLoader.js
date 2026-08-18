const PRELOAD_CONCURRENCY = 6

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
          if (img.decode) await img.decode()
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
   * Loads every frame with bounded concurrency. Resolves once all frames
   * have settled (loaded or failed). onProgress fires as (index, ratio).
   */
  function preloadSequence(onProgress) {
    if (frameCount <= 0) return Promise.resolve()

    let settledCount = 0

    return new Promise((resolve) => {
      let inFlight = 0
      let nextIndex = 0

      const pump = () => {
        if (nextIndex >= frameCount && inFlight === 0) {
          resolve()
          return
        }

        while (inFlight < concurrency && nextIndex < frameCount) {
          const index = nextIndex
          nextIndex += 1
          inFlight += 1

          loadFrame(index).then((img) => {
            inFlight -= 1
            settledCount += 1
            onProgress?.(index, settledCount / frameCount, Boolean(img))
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
