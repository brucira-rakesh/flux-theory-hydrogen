import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import gsap from 'gsap'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import CustomSelect from './CustomSelect'
import { AddToCartButton } from '../AddToCartButton'
import { useCartDrawer } from '../Cart/CartProvider'
import { cartLinesForMerchandise } from '~/lib/storefrontCatalog'

function formatPrice(value) {
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Size + quantity + ATC popup — portaled to body so GSAP transforms on
 * ancestors (e.g. PDP reveal wrappers) can't break position:fixed.
 */
export default function ProductFormPopup({ product, onClose, onAdd }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const backdropRef = useRef(null)
  const closeRef = useRef(null)
  const [size, setSize] = useState(product.defaultSize ?? product.sizes?.[0] ?? '300ml')
  const [quantity, setQuantity] = useState(1)
  const { openCart } = useCartDrawer()
  const sizes = product.sizes?.length ? product.sizes : ['300ml', '500ml']
  const sizeOptions = sizes.map((option) => ({ id: option, label: option }))
  const lines = cartLinesForMerchandise(product.variantGid, quantity)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const panel = panelRef.current
    const backdrop = backdropRef.current
    if (!panel || !backdrop) return undefined

    if (prefersReducedMotion()) {
      gsap.set(backdrop, { opacity: 1 })
      gsap.set(panel, { opacity: 1, y: 0 })
      return undefined
    }

    const mobile = window.matchMedia('(max-width: 600px)').matches
    const ctx = gsap.context(() => {
      gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' })
      gsap.fromTo(
        panel,
        { opacity: 0, y: mobile ? 48 : 28, scale: mobile ? 1 : 0.98 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.45,
          ease: 'power3.out',
        },
      )
    })

    return () => ctx.revert()
  }, [])

  const handleAdded = () => {
    openCart()
    onAdd?.(product, { size, quantity })
    // Defer unmount so CartForm's submit can fire; removing the form in the
    // same click handler would cancel Hydrogen's POST to /cart.
    window.setTimeout(() => onClose?.(), 0)
  }

  const ui = (
    <div className="product-form-popup" role="presentation">
      <button
        ref={backdropRef}
        type="button"
        className="product-form-popup__backdrop"
        aria-label="Close add to cart"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="product-form-popup__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          type="button"
          className="product-form-popup__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        <div className="product-form-popup__product">
          <div className="product-form-popup__thumb">
            <img src={product.image} alt="" draggable={false} />
          </div>
          <div>
            <h3 id={titleId} className="product-form-popup__name">
              {product.name}
            </h3>
            <p className="product-form-popup__price">
              {product.currency}
              {formatPrice(product.price)}
            </p>
          </div>
        </div>

        <CustomSelect
          className="product-form-popup__size-select"
          label="Size"
          ariaLabel={`Select size for ${product.name}`}
          options={sizeOptions}
          value={size}
          onChange={setSize}
        />

        <div className="product-form-popup__qty" role="group" aria-label="Quantity">
          <span className="product-form-popup__label">Quantity</span>
          <div className="product-form-popup__qty-control">
            <button
              type="button"
              className="product-form-popup__qty-btn"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
            >
              −
            </button>
            <span className="product-form-popup__qty-value" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="product-form-popup__qty-btn"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </button>
          </div>
        </div>

        <AddToCartButton
          className="product-form-popup__atc"
          lines={lines}
          disabled={!lines.length}
          onClick={handleAdded}
        >
          Add to Cart
        </AddToCartButton>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(ui, document.body)
}
