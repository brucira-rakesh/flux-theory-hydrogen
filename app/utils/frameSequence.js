import { FRAME_COUNT, getFramePath } from '../data/highlights'

const MAX_DPR = 1.5
const PRELOAD_CONCURRENCY = 6

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function createFrameCache(frameCount = FRAME_COUNT) {
  const images = new Array(frameCount)
  const status = new Array(frameCount).fill('idle')
  const waiters = new Array(frameCount).fill(null).map(() => [])
  let lastPrefetchCenter = -999

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
      // See sequenceLoader.js's identical line — these frames feed a canvas
      // that gets read back / uploaded to WebGL, which throws on a cross-
      // origin (VITE_CDN_URL) image loaded without this, taint or not.
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
    if (status[index] === 'loaded') return images[index]
    return null
  }

  function getNearestLoadedIndex(index) {
    if (status[index] === 'loaded') return index

    for (let offset = 1; offset < frameCount; offset += 1) {
      const prev = index - offset
      const next = index + offset
      if (prev >= 0 && status[prev] === 'loaded') return prev
      if (next < frameCount && status[next] === 'loaded') return next
    }

    return -1
  }

  /**
   * Prefetch a modest window around the playhead. Skips work unless the
   * centre moved enough — avoids kicking off dozens of loads every draw.
   */
  function prefetchAround(center, behind = 8, ahead = 24) {
    if (Math.abs(center - lastPrefetchCenter) < 4) return
    lastPrefetchCenter = center

    for (let offset = -behind; offset <= ahead; offset += 1) {
      const index = center + offset
      if (index >= 0 && index < frameCount && status[index] === 'idle') {
        loadFrame(index)
      }
    }
  }

  function preloadSequence(onFrameLoaded) {
    let inFlight = 0
    let nextIndex = 0

    const pump = () => {
      while (inFlight < PRELOAD_CONCURRENCY && nextIndex < frameCount) {
        const index = nextIndex
        nextIndex += 1
        inFlight += 1

        loadFrame(index).then((img) => {
          inFlight -= 1
          if (img) onFrameLoaded?.(index)
          pump()
        })
      }
    }

    pump()
  }

  return {
    loadFrame,
    getLoadedFrame,
    getNearestLoadedIndex,
    prefetchAround,
    preloadSequence,
    getStatus: (index) => status[index],
  }
}

export function setupCanvas(canvas, container, ctxRef) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  const width = container.clientWidth
  const height = container.clientHeight
  // Not laid out yet — caller should retry on resize / next frame.
  if (width < 2 || height < 2) return null

  // Leave CSS width/height in control; only size the drawing buffer.
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  let ctx = ctxRef.current
  if (!ctx) {
    // Opaque canvas — we always fill with the section bg colour before
    // drawing, so alpha compositing is wasted work every frame.
    // Avoid desynchronized:true — it can leave a blank buffer on Safari/macOS.
    ctx = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: false,
    })
    if (!ctx) return null
    ctxRef.current = ctx
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'

  return { ctx, width, height, dpr }
}

export function drawFrameContain(ctx, image, width, height, bgColor = '#d0d1db') {
  const imgW = image.naturalWidth || image.width
  const imgH = image.naturalHeight || image.height
  if (!imgW || !imgH) return false

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, width, height)

  const imgAspect = imgW / imgH
  const canvasAspect = width / height
  let drawW
  let drawH
  let drawX
  let drawY

  if (imgAspect > canvasAspect) {
    drawW = width
    drawH = width / imgAspect
    drawX = 0
    drawY = (height - drawH) / 2
  } else {
    drawH = height
    drawW = height * imgAspect
    drawX = (width - drawW) / 2
    drawY = 0
  }

  ctx.drawImage(image, drawX, drawY, drawW, drawH)
  return true
}

/**
 * Like drawFrameContain but crops instead of letterboxing — scales the
 * image up to fill the full canvas (CSS background-size:cover behaviour),
 * so no bgColor bars ever show. Used where the canvas itself is meant to
 * cover the full screen (e.g. SeawaveSeq).
 */
export function drawFrameCover(ctx, image, width, height) {
  const imgW = image.naturalWidth || image.width
  const imgH = image.naturalHeight || image.height
  if (!imgW || !imgH) return false

  const imgAspect = imgW / imgH
  const canvasAspect = width / height
  let sx
  let sy
  let sw
  let sh

  if (imgAspect > canvasAspect) {
    sh = imgH
    sw = imgH * canvasAspect
    sx = (imgW - sw) / 2
    sy = 0
  } else {
    sw = imgW
    sh = imgW / canvasAspect
    sx = 0
    sy = (imgH - sh) / 2
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
  return true
}

export function progressToFrame(progress, frameCount = FRAME_COUNT) {
  const clamped = Math.min(1, Math.max(0, progress))
  return Math.round(clamped * (frameCount - 1))
}

/**
 * Smooth, fractional frame position — returns a float so the caller can
 * lerp toward it rather than snapping directly to the integer index.
 */
export function progressToFrameFloat(progress, frameCount = FRAME_COUNT) {
  const clamped = Math.min(1, Math.max(0, progress))
  return clamped * (frameCount - 1)
}

export { MAX_DPR, PRELOAD_CONCURRENCY }
