import { useEffect, useMemo, useRef } from 'react'

/**
 * Score a Shopify CDN video URL for progressive quality ranking.
 * Prefer explicit height when present; otherwise parse HD-1080p / HD-720p / SD-480p.
 */
function progressiveQualityScore(src) {
  const height = Number(src.height) || 0
  if (height > 0) return height

  const url = String(src.url || '')
  const labeled = url.match(/\b(?:HD|SD)-(\d{3,4})p\b/i)
  if (labeled) return Number(labeled[1]) || 0

  const mp4Hint = url.match(/(\d{3,4})p/i)
  if (mp4Hint) return Number(mp4Hint[1]) || 0

  return 0
}

function isHlsSource(src) {
  const mime = String(src.mimeType || '').toLowerCase()
  const url = String(src.url || '').toLowerCase()
  return (
    mime.includes('mpegurl') ||
    mime === 'application/vnd.apple.mpegurl' ||
    url.includes('.m3u8')
  )
}

/**
 * Full-bleed heroes: drop HLS so Chromium cannot ABR-settle on 480p, then
 * order progressive mp4 highest-quality first.
 */
export function preferProgressiveMaxSources(sources = []) {
  const progressive = sources.filter((src) => src?.url && !isHlsSource(src))
  if (!progressive.length) return sources.filter((src) => src?.url)

  return [...progressive].sort(
    (a, b) => progressiveQualityScore(b) - progressiveQualityScore(a),
  )
}

/**
 * Muted autoplay video used for PDP galleries / lifestyle.
 * Encapsulates the play()-after-mount + canplay retry to survive
 * hydration/mount timing quirks (and React StrictMode double-mount in dev).
 *
 * @param {object} props
 * @param {Array<{url: string, mimeType?: string, height?: number, width?: number}>} [props.sources]
 * @param {string} [props.poster]
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.preferProgressiveMax] When true (lifestyle hero), drop
 *   HLS and prefer the highest-quality progressive mp4. Leave false for how-to-use.
 */
export default function PdpAutoplayVideo({
  sources = [],
  poster,
  className,
  ariaLabel,
  preferProgressiveMax = false,
}) {
  const videoRef = useRef(null)
  const resolvedSources = useMemo(
    () =>
      preferProgressiveMax ? preferProgressiveMaxSources(sources) : sources,
    [sources, preferProgressiveMax],
  )

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    // Ensure autoplay is allowed by the browser policy.
    v.muted = true
    v.playsInline = true

    const tryPlay = () => {
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }

    if (v.readyState >= 2) {
      tryPlay()
    } else {
      v.addEventListener('canplay', tryPlay, { once: true })
    }
  }, [resolvedSources])

  return (
    <video
      ref={videoRef}
      className={className}
      role="img"
      aria-label={ariaLabel || 'Product media'}
      autoPlay
      muted
      loop
      playsInline
      poster={poster || undefined}
      draggable={false}
    >
      {resolvedSources.map((src) => (
        <source key={src.url} src={src.url} type={src.mimeType} />
      ))}
    </video>
  )
}
