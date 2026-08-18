import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import './AnimatedTitle.css'

gsap.registerPlugin(ScrollTrigger)

/** Resolve a ScrollTrigger trigger ref/object to a DOM element. */
function resolveScrollTriggerElement(raw, fallback) {
  if (!raw?.trigger) return fallback
  const t = raw.trigger
  if (typeof t === 'object' && t !== null && 'current' in t) {
    return t.current ?? fallback
  }
  return t ?? fallback
}

/**
 * Split a string into word/space tokens for wrap-safe char spans.
 * @param {string} text
 * @param {string} className
 * @param {string} keyPrefix
 */
function tokenizeLine(text, className, keyPrefix) {
  const chars = [...text].map((char, charIndex) => ({
    key: `${keyPrefix}-${charIndex}-${char === ' ' ? 'space' : char}`,
    char,
    isSpace: char === ' ',
    className: className || '',
  }))

  const groups = []
  let current = null

  chars.forEach((item) => {
    if (item.isSpace) {
      if (current) {
        groups.push(current)
        current = null
      }
      groups.push({ type: 'space', key: `sp-${item.key}` })
      return
    }

    if (!current) {
      current = { type: 'word', key: `w-${item.key}`, chars: [] }
    }
    current.chars.push(item)
  })

  if (current) groups.push(current)
  return groups
}

/**
 * Reusable title with left→right character reveal (blur + fade).
 * Characters are grouped by word so wrapping breaks between words, not mid-word.
 *
 * @example
 * <AnimatedTitle as="h1">THE DREAMER</AnimatedTitle>
 *
 * @example Forced line breaks via `lines`
 * <AnimatedTitle lines={['This is where it', 'all begins.']} />
 *
 * @example Soft letter-by-letter blur wave (opt-in per usage)
 * <AnimatedTitle blurSweep lines={['This is where it', 'all begins.']} />
 * <AnimatedTitle blurSweep={{ visible: isActive, blur: 5, step: 0.08 }} >Title</AnimatedTitle>
 *
 * @example Forced word list via `words` (wraps only between entries)
 * <AnimatedTitle words={['MEET', 'EVERY', 'VERSION']} />
 *
 * @example Colored segments + scroll trigger
 * <AnimatedTitle
 *   segments={[
 *     { text: 'FIVE ', className: 'vh-word--white' },
 *     { text: 'STATES', className: 'vh-word--teal' },
 *   ]}
 *   scrollTrigger={{ trigger: sectionRef, start: 'top top' }}
 * />
 */

const BLUR_SWEEP_DEFAULTS = {
  visible: true,
  /** Seconds for a full cycle (letter wave + pause). */
  loop: 12,
  /** Seconds for one letter's blur pulse (rise + long fall trail). */
  letter: 2.1,
  /** Delay between consecutive letter starts (smaller = denser trail). */
  step: 0.12,
  /** Peak letter blur in px. */
  blur: 5,
  /**
   * Extra seconds after the entry reveal before the looping wave starts.
   * PDP / scroll-triggered titles pass a smaller value so the wave is visible
   * while the section is still on screen.
   */
  postReveal: 3,
  /**
   * Letter index into a shared wave (for split titles that should read as one).
   * Right-side titles pass the left title's character count.
   */
  charOffset: 0,
  /**
   * Total letters in the shared wave (left + right). Keeps loop pause in sync.
   * Defaults to charOffset + local letter count.
   */
  waveLength: null,
  /**
   * Shared entry timing so split titles defer the wave together.
   * `{ delay, duration, stagger, chars }` — uses the primary (usually left) title.
   */
  entrySpan: null,
}

/**
 * @param {boolean | Partial<typeof BLUR_SWEEP_DEFAULTS>} value
 * @returns {typeof BLUR_SWEEP_DEFAULTS | null}
 */
function resolveBlurSweep(value) {
  if (!value) return null
  if (value === true) return { ...BLUR_SWEEP_DEFAULTS }
  if (typeof value === 'object') {
    return { ...BLUR_SWEEP_DEFAULTS, ...value }
  }
  return null
}

export default function AnimatedTitle({
  children,
  as: Tag = 'h2',
  className = '',
  delay = 0,
  duration = 0.8,
  stagger = 0.02,
  replayKey,
  /** Skip reveal — show final settled state (e.g. returning to a screen). */
  instant = false,
  /**
   * When false, characters stay hidden and no reveal runs (parent controls timing).
   * Avoids animating while `display:none` / `opacity:0` and prevents remount flashes.
   */
  play = true,
  /**
   * Soft looping blur wave across letters (blurs the characters themselves).
 * Multi-line titles wave in parallel by column so both lines run together.
   * - `false` / omitted — off (default)
   * - `true` — on with defaults
   * - `{ visible, loop, letter, step, blur, charOffset, waveLength, entrySpan }`
   *   — on with overrides; use `charOffset` / `waveLength` / `entrySpan` to chain
   *   split titles into one continuous left→right wave
   */
  blurSweep = false,
  /** Forced line breaks — each entry renders on its own line */
  lines,
  /** Forced word breaks — each entry is an atomic word (joined with spaces) */
  words: wordsProp,
  /** Optional segment list — overrides `children` when provided (ignored if `lines`/`words` set) */
  segments,
  /**
   * When set, plays on scroll instead of mount.
   * Pass a ScrollTrigger vars object (trigger can be an element or ref.current).
   * Or `true` to use this element with start: 'top 80%'.
   */
  scrollTrigger: scrollTriggerProp,
}) {
  const rootRef = useRef(null)
  const sweepTlRef = useRef(null)
  const reducedMotion = useMemo(() => prefersReducedMotion(), [])
  const blurSweepOpts = useMemo(() => resolveBlurSweep(blurSweep), [blurSweep])
  const blurSweepEnabled = Boolean(blurSweepOpts) && !reducedMotion
  const blurSweepVisible = blurSweepEnabled && blurSweepOpts.visible !== false

  /** @type {{ lineClass: string, segments: { text: string, className?: string }[] }[]} */
  const resolvedLines = useMemo(() => {
    if (Array.isArray(lines) && lines.length) {
      return lines.map((line) => {
        if (typeof line === 'string') {
          return { lineClass: '', segments: [{ text: line, className: '' }] }
        }
        if (line && typeof line === 'object' && 'text' in line) {
          return {
            lineClass: line.className || '',
            segments: [{ text: String(line.text), className: '' }],
          }
        }
        return { lineClass: '', segments: [{ text: String(line ?? ''), className: '' }] }
      })
    }

    if (Array.isArray(wordsProp) && wordsProp.length) {
      const joined = wordsProp
        .map((w) => (typeof w === 'string' ? w : w?.text ?? ''))
        .filter(Boolean)
        .join(' ')
      return [{ lineClass: '', segments: [{ text: joined, className: '' }] }]
    }

    if (Array.isArray(segments) && segments.length) {
      return [{ lineClass: '', segments }]
    }

    const text = typeof children === 'string' ? children : String(children ?? '')
    return [{ lineClass: '', segments: [{ text, className: '' }] }]
  }, [children, lines, wordsProp, segments])

  const label = useMemo(
    () =>
      resolvedLines
        .map((line) => line.segments.map((s) => s.text).join(''))
        .join(' '),
    [resolvedLines],
  )

  /** lines → word/space groups (with optional forced word atoms from `words`) */
  const lineGroups = useMemo(() => {
    // `words` prop: each entry is one atomic word (may include className)
    if (Array.isArray(wordsProp) && wordsProp.length && !(Array.isArray(lines) && lines.length)) {
      const groups = []
      wordsProp.forEach((entry, index) => {
        const text = typeof entry === 'string' ? entry : String(entry?.text ?? '')
        const wordClass = typeof entry === 'object' && entry?.className ? entry.className : ''
        if (!text) return
        if (index > 0) {
          groups.push({ type: 'space', key: `sp-words-${index}` })
        }
        const chars = [...text].map((char, charIndex) => ({
          key: `words-${index}-${charIndex}`,
          char,
          className: wordClass,
        }))
        groups.push({ type: 'word', key: `w-words-${index}`, chars })
      })
      return [{ key: 'line-0', lineClass: '', groups }]
    }

    return resolvedLines.map((line, lineIndex) => {
      const groups = []
      line.segments.forEach((segment, segIndex) => {
        const part = tokenizeLine(
          segment.text,
          segment.className || '',
          `l${lineIndex}-s${segIndex}`,
        )
        groups.push(...part)
      })
      return { key: `line-${lineIndex}`, lineClass: line.lineClass || '', groups }
    })
  }, [resolvedLines, wordsProp, lines])

  // Hide chars before paint — reveal runs in useEffect so ScrollTrigger refs exist.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || reducedMotion) return undefined

    const targets = root.querySelectorAll('.at-char')
    if (!targets.length) return undefined

    if (instant) {
      root.classList.remove('is-reveal-pending')
      root.classList.add('is-instant', 'is-revealed')
      gsap.set(targets, { opacity: 1, filter: 'blur(0px)', y: 0 })
      return undefined
    }

    root.classList.add('is-reveal-pending')
    root.classList.remove('is-revealed', 'is-instant')
    delete root.dataset.atRevealed
    gsap.set(targets, { opacity: 0, filter: 'blur(20px)', y: 0 })
    return undefined
  }, [label, replayKey, reducedMotion, instant])

  useEffect(() => {
    const root = rootRef.current
    if (!root || reducedMotion) return undefined

    const targets = root.querySelectorAll('.at-char')
    if (!targets.length) return undefined

    if (instant) {
      gsap.set(targets, { opacity: 1, filter: 'blur(0px)', y: 0 })
      root.classList.remove('is-reveal-pending')
      root.classList.add('is-revealed')
      root.dataset.atRevealed = '1'
      root.dispatchEvent(new Event('at-revealed'))
      return undefined
    }

    if (!play) {
      gsap.set(targets, { opacity: 0, filter: 'blur(20px)', y: 0 })
      root.classList.add('is-reveal-pending')
      root.classList.remove('is-revealed')
      return undefined
    }

    const ctx = gsap.context(() => {
      const reveal = {
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        duration,
        stagger,
        delay,
        ease: 'power2.out',
        onComplete: () => {
          root.classList.remove('is-reveal-pending')
          root.classList.add('is-revealed')
          // Drop inline filter from the entrance so the blur-wave CSS var can paint.
          if (blurSweepEnabled) {
            gsap.set(targets, { clearProps: 'filter' })
          }
          root.dataset.atRevealed = '1'
          root.dispatchEvent(new Event('at-revealed'))
        },
      }

      if (scrollTriggerProp) {
        const raw = scrollTriggerProp === true ? {} : scrollTriggerProp
        const triggerEl = resolveScrollTriggerElement(raw, root)

        gsap.fromTo(
          targets,
          { opacity: 0, filter: 'blur(20px)', y: 0 },
          {
            ...reveal,
            scrollTrigger: {
              start: 'top top',
              ...raw,
              trigger: triggerEl,
            },
          },
        )
      } else {
        gsap.fromTo(
          targets,
          { opacity: 0, filter: 'blur(20px)', y: 0 },
          reveal,
        )
      }
    }, root)

    return () => {
      ctx.revert()
    }
  }, [
    label,
    delay,
    duration,
    stagger,
    reducedMotion,
    replayKey,
    scrollTriggerProp,
    instant,
    play,
    blurSweepEnabled,
  ])

  // Letter-by-letter blur wave. Starts after the entry reveal finishes so
  // both animations don't fight over `filter` on the same characters.
  useEffect(() => {
    if (!blurSweepEnabled || !blurSweepOpts || !play) return undefined
    const root = rootRef.current
    if (!root) return undefined

    const chars = [...root.querySelectorAll('.at-char')]
    if (!chars.length) return undefined

    const {
      loop: LOOP,
      letter: LETTER,
      step: STEP,
      blur: BLUR_PX,
      postReveal: POST_REVEAL,
      charOffset,
      waveLength,
    } = blurSweepOpts

    let disposed = false
    let inView = !scrollTriggerProp
    let ctx = null
    let timer = 0

    const clearLetterFilters = () => {
      gsap.set(chars, { clearProps: 'filter,--at-blur' })
      chars.forEach((char) => {
        char.style.removeProperty('--at-blur')
        char.style.willChange = 'auto'
      })
    }

    const killWave = () => {
      window.clearTimeout(timer)
      timer = 0
      sweepTlRef.current = null
      ctx?.revert()
      ctx = null
    }

    const disarmWave = () => {
      killWave()
      clearLetterFilters()
    }

    const buildWave = () => {
      if (disposed || !rootRef.current || ctx || !inView) return

      clearLetterFilters()

      // Group by visual line so multi-line titles wave in parallel
      // (same column index on every line pulses together).
      const lineNodes = [...root.querySelectorAll('.at-line')]
      const lineCharLists = (
        lineNodes.length
          ? lineNodes.map((line) => [...line.querySelectorAll('.at-char')])
          : [chars]
      ).filter((list) => list.length > 0)
      const maxLineLen = lineCharLists.reduce(
        (max, list) => Math.max(max, list.length),
        0,
      )
      const waveSpan = waveLength ?? charOffset + maxLineLen

      ctx = gsap.context(() => {
        const tl = gsap.timeline({
          repeat: -1,
          paused: blurSweepOpts.visible === false,
        })
        sweepTlRef.current = tl

        lineCharLists.forEach((lineChars) => {
          lineChars.forEach((char, indexInLine) => {
            const waveIndex = charOffset + indexInLine
            const rise = LETTER * 0.28
            const fall = LETTER * 0.72
            const at = waveIndex * STEP

            // Animate --at-blur (px unitless) — CSS maps it to filter:blur().
            // Avoids fighting the reveal tween's leftover inline `filter`.
            tl.set(
              char,
              {
                '--at-blur': 0,
                willChange: 'filter',
              },
              at,
            )
            tl.to(
              char,
              {
                '--at-blur': BLUR_PX,
                duration: rise,
                ease: 'sine.in',
              },
              at,
            )
            tl.to(
              char,
              {
                '--at-blur': 0,
                duration: fall,
                ease: 'power1.out',
                onComplete: () => {
                  char.style.removeProperty('--at-blur')
                  char.style.willChange = 'auto'
                },
              },
              at + rise,
            )
          })
        })

        const used = Math.max(waveSpan - 1, 0) * STEP + LETTER
        tl.to({}, { duration: Math.max(0.4, LOOP - used) })
      }, root)
    }

    /** Arm after reveal settles — no extra fake entry delay (reveal already ran). */
    const armWave = () => {
      if (disposed || !inView) return
      killWave()
      const waitMs = Math.round(Math.max(0, POST_REVEAL) * 1000)
      timer = window.setTimeout(buildWave, waitMs)
    }

    const tryArmAfterReveal = () => {
      if (root.dataset.atRevealed === '1') armWave()
    }

    const onRevealed = () => {
      tryArmAfterReveal()
    }

    root.addEventListener('at-revealed', onRevealed)

    let scrollGate = null
    if (scrollTriggerProp) {
      const raw = scrollTriggerProp === true ? {} : scrollTriggerProp
      const triggerEl = resolveScrollTriggerElement(raw, root)
      // Drop tween-only fields. Default `end` must be AFTER `start` in scroll
      // order — `bottom bottom` with `top 72%` inverted on short sections and
      // immediately disarmed the wave (the PDP lifestyle bug).
      const { toggleActions: _toggleActions, ...stVars } = raw
      scrollGate = ScrollTrigger.create({
        start: 'top 80%',
        end: 'bottom top',
        ...stVars,
        trigger: triggerEl,
        onEnter: () => {
          inView = true
          tryArmAfterReveal()
        },
        onEnterBack: () => {
          inView = true
          tryArmAfterReveal()
        },
        onLeave: () => {
          inView = false
          disarmWave()
        },
        onLeaveBack: () => {
          inView = false
          disarmWave()
        },
      })
      inView = Boolean(scrollGate.isActive)
      if (inView) tryArmAfterReveal()
    } else {
      // Mount / no-scroll path — arm when reveal finishes (or immediately if already done).
      tryArmAfterReveal()
    }

    return () => {
      disposed = true
      root.removeEventListener('at-revealed', onRevealed)
      disarmWave()
      scrollGate?.kill()
    }
  }, [
    blurSweepEnabled,
    blurSweepOpts?.loop,
    blurSweepOpts?.letter,
    blurSweepOpts?.step,
    blurSweepOpts?.blur,
    blurSweepOpts?.postReveal,
    blurSweepOpts?.visible,
    blurSweepOpts?.charOffset,
    blurSweepOpts?.waveLength,
    blurSweepOpts?.entrySpan,
    label,
    delay,
    duration,
    stagger,
    replayKey,
    instant,
    play,
    scrollTriggerProp,
  ])

  // Toggle visibility / pause without rebuilding the timeline.
  useEffect(() => {
    if (!blurSweepEnabled) return
    const root = rootRef.current
    const tl = sweepTlRef.current
    if (!tl) return
    const chars = root?.querySelectorAll('.at-char')
    if (blurSweepVisible) {
      if (tl.paused()) tl.play()
    } else {
      tl.pause(0)
      if (chars?.length) {
        gsap.set(chars, { clearProps: 'filter,--at-blur' })
        chars.forEach((char) => {
          char.style.removeProperty('--at-blur')
          char.style.willChange = 'auto'
        })
      }
    }
  }, [blurSweepEnabled, blurSweepVisible, label, replayKey])

  return (
    <Tag
      ref={rootRef}
      className={`at-title${className ? ` ${className}` : ''}${blurSweepEnabled ? ' at-title--blur-sweep' : ''}${blurSweepEnabled && !blurSweepVisible ? ' is-blur-hidden' : ''}`}
      aria-label={label}
    >
      {lineGroups.map((line) => (
        <span
          key={line.key}
          className={`at-line${line.lineClass ? ` ${line.lineClass}` : ''}`}
          aria-hidden="true"
        >
          {line.groups.map((group) => {
            if (group.type === 'space') {
              return (
                <span key={group.key} className="at-space">
                  {' '}
                </span>
              )
            }

            return (
              <span key={group.key} className="at-word">
                {group.chars.map(({ key, char, className: charClass }) => (
                  <span
                    key={key}
                    className={`at-char${charClass ? ` ${charClass}` : ''}`}
                  >
                    {char}
                  </span>
                ))}
              </span>
            )
          })}
        </span>
      ))}
    </Tag>
  )
}
