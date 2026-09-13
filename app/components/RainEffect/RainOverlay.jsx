import { useEffect, useRef } from 'react'
import createCanvas from './createCanvas'
import Raindrops from './raindrops'
import RainRenderer from './rainRenderer'
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

/** Longest-side budget for the two sample textures the droplet shader reads.
 *  The SHAPE is derived per-mount from the overlay's own aspect ratio (see
 *  textureSize) rather than hardcoded 16:9 — at 1280/640 with a 16:9 canvas
 *  these still resolve to the original 1280x720 / 640x360.
 *
 *  Why it can't be a fixed landscape size: this overlay is opaque
 *  (rainRenderer's GL context is `alpha: false`), so it does not tint the
 *  layer underneath it — it REPLACES it, repainting the source through these
 *  textures. A 16:9 texture put the source through two cover fits on a
 *  portrait viewport: `drawVideoCover` cropped the tall source down to a
 *  short landscape band, then the shader's own `scaledTexCoord()` blew that
 *  band back up to fill the tall canvas. On a phone that reads as the hero
 *  sequence being zoomed way in; on a ~16:9 desktop window both fits are
 *  near-identity, which is why it only ever showed on mobile. */
const TEXTURE_BG_MAX = 1280
const TEXTURE_FG_MAX = 640

/** Texture dimensions matching `ratio` (the overlay canvas's width/height),
 *  with the longer side at `max`. Both cover fits above then collapse to
 *  identity and the source is sampled 1:1. */
function textureSize(max, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return { width: max, height: max }
  return ratio >= 1
    ? { width: max, height: Math.max(2, Math.round(max / ratio)) }
    : { width: Math.max(2, Math.round(max * ratio)), height: max }
}

/** Running drops only — sticky surface droplets disabled. */
const DROP_OPTIONS = {
  minR: 7,
  maxR: 14,
  rainChance: 0.15,
  rainLimit: 1.5,
  collisionRadiusIncrease: 0.002,
  dropletsRate: 0,
  dropletsSize: [1.5, 4],
  dropletsCleaningRadiusMultiplier: 0.3,
  trailRate: 0,
}

/** Crisp drops only — no wet-film fog. */
const RENDER_OPTIONS = {
  brightness: 1,
  alphaMultiply: 20,
  alphaSubtract: 5,
  parallaxFg: 0,
  parallaxBg: 0,
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Drawn into a 2D canvas (raindrops.js) that later feeds a WebGL
    // texture — without this, loading the image cross-origin (VITE_CDN_URL)
    // taints that canvas and texImage2D throws a SecurityError.
    img.crossOrigin = 'anonymous'
    // These two droplet textures are the only thing gating the effect from
    // starting, and they are tiny — but by default they join the back of the
    // request queue. Mounted over a boot screen that is simultaneously
    // preloading a whole frame sequence (see PreloaderV2's `showStillRain`),
    // that queue is hundreds of images deep, so the rain could not appear
    // until the sequence had essentially finished — i.e. right as the
    // progress bar hit 100% and the overlay was about to leave, which is
    // exactly backwards. High priority puts them at the front instead, so
    // the droplets are running while the bar is still filling.
    img.fetchPriority = 'high'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = src
  })
}

/** getVideo() may resolve to a <video> (readyState/seeking apply) or a
 *  <canvas> (e.g. an image-sequence player) — a canvas is "ready" as soon
 *  as it has pixels, there's no decode/seek state to check. */
function isVideoSource(source) {
  return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement
}

/** True for a plain <img> — its `.width`/`.height` IDL properties reflect the
 *  CSS-RENDERED box size (whatever aspect ratio its container imposes), not
 *  the pixel buffer `drawImage` actually samples from (the intrinsic
 *  bitmap). A <canvas>/<video>'s `.width`/`.height` (or `videoWidth`/
 *  `videoHeight`) always match their own pixel buffer 1:1, so only <img>
 *  needs the natural-size branch below. */
function isImageSource(source) {
  return typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement
}

function isSourceSampleable(source) {
  if (!source) return false
  if (isVideoSource(source)) {
    return source.readyState >= 2 && source.videoWidth > 0 && !source.seeking
  }
  if (isImageSource(source)) {
    return source.complete && (source.naturalWidth || 0) > 1 && (source.naturalHeight || 0) > 1
  }
  return (source.width || 0) > 1 && (source.height || 0) > 1
}

function sourceSize(source) {
  if (isVideoSource(source)) return { w: source.videoWidth, h: source.videoHeight }
  if (isImageSource(source)) return { w: source.naturalWidth, h: source.naturalHeight }
  return { w: source.width, h: source.height }
}

/**
 * Codrops Rain Effect demo 3 overlay.
 * Samples an existing <video> into fg/bg textures and draws refracting droplets.
 * https://tympanus.net/Development/RainEffect/index3.html
 */
export default function RainOverlay({
  getVideo,
  active = true,
  dropAlphaSrc = oxygenPublicUrl('/rain/drop-alpha.png'),
  dropColorSrc = oxygenPublicUrl('/rain/drop-color.png'),
  className,
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined

    const canvas = canvasRef.current
    if (!canvas || typeof getVideo !== 'function') return undefined

    let cancelled = false
    let raindrops = null
    let renderer = null
    let textureFg = null
    let textureBg = null
    let textureFgCtx = null
    let textureBgCtx = null
    let textureRaf = 0
    // Resolved from the canvas's aspect ratio in init(), before the two
    // sample canvases are created — see textureSize.
    let bgSize = textureSize(TEXTURE_BG_MAX, 16 / 9)
    let fgSize = textureSize(TEXTURE_FG_MAX, 16 / 9)

    const sizeCanvas = () => {
      const parent = canvas.parentElement
      const w = Math.max(1, Math.round(parent?.clientWidth || window.innerWidth))
      const h = Math.max(1, Math.round(parent?.clientHeight || window.innerHeight))
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      return { w, h }
    }

    const drawVideoCover = (ctx, source, w, h, sourceYOffset = 0) => {
      const { w: vw = w, h: vh = h } = sourceSize(source)
      if (vw < 2 || vh < 2) return
      // Cover-fit, then optionally shift the source for fg/bg depth
      // (Codrops samples different vertical bands of the same video).
      const scale = Math.max(w / vw, h / vh)
      const sw = w / scale
      const sh = h / scale
      const sx = (vw - sw) * 0.5
      const sy = Math.min(
        Math.max(0, (vh - sh) * 0.5 + sourceYOffset),
        Math.max(0, vh - sh),
      )
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h)
    }

    const generateTextures = (source) => {
      if (!textureFgCtx || !textureBgCtx || !source) return
      if (!isSourceSampleable(source)) return
      // Fg samples a slightly lower band than bg — same idea as Codrops index3
      // crop (bg at y=0, fg at y=textureBg.height), adapted to full-bleed video.
      const { h: sourceH } = sourceSize(source)
      const band = Math.min(sourceH * 0.08, 48)
      drawVideoCover(textureBgCtx, source, bgSize.width, bgSize.height, 0)
      drawVideoCover(textureFgCtx, source, fgSize.width, fgSize.height, band)
    }

    const updateTextures = () => {
      if (cancelled) return
      const source = getVideo()
      // Skip blank/unready frames so a source switch can't flash black.
      if (isSourceSampleable(source)) {
        generateTextures(source)
        renderer?.updateTextures()
      }
      textureRaf = requestAnimationFrame(updateTextures)
    }

    const init = async () => {
      try {
        const [dropAlpha, dropColor] = await Promise.all([
          loadImage(dropAlphaSrc),
          loadImage(dropColorSrc),
        ])
        if (cancelled) return

        // Wait for a sampleable frame (videos decode async; canvases are
        // ready as soon as something has drawn into them).
        let source = getVideo()
        if (!source) return
        if (isVideoSource(source) && source.readyState < 2) {
          await new Promise((resolve) => {
            const done = () => {
              source.removeEventListener('loadeddata', done)
              resolve()
            }
            source.addEventListener('loadeddata', done)
            window.setTimeout(done, 4000)
          })
        } else if (!isVideoSource(source)) {
          await new Promise((resolve) => {
            const start = performance.now()
            const poll = () => {
              if (cancelled) return resolve()
              if (isSourceSampleable(getVideo()) || performance.now() - start > 4000) {
                resolve()
                return
              }
              requestAnimationFrame(poll)
            }
            poll()
          })
        }
        if (cancelled) return
        source = getVideo()
        if (!source) return

        const { w, h } = sizeCanvas()
        const dpi = window.devicePixelRatio || 1

        raindrops = new Raindrops(w, h, dpi, dropAlpha, dropColor, DROP_OPTIONS)

        // Must be computed from the SIZED canvas, and before the textures
        // are created: RainRenderer reads `imageBg.width / imageBg.height`
        // once, into the shader's `textureRatio` uniform.
        bgSize = textureSize(TEXTURE_BG_MAX, w / h)
        fgSize = textureSize(TEXTURE_FG_MAX, w / h)

        textureFg = createCanvas(fgSize.width, fgSize.height)
        textureFgCtx = textureFg.getContext('2d')
        textureBg = createCanvas(bgSize.width, bgSize.height)
        textureBgCtx = textureBg.getContext('2d')

        generateTextures(source)

        renderer = new RainRenderer(
          canvas,
          raindrops.canvas,
          textureFg,
          textureBg,
          null,
          RENDER_OPTIONS,
        )

        updateTextures()
      } catch (err) {
        console.warn('[RainOverlay]', err)
      }
    }

    void init()

    return () => {
      cancelled = true
      if (textureRaf) cancelAnimationFrame(textureRaf)
      raindrops?.destroy()
      renderer?.destroy()
      raindrops = null
      renderer = null
    }
  }, [active, getVideo, dropAlphaSrc, dropColorSrc])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'intro-hero__rain'}
      width={1}
      height={1}
      aria-hidden="true"
    />
  )
}
