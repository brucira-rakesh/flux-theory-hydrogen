import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import * as THREE from 'three'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import { useScrollLock } from '../../hooks/useScrollLock'
import { createSequenceLoader } from '../../utils/sequenceLoader'
import { PreloaderContext } from './PreloaderContext'
import './Preloader.v2.css'

/**
 * Fixed boot length — matches Figma (node 1089:9 → 1089:5 → 1089:13): solid
 * #0e0e0e background, the wet-glass still image opacity-fades 0 → 1 over the
 * whole window, and the logo is a constant white mark under
 * mix-blend-mode: exclusion (no JS color tween — the blend mode itself does
 * the dark→light inversion as the background under it brightens). The reveal
 * only starts once every registered asset has loaded (see the boot-tween
 * effect below) — it holds on the plain dark background + logo until then.
 */
const BOOT_DURATION_SEC = 2
// Must be >= .preloader__progress's own opacity transition (0.25s, see
// Preloader.v2.css) so the progress bar has fully faded out before the
// overlay's is-exit fade (which carries the logo out with it) begins —
// otherwise the two fades visibly overlap.
const HANDOFF_MS = 250
const EXIT_MS = 750

/**
 * PreloaderV2 — provider that owns the boot sequence AND exposes its state
 * via PreloaderContext, so other components (canvas scenes, page sections)
 * can read `ready`/`progress` instead of only reacting to onComplete.
 *
 * Currently wired: a Three.js LoadingManager scaffold (no renderer — nothing
 * in this design needs a 3D canvas; future model/texture loaders can
 * register against `manager` from context) and a fixed-duration boot
 * animation. The overlay only clears once the animation has finished AND
 * every registered asset (three.js + the optional image sequence) has loaded.
 */
export const PreloaderV2 = ({ children, onComplete, onHandoff, sequence }) => {
  const [visible, setVisible] = useState(() => !prefersReducedMotion())
  const [exiting, setExiting] = useState(false)
  const [ready, setReady] = useState(false)
  const [handoff, setHandoffState] = useState(false)
  const [animationDone, setAnimationDone] = useState(() => prefersReducedMotion())
  // No asset loader is queued by default, so there's nothing to wait on
  // until a LoadingManager (or the sequence loader below) says otherwise.
  const [assetsReady, setAssetsReady] = useState(true)
  const [sequenceReady, setSequenceReady] = useState(() => !sequence)
  const [progress, setProgress] = useState(0)

  const stillRef = useRef(null)
  const completed = useRef(false)
  const tweenRef = useRef(null)
  // Real asset-loading progress (LoadingManager items + sequence frames),
  // NOT the fixed-duration reveal tween below — that tween only starts once
  // loading is already done, so driving the bar off it made the bar sit at
  // 0 for the entire real download and then fake-fill afterwards.
  const loadStatsRef = useRef({ managerLoaded: 0, managerTotal: 0, seqLoaded: 0, seqTotal: 0 })

  const recomputeProgress = useCallback(() => {
    const s = loadStatsRef.current
    const totalWeight = s.managerTotal + s.seqTotal
    setProgress(totalWeight > 0 ? Math.min(1, Math.max(0, (s.managerLoaded + s.seqLoaded) / totalWeight)) : 1)
  }, [])

  const applyReveal = useCallback((t) => {
    const p = Math.min(1, Math.max(0, t))
    const still = stillRef.current
    if (still) gsap.set(still, { opacity: p })
  }, [])

  const finish = useCallback(() => {
    if (completed.current) return
    completed.current = true
    applyReveal(1)
    // Cue for anything (e.g. IntroHeroV2's autoplay sequence) that should
    // start the instant the still image finishes revealing, ahead of the
    // overlay's own exit fade.
    setHandoffState(true)
    onHandoff?.()
    window.setTimeout(() => {
      setExiting(true)
      window.setTimeout(() => {
        setVisible(false)
        setReady(true)
        onComplete?.()
      }, EXIT_MS)
    }, HANDOFF_MS)
  }, [applyReveal, onComplete, onHandoff])

  // Reduced motion: skip the boot entirely, hand off immediately.
  useEffect(() => {
    if (!prefersReducedMotion() || completed.current) return undefined
    completed.current = true
    setHandoffState(true)
    setReady(true)
    onHandoff?.()
    onComplete?.()
    return undefined
  }, [onComplete, onHandoff])

  // Lock scroll while booting. The overflow/Lenis side lives in useScrollLock
  // (ref-counted, so a longer-running holder — e.g. IntroHeroV2's autoplay reel,
  // which outlasts this overlay — can't have its lock released by this one's
  // cleanup); only the data-preloading flag other components watch is local.
  useScrollLock(visible)

  useEffect(() => {
    if (!visible) return undefined
    const html = document.documentElement
    html.dataset.preloading = 'true'
    window.scrollTo(0, 0)

    return () => {
      delete html.dataset.preloading
    }
  }, [visible])

  // Boot tween — fixed duration, but held until every registered asset
  // (three.js scaffold + optional image sequence) has finished loading, so
  // the reveal doesn't start painting over frames that aren't there yet.
  const assetsLoaded = assetsReady && sequenceReady

  useEffect(() => {
    if (prefersReducedMotion() || !assetsLoaded) return undefined

    let cancelled = false
    const state = { p: 0 }
    applyReveal(0)

    tweenRef.current = gsap.to(state, {
      p: 1,
      duration: BOOT_DURATION_SEC,
      ease: 'none',
      onUpdate: () => {
        applyReveal(state.p)
      },
      onComplete: () => {
        if (!cancelled) setAnimationDone(true)
      },
    })

    // Loading already finished by the time this tween starts — if nothing
    // was ever registered with the manager/sequence, recomputeProgress's own
    // totalWeight guard wouldn't otherwise fire, so nudge the bar to full.
    recomputeProgress()

    return () => {
      cancelled = true
      tweenRef.current?.kill()
    }
  }, [applyReveal, assetsLoaded, recomputeProgress])

  // Three.js LoadingManager scaffold — no renderer/canvas, this design has
  // no 3D visual. Future model/texture loaders can register against
  // `manager` (via context) and `assetsReady` will hold until they finish.
  const manager = useMemo(() => {
    if (prefersReducedMotion()) return null

    const loadingManager = new THREE.LoadingManager()
    const onManagerProgress = (_url, itemsLoaded, itemsTotal) => {
      loadStatsRef.current.managerLoaded = itemsLoaded
      loadStatsRef.current.managerTotal = itemsTotal
      recomputeProgress()
    }
    loadingManager.onStart = (_url, itemsLoaded, itemsTotal) => {
      setAssetsReady(false)
      onManagerProgress(_url, itemsLoaded, itemsTotal)
    }
    loadingManager.onProgress = onManagerProgress
    loadingManager.onLoad = () => setAssetsReady(true)
    loadingManager.onError = () => setAssetsReady(true)
    return loadingManager
  }, [recomputeProgress])

  // Deterministic from `sequence` — a memo (not state) so creating it isn't
  // a setState-in-effect, and other components (IntroHeroV2) can reuse this
  // exact instance via context instead of preloading the same frames again.
  const sequenceLoader = useMemo(() => {
    if (prefersReducedMotion() || !sequence?.frameCount || !sequence?.getFramePath) {
      return null
    }
    return createSequenceLoader(sequence)
  }, [sequence])

  // Optional image-sequence preload (e.g. a frame-by-frame intro reel).
  // sequenceReady already starts false whenever a sequence is passed in
  // (see the useState initializer above), so there's nothing to flip here.
  useEffect(() => {
    if (!sequenceLoader) return undefined

    let cancelled = false
    loadStatsRef.current.seqTotal = sequence?.frameCount || 0
    recomputeProgress()
    sequenceLoader
      .preloadSequence((_index, ratio) => {
        if (cancelled) return
        loadStatsRef.current.seqLoaded = ratio * loadStatsRef.current.seqTotal
        recomputeProgress()
      })
      .then(() => {
        if (!cancelled) setSequenceReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [sequenceLoader, sequence, recomputeProgress])

  // Clear the overlay once the boot animation and every registered asset
  // (three.js scaffold + optional image sequence) have finished.
  useEffect(() => {
    if (animationDone && assetsReady && sequenceReady) finish()
  }, [animationDone, assetsReady, sequenceReady, finish])

  const contextValue = useMemo(
    () => ({
      ready,
      handoff,
      progress,
      animationDone,
      assetsReady: assetsReady && sequenceReady,
      manager,
      sequenceLoader,
    }),
    [ready, handoff, progress, animationDone, assetsReady, sequenceReady, manager, sequenceLoader],
  )

  // Static first frame of the autoplay sequence — the wet-glass reveal
  // image (Figma's "image 126" / "image 198"), opacity-tweened 0 → 1.
  const stillFrameSrc =
    sequence?.frameCount > 0 && typeof sequence.getFramePath === 'function'
      ? sequence.getFramePath(0)
      : null

  return (
    <PreloaderContext.Provider value={contextValue}>
      {visible && (
        <div
          className={`preloader${exiting ? ' is-exit' : ''}`}
          aria-hidden={exiting}
          aria-label="Loading experience"
          aria-busy={!exiting}
        >
          {stillFrameSrc && (
            <img
              ref={stillRef}
              className="preloader__still"
              src={stillFrameSrc}
              alt=""
              draggable={false}
              decoding="async"
            />
          )}
          <div className="preloader__tint" aria-hidden="true" />
          <div className="preloader__center" aria-hidden="true">
            <div className="preloader__logo">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="120"
                height="95"
                viewBox="0 0 120 95"
                fill="none"
              >
                <path
                  d="M28.0104 24.6528H26.9304V0H36.7704V24.0624H37.8504C40.68 24.0624 42.12 26.3335 42.12 30.4137V44.4017H52.9128V53.7644H32.2824V30.9993C32.2824 26.9191 30.84 24.6552 28.0128 24.6552L28.0104 24.6528ZM15.1896 53.7644V33.1608H26.076V30.4137C26.076 26.3335 24.636 24.0624 21.8064 24.0624H9.8376V9.36502H21.732V0H0V24.6528H1.0824C3.912 24.6528 5.352 26.9238 5.352 31.0041V53.7644H15.192H15.1896ZM5.3496 64.8386H9.6936V94.5048H16.0344V64.8386H20.5272V58.8968H5.3496V64.8386ZM91.1304 24.6528H92.2152C94.7664 24.6528 95.2104 27.4071 94.332 30.6541L86.4288 53.7644H97.1424L102.694 33.2108L103.214 30.6803L103.735 33.2108L109.286 53.7644H120L112.027 30.4137C110.789 26.2478 109.162 24.0624 105.804 24.0624H104.796L113.83 0H103.001L98.4576 14.4379L97.8624 17.5564L97.2672 14.4379L92.7264 0H81.8976L91.1304 24.6528ZM99.9768 93.4384C100.109 93.8526 100.277 94.2049 100.476 94.5025H94.0848C93.7416 94.343 93.4848 93.6002 93.4848 92.2243V83.0616C93.4848 82.2594 93.432 81.6547 93.0168 81.2476C92.6016 80.8406 92.0496 80.7335 91.2888 80.7335H89.9904V94.5025H83.8992V58.8944H92.1384C94.1448 58.8944 96.6408 59.1753 98.1048 60.5275C99.6072 61.9153 99.7776 63.8697 99.7776 65.8765V72.7111C99.7776 73.8989 99.5952 74.8821 99.228 75.6581C98.8608 76.4342 98.328 77.0198 97.6296 77.4174C97.4376 77.5269 97.2288 77.6221 97.0104 77.7126C97.404 77.8482 97.7448 78.0054 98.0304 78.1863C98.6304 78.5672 99.0696 79.1194 99.3528 79.8455C99.636 80.5716 99.7776 81.4976 99.7776 82.6188V92.0791C99.7776 92.5742 99.8424 93.0289 99.9768 93.4407V93.4384ZM93.6864 66.3241C93.6864 65.4814 93.5592 64.9481 93.2544 64.6601C92.9064 64.3316 92.3832 64.1959 91.5384 64.1959H89.9904V75.0416H91.6368C92.4024 75.0416 92.8128 74.9368 93.2304 74.644C93.588 74.3941 93.684 73.7775 93.684 73.061V66.3265L93.6864 66.3241ZM34.4208 73.5561H30.6768V58.8968H24.2856V94.5048H30.6768V79.5479H34.4208V94.5048H40.8624V58.8968H34.4208V73.5561ZM78.7464 24.0624H77.6688V0H67.848V24.6528H68.9232C71.7528 24.6528 73.1928 26.9238 73.1928 31.0041L73.2 37.9457C73.2 39.9454 73.0488 41.4927 72.744 42.5806C72.4392 43.6685 71.9976 44.4255 71.4216 44.8469C70.8432 45.2682 70.1184 45.4801 69.2424 45.4801C68.3664 45.4801 67.6392 45.2682 67.0632 44.8469C66.4848 44.4255 66.0336 43.6709 65.7024 42.5806C65.3712 41.4927 65.208 39.9478 65.208 37.9457V30.4137C65.208 26.3335 63.7656 24.0624 60.9384 24.0624H59.8584V0H50.0376V24.6528H51.1152C53.9448 24.6528 55.3848 26.9238 55.3848 31.0041L55.3896 30.9827V37.0387C55.3896 41.4546 55.9344 44.9516 57.0264 47.525C58.1184 50.0984 59.6712 51.9052 61.6896 52.9431C63.708 53.981 66.2064 54.5 69.1896 54.5C72.1728 54.5 74.6904 53.981 76.7064 52.9431C78.7248 51.9052 80.28 50.1055 81.3792 47.544C82.476 44.9826 83.0256 41.4808 83.0256 37.0387L83.0856 30.3899L83.0184 30.4137C83.0184 26.3335 81.5784 24.0624 78.7488 24.0624H78.7464ZM111.312 71.5779L111.022 76.1866L110.813 71.5279L108.617 58.8968H102.226L107.717 81.9523V94.5048H114.307V81.3238L119.998 58.8968H113.508L111.312 71.5779ZM51.696 79.3504H58.1376V73.5061H51.696V64.741H58.836V58.8968H45.4056V94.5048H59.0376V88.463H51.6984V79.3504H51.696ZM79.608 66.9192V86.3825C79.608 90.6246 77.844 93.5026 74.5656 94.5048C73.44 94.8476 72.228 95.0071 71.0208 95C69.8136 95.0071 68.6016 94.8476 67.476 94.5048C64.1976 93.5026 62.4336 90.6246 62.4336 86.3825V66.9192C62.4336 62.6652 64.3104 59.6133 68.076 58.8182C69.0024 58.623 70.0176 58.5159 71.0208 58.5112C72.024 58.5159 73.0392 58.623 73.9656 58.8182C77.7336 59.6157 79.608 62.6676 79.608 66.9192ZM72.8664 67.3144C72.8664 66.6883 72.84 65.8432 72.6816 65.2124C72.468 64.3649 71.7696 64.0459 71.0184 64.0459C70.2672 64.0459 69.5688 64.3649 69.3552 65.2124C69.1944 65.8432 69.1704 66.6883 69.1704 67.3144L69.2112 86.8824C69.2112 87.6656 69.4176 88.4035 69.7968 88.6987C70.1112 88.9439 70.5504 89.0558 71.016 89.0558C71.4816 89.0558 71.9208 88.9463 72.2352 88.6987C72.6144 88.4012 72.8208 87.6632 72.8208 86.8824L72.8616 67.3144H72.8664Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div
              className={`preloader__progress${animationDone ? ' is-done' : ''}`}
            >
              <div
                className="preloader__progress-fill"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          </div>
        </div>
      )}
      {children}
    </PreloaderContext.Provider>
  )
}
