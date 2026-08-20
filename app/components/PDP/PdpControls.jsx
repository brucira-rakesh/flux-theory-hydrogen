import { forwardRef, useImperativeHandle, useRef } from 'react'
import CustomSelect from '../Shop/CustomSelect'
import { AddToCartButton } from '../AddToCartButton'
import { useCartDrawer } from '../Cart/CartProvider'
import {
  cartLinesForMerchandise,
  shouldShowSizeSelect,
} from '~/lib/storefrontCatalog'

/**
 * PDP size/qty/price/ATC controls.
 *
 * Normal mode (default): renders its own CartForm via AddToCartButton.
 *
 * Connector mode (connectorMode=true): the ATC button is a plain <button>
 * that calls heroControlsRef.current.submit() — no CartForm of its own.
 * Used by the sticky bar so there is exactly one CartForm on the PDP.
 */
const PdpControls = forwardRef(function PdpControls(
  {
    sizes,
    size,
    onSizeChange,
    quantity,
    onQuantityChange,
    price,
    currency = '₹',
    merchandiseId,
    selectedVariant,
    availableForSale = true,
    showPrice = true,
    className = '',
    // Connector-mode props
    connectorMode = false,
    heroControlsRef = null,
  },
  ref,
) {
  const containerRef = useRef(null)
  const { openCart } = useCartDrawer()

  // Expose a submit() method so connector buttons can trigger this form.
  useImperativeHandle(ref, () => ({
    submit() {
      const form = containerRef.current?.querySelector('form')
      if (form) {
        openCart()
        form.requestSubmit()
      }
    },
  }))

  const formatPrice = (value) =>
    Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  const sizeOptions = (sizes ?? []).map((option) => ({
    id: option,
    label: option,
  }))
  const showSizeSelect = shouldShowSizeSelect(sizes)
  const lines = cartLinesForMerchandise(merchandiseId, quantity, selectedVariant)
  const canAdd = Boolean(lines.length) && availableForSale !== false

  const handleConnectorClick = () => {
    if (!canAdd) return
    heroControlsRef?.current?.submit()
  }

  return (
    <div ref={containerRef} className={`pdp-controls${className ? ` ${className}` : ''}`}>
      {showSizeSelect || showPrice ? (
        <div className="pdp-controls__row">
          {showSizeSelect ? (
            <CustomSelect
              className="custom-select--pdp pdp-controls__size-select"
              ariaLabel="Select size"
              options={sizeOptions}
              value={size}
              onChange={onSizeChange}
            />
          ) : null}

          {showPrice && (
            <p className="pdp-controls__price">
              {currency}
              {formatPrice(price)}
            </p>
          )}
        </div>
      ) : null}

      <div className="pdp-controls__cart-row">
        <div className="pdp-controls__qty" role="group" aria-label="Quantity">
          <button
            type="button"
            className="pdp-controls__qty-btn"
            aria-label="Decrease quantity"
            onClick={() => onQuantityChange?.(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
          >
            −
          </button>
          <span className="pdp-controls__qty-value" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            className="pdp-controls__qty-btn"
            aria-label="Increase quantity"
            onClick={() => onQuantityChange?.(quantity + 1)}
          >
            +
          </button>
        </div>

        {connectorMode ? (
          // Connector: plain button — submits the hero's CartForm, no form here.
          <button
            type="button"
            className="pdp-controls__atc"
            disabled={!canAdd}
            onClick={handleConnectorClick}
          >
            {availableForSale === false ? 'Sold out' : 'Add to Cart'}
          </button>
        ) : (
          // Normal: own CartForm via AddToCartButton.
          <AddToCartButton
            className="pdp-controls__atc"
            lines={lines}
            disabled={!canAdd}
            onClick={() => {
              if (canAdd) openCart()
            }}
          >
            {availableForSale === false ? 'Sold out' : 'Add to Cart'}
          </AddToCartButton>
        )}
      </div>
    </div>
  )
})

export default PdpControls
