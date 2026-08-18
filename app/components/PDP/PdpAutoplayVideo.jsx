import { useEffect, useRef } from 'react'

/**
 * Muted autoplay video used for PDP galleries.
 * Encapsulates the play()-after-mount + canplay retry to survive
 * hydration/mount timing quirks (and React StrictMode double-mount in dev).
 */
export default function PdpAutoplayVideo({
  sources = [],
  poster,
  className,
  ariaLabel,
}) {
  const videoRef = useRef(null)

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
  }, [sources])

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
      {sources.map((src) => (
        <source key={src.url} src={src.url} type={src.mimeType} />
      ))}
    </video>
  )
}

