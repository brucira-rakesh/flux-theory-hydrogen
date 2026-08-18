import { useEffect, useRef } from 'react'
import createCanvas from './createCanvas'
import Raindrops from './raindrops'
import RainRenderer from './rainRenderer'
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl'

const TEXTURE_BG = { width: 1280, height: 720 }
const TEXTURE_FG = { width: 640, height: 360 }

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
    img.crossOrigin = 'anonymous'
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

function isSourceSampleable(source) {
  if (!source) return false
  if (isVideoSource(source)) {
    return source.readyState >= 2 && source.videoWidth > 0 && !source.seeking
  }
  return (source.width || 0) > 1 && (source.height || 0) > 1
}

function sourceSize(source) {
  if (isVideoSource(source)) return { w: source.videoWidth, h: source.videoHeight }
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
      drawVideoCover(
        textureBgCtx,
        source,
        TEXTURE_BG.width,
        TEXTURE_BG.height,
        0,
      )
      drawVideoCover(
        textureFgCtx,
        source,
        TEXTURE_FG.width,
        TEXTURE_FG.height,
        band,
      )
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

        textureFg = createCanvas(TEXTURE_FG.width, TEXTURE_FG.height)
        textureFgCtx = textureFg.getContext('2d')
        textureBg = createCanvas(TEXTURE_BG.width, TEXTURE_BG.height)
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
