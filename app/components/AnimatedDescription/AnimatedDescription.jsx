import { Fragment, useEffect, useMemo, useRef } from 'react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import './AnimatedDescription.css'

gsap.registerPlugin(SplitText, ScrollTrigger)

/**
 * @param {string} text
 * @param {string} keyPrefix
 */
function wordsFromText(text, keyPrefix) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      key: `${keyPrefix}-${index}`,
      word,
    }))
}

/**
 * Reusable description with word-by-word reveal (y + fade).
 *
 * @example
 * <AnimatedDescription>
 *   Shift isn't about becoming someone else.
 * </AnimatedDescription>
 *
 * @example Forced line breaks
 * <AnimatedDescription
 *   lines={['Every situation reveals a', 'different side of you.']}
 * />
 */
export default function AnimatedDescription({
  children,
  as: Tag = 'p',
  className = '',
  delay = 0,
  duration = 0.5,
  stagger = 0.06,
  replayKey,
  /** Forced line breaks — each entry is one line of words */
  lines,
  /**
   * When set, animates on scroll instead of mount.
   * Pass ScrollTrigger vars (trigger may be a ref) or `true`.
   */
  scrollTrigger: scrollTriggerProp,
}) {
  const rootRef = useRef(null)
  const reducedMotion = useMemo(() => prefersReducedMotion(), [])

  // Stabilize by content so new array identities from parents don't replay.
  const linesKey = Array.isArray(lines) ? lines.map(String).join('\n') : ''

  const resolvedLines = useMemo(() => {
    if (!linesKey) return null
    return linesKey.split('\n').map((line, lineIndex) => ({
      key: `ad-line-${lineIndex}`,
      words: wordsFromText(line, `l${lineIndex}`),
    }))
  }, [linesKey])

  useEffect(() => {
    const root = rootRef.current
    if (!root || reducedMotion) return undefined

    let split
    const ctx = gsap.context(() => {
      let targets

      if (resolvedLines) {
        targets = root.querySelectorAll('.ad-word')
      } else {
        split = SplitText.create(root, {
          type: 'words',
          wordsClass: 'ad-word',
        })
        targets = split.words
      }

      if (!targets?.length) return

      const fromVars = {
        opacity: 0,
        y: 10,
      }

      const toVars = {
        opacity: 1,
        y: 0,
        duration,
        stagger,
        delay,
        ease: 'power2.out',
      }

      gsap.set(targets, fromVars)

      if (scrollTriggerProp) {
        const raw = scrollTriggerProp === true ? {} : scrollTriggerProp
        const triggerEl =
          raw.trigger && typeof raw.trigger === 'object' && 'current' in raw.trigger
            ? raw.trigger.current ?? root
            : raw.trigger ?? root

        gsap.fromTo(targets, fromVars, {
          ...toVars,
          scrollTrigger: {
            start: 'top top',
            ...raw,
            trigger: triggerEl,
          },
        })
      } else {
        gsap.to(targets, toVars)
      }
    }, root)

    return () => {
      ctx.revert()
      split?.revert?.()
    }
  }, [
    children,
    delay,
    duration,
    stagger,
    reducedMotion,
    replayKey,
    scrollTriggerProp,
    linesKey,
  ])

  return (
    <Tag
      ref={rootRef}
      className={`ad-description${className ? ` ${className}` : ''}`}
    >
      {resolvedLines
        ? resolvedLines.map((line) => (
            <span key={line.key} className="ad-line">
              {line.words.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 ? ' ' : null}
                  <span className="ad-word">{item.word}</span>
                </Fragment>
              ))}
            </span>
          ))
        : children}
    </Tag>
  )
}
