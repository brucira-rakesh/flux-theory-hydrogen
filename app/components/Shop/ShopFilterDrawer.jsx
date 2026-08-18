import { useEffect, useId, useRef } from 'react'
import gsap from 'gsap'
import { FACE_FILTER_ENABLED, FILTER_TAGS, PRICE_FILTERS } from '../../data/shop'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import { useSmoothScrollLock } from '../SmoothScroll/SmoothScroll'

/**
 * Right filter drawer — category, mood tags, price.
 */
export default function ShopFilterDrawer({
  open,
  onClose,
  category,
  onCategoryChange,
  tags,
  onTagsChange,
  priceId,
  onPriceChange,
  onClear,
  resultCount,
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const backdropRef = useRef(null)
  const closeRef = useRef(null)

  useSmoothScrollLock('shop-filter-drawer', open)

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()

    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    const panel = panelRef.current
    const backdrop = backdropRef.current
    if (!panel || !backdrop) return undefined

    if (!open) {
      if (prefersReducedMotion()) {
        gsap.set(panel, { x: '105%' })
        gsap.set(backdrop, { opacity: 0, pointerEvents: 'none' })
      }
      return undefined
    }

    if (prefersReducedMotion()) {
      gsap.set(backdrop, { opacity: 1, pointerEvents: 'auto' })
      gsap.set(panel, { x: 0 })
      return undefined
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdrop,
        { opacity: 0 },
        { opacity: 1, duration: 0.35, ease: 'power2.out', pointerEvents: 'auto' },
      )
      gsap.fromTo(
        panel,
        { x: '105%' },
        { x: 0, duration: 0.5, ease: 'power3.out' },
      )
    })

    return () => ctx.revert()
  }, [open])

  const toggleTag = (id) => {
    if (tags.includes(id)) onTagsChange(tags.filter((t) => t !== id))
    else onTagsChange([...tags, id])
  }

  const handleClose = () => {
    const panel = panelRef.current
    const backdrop = backdropRef.current
    if (!panel || !backdrop || prefersReducedMotion()) {
      onClose?.()
      return
    }
    const tl = gsap.timeline({
      onComplete: () => onClose?.(),
    })
    tl.to(panel, { x: '105%', duration: 0.38, ease: 'power3.in' }, 0)
    tl.to(backdrop, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 0)
  }

  return (
    <div className={`shop-filter${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <button
        ref={backdropRef}
        type="button"
        className="shop-filter__backdrop"
        aria-label="Close filters"
        tabIndex={open ? 0 : -1}
        onClick={handleClose}
      />
      <aside
        ref={panelRef}
        className="shop-filter__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
      >
        <div className="shop-filter__head">
          <h2 id={titleId} className="shop-filter__title">
            Filters
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="shop-filter__close"
            aria-label="Close filters"
            tabIndex={open ? 0 : -1}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        <div className="shop-filter__body">
          <fieldset className="shop-filter__group">
            <legend className="shop-filter__legend">Category</legend>
            <div className="shop-filter__choices">
              {[
                { id: 'all', label: 'All' },
                { id: 'body', label: 'Body' },
                // FACE_FILTER: re-enable when Clarity/Pulse/Ember/Muse exist in Shopify admin.
                ...(FACE_FILTER_ENABLED ? [{ id: 'face', label: 'Face' }] : []),
              ].map((opt) => (
                <label key={opt.id} className="shop-filter__choice">
                  <input
                    type="radio"
                    name="shop-category"
                    checked={category === opt.id}
                    onChange={() => onCategoryChange(opt.id)}
                    tabIndex={open ? 0 : -1}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="shop-filter__group">
            <legend className="shop-filter__legend">Mood</legend>
            <div className="shop-filter__chips">
              {FILTER_TAGS.map((tag) => {
                const active = tags.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`shop-filter__chip${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    tabIndex={open ? 0 : -1}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="shop-filter__group">
            <legend className="shop-filter__legend">Price</legend>
            <div className="shop-filter__choices">
              {PRICE_FILTERS.map((opt) => (
                <label key={opt.id} className="shop-filter__choice">
                  <input
                    type="radio"
                    name="shop-price"
                    checked={priceId === opt.id}
                    onChange={() => onPriceChange(opt.id)}
                    tabIndex={open ? 0 : -1}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="shop-filter__foot">
          <button
            type="button"
            className="shop-filter__clear"
            tabIndex={open ? 0 : -1}
            onClick={onClear}
          >
            Clear all
          </button>
          <button
            type="button"
            className="shop-filter__apply"
            tabIndex={open ? 0 : -1}
            onClick={handleClose}
          >
            Show {resultCount} {resultCount === 1 ? 'product' : 'products'}
          </button>
        </div>
      </aside>
    </div>
  )
}
