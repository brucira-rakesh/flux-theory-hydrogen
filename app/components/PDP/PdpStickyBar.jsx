import { useEffect, useRef, useState } from 'react'
import PdpControls from './PdpControls'
import ProductFormPopup from '../Shop/ProductFormPopup'
import { useSmoothScrollLock } from '../SmoothScroll/SmoothScroll'
import { getLenis } from '../SmoothScroll/smoothScrollApi'

/**
 * Keep the fixed ATC bar from sliding under the footer: as the footer's top
 * edge enters the viewport, raise `bottom` by the intrusion so the bar docks
 * on the footer and scrolls away with the page. Driven from Lenis's scroll
 * event (falls back to window scroll) so it stays in sync with smooth wheel
 * lerp — getBoundingClientRect reflects the visual position either way.
 *
 * Also publishes the bar's LIVE height as `--pdp-sticky-bar-h` on `.pdp-page`
 * so lower-page content (Similar Products) reserves scroll room and isn't
 * covered by the fixed bar. Height is re-measured every dock tick and via
 * ResizeObserver — never cached from a prior bar size.
 *
 * IntersectionObserver on the footer-top sentinel is the gate: we only attach
 * the scroll listener while the sentinel is in or above the viewport.
 */
function useStickyFooterDock(barRef, sentinelRef, visible) {
  useEffect(() => {
    const bar = barRef.current
    const sentinel = sentinelRef?.current
    if (!bar || !sentinel) return undefined

    const page = bar.closest('.pdp-page')

    const syncBarHeight = () => {
      if (!page) return
      // Only reserve space while the bar is actually shown.
      const h = visible ? bar.getBoundingClientRect().height : 0
      page.style.setProperty('--pdp-sticky-bar-h', `${Math.ceil(h)}px`)
    }

    const updateDock = () => {
      const top = sentinel.getBoundingClientRect().top
      // Live height every tick — dock position itself is footer intrusion,
      // but clearance padding must track the current (post-resize) bar.
      syncBarHeight()
      const dock = Math.max(0, window.innerHeight - top)
      bar.style.setProperty('--pdp-sticky-dock', `${dock}px`)
    }

    let listening = false
    let lenis = null

    const start = () => {
      if (listening) return
      listening = true
      lenis = getLenis()
      if (lenis) lenis.on('scroll', updateDock)
      window.addEventListener('scroll', updateDock, {passive: true})
    }

    const stop = () => {
      if (!listening) return
      listening = false
      if (lenis) lenis.off('scroll', updateDock)
      lenis = null
      window.removeEventListener('scroll', updateDock)
    }

    let io
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          updateDock()
          // Keep tracking while the sentinel is visible OR has scrolled up
          // past the viewport (bar stays docked off-screen). Stop only when
          // the footer is fully below, so dock can snap back to 0.
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) start()
          else stop()
        },
        {threshold: 0, rootMargin: '0px'},
      )
      io.observe(sentinel)
    } else {
      start()
    }

    window.addEventListener('resize', updateDock)
    updateDock()

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncBarHeight()
            updateDock()
          })
        : null
    ro?.observe(bar)

    // Ancestor SmoothScroll registers Lenis in its own effect (runs after
    // this one). Re-attach on the next frame so we subscribe to Lenis.scroll
    // rather than relying only on native scroll events.
    const raf = window.requestAnimationFrame(() => {
      if (!listening) return
      const next = getLenis()
      if (next && next !== lenis) {
        if (lenis) lenis.off('scroll', updateDock)
        lenis = next
        lenis.on('scroll', updateDock)
      }
    })

    return () => {
      window.cancelAnimationFrame(raf)
      io?.disconnect()
      ro?.disconnect()
      stop()
      window.removeEventListener('resize', updateDock)
      bar.style.removeProperty('--pdp-sticky-dock')
      page?.style.removeProperty('--pdp-sticky-bar-h')
    }
  }, [sentinelRef, visible])
}

export default function PdpStickyBar({
  product,
  size,
  quantity,
  onSizeChange,
  onQuantityChange,
  visible = false,
  onAdd,
  heroControlsRef,
  footerSentinelRef,
}) {
  const [popupOpen, setPopupOpen] = useState(false)
  const barRef = useRef(null)

  useSmoothScrollLock('pdp-sticky-popup', popupOpen)
  useStickyFooterDock(barRef, footerSentinelRef, visible)

  return (
    <>
      <aside
        ref={barRef}
        className={`pdp-sticky${visible ? ' is-visible' : ''}`}
        aria-label="Quick add to cart"
        aria-hidden={!visible}
        inert={!visible ? true : undefined}
      >
        <div className="pdp-sticky__product">
          {product.stickyThumb ? (
            <div className="pdp-sticky__thumb">
              <img src={product.stickyThumb} alt={product.name} draggable={false} />
            </div>
          ) : null}
          <div className="pdp-sticky__copy">
            <p className="pdp-sticky__title">{product.name}</p>
            <p className="pdp-sticky__price">
              {product.currency}
              {Number(product.price).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>

        {/* Desktop/tablet: connector controls — no CartForm, submits hero's form.
            Price lives under the title (not in this control cluster). */}
        <PdpControls
          className="pdp-sticky__controls"
          sizes={product.sizes}
          size={size}
          onSizeChange={onSizeChange}
          quantity={quantity}
          onQuantityChange={onQuantityChange}
          price={product.price}
          currency={product.currency}
          merchandiseId={product.variantGid}
          selectedVariant={product.selectedVariant}
          availableForSale={product.availableForSale}
          showPrice={false}
          connectorMode
          heroControlsRef={heroControlsRef}
        />

        {/* Mobile only: single ATC button that opens popup */}
        <button
          type="button"
          className="pdp-sticky__mobile-atc"
          onClick={() => setPopupOpen(true)}
        >
          Add to Cart
        </button>
      </aside>

      {popupOpen && (
        <ProductFormPopup
          product={product}
          initialSize={size}
          initialQuantity={quantity}
          onSizeChange={onSizeChange}
          onQuantityChange={onQuantityChange}
          heroControlsRef={heroControlsRef}
          onClose={() => setPopupOpen(false)}
          onAdd={(p, opts) => {
            setPopupOpen(false)
            onAdd?.(p, opts)
          }}
        />
      )}
    </>
  )
}
