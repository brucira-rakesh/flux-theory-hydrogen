import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import gsap from 'gsap'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import CustomSelect from './CustomSelect'
import { AddToCartButton } from '../AddToCartButton'
import { useCartDrawer } from '../Cart/CartProvider'
import {
  cartLinesForMerchandise,
  shouldShowSizeSelect,
} from '~/lib/storefrontCatalog'

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
export default function ProductFormPopup({
  product,
  onClose,
  onAdd,
  initialSize,
  initialQuantity,
  onSizeChange: onSizeChangeProp,
  onQuantityChange: onQuantityChangeProp,
  // When provided, ATC acts as a connector — submits the hero form instead of
  // rendering its own CartForm. Used only on PDP. PLP/similar pass nothing here.
  heroControlsRef,
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const backdropRef = useRef(null)
  const closeRef = useRef(null)
  const sizes = product.sizes ?? []
  const [size, setSize] = useState(initialSize ?? product.defaultSize ?? sizes[0] ?? '')
  const [quantity, setQuantity] = useState(initialQuantity ?? 1)
  const { openCart } = useCartDrawer()
  const showSizeSelect = shouldShowSizeSelect(sizes)
  const sizeOptions = sizes.map((option) => ({ id: option, label: option }))

  const handleSizeChange = (value) => {
    setSize(value)
    onSizeChangeProp?.(value)
  }

  const handleQuantityChange = (next) => {
    setQuantity(next)
    onQuantityChangeProp?.(next)
  }

  const selectedVariant = showSizeSelect
    ? product.variantBySize?.[size] ?? null
    : null

  const selectedMerchandiseId = selectedVariant?.id ?? product.variantGid
  const canAdd = showSizeSelect
    ? Boolean(selectedVariant?.id) && selectedVariant.availableForSale !== false
    : Boolean(selectedMerchandiseId)
  const lines = canAdd
    ? cartLinesForMerchandise(selectedMerchandiseId, quantity)
    : []

  useEffect(() => {
    setSize(initialSize ?? product.defaultSize ?? product.sizes?.[0] ?? '')
    setQuantity(initialQuantity ?? 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.listId])

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
  }

  const handleSuccess = () => {
    onClose?.()
  }

  const handleConnectorClick = () => {
    if (!canAdd) return
    heroControlsRef.current?.submit()
    onAdd?.(product, { size, quantity })
    onClose?.()
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
            <img src={product.image ?? product.stickyThumb} alt="" draggable={false} />
          </div>
          <div>
            <h3 id={titleId} className="product-form-popup__name">
              {product.name}
            </h3>
            <p className="product-form-popup__price">
              {selectedVariant?.priceCurrency ?? product.currency}
              {formatPrice(selectedVariant?.priceAmount ?? product.price)}
            </p>
          </div>
        </div>

        <div className="product-form-popup__controls">
          <div className="product-form-popup__qty" role="group" aria-label="Quantity">
            <span className="product-form-popup__label">Quantity</span>
            <div className="product-form-popup__qty-control">
              <button
                type="button"
                className="product-form-popup__qty-btn"
                aria-label="Decrease quantity"
                onClick={() => handleQuantityChange(Math.max(1, quantity - 1))}
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
                onClick={() => handleQuantityChange(quantity + 1)}
              >
                +
              </button>
            </div>
          </div>

          {showSizeSelect ? (
            <CustomSelect
              className="product-form-popup__size-select"
              label="Size"
              ariaLabel={`Select size for ${product.name}`}
              options={sizeOptions}
              value={size}
              onChange={handleSizeChange}
            />
          ) : null}
        </div>

        {heroControlsRef ? (
          // Connector mode (PDP): submits the hero's CartForm, no form here.
          <button
            type="button"
            className="product-form-popup__atc"
            disabled={!canAdd}
            onClick={handleConnectorClick}
          >
            Add to Cart
          </button>
        ) : (
          // Standalone mode (PLP / similar): own CartForm.
          <AddToCartButton
            className="product-form-popup__atc"
            lines={lines}
            disabled={!lines.length}
            onClick={handleAdded}
            onSuccess={handleSuccess}
          >
            Add to Cart
          </AddToCartButton>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(ui, document.body)
}
