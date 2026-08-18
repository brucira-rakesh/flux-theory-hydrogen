import CustomSelect from '../Shop/CustomSelect'
import { AddToCartButton } from '../AddToCartButton'
import { useCartDrawer } from '../Cart/CartProvider'
import { cartLinesForMerchandise } from '~/lib/storefrontCatalog'

export default function PdpControls({
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
}) {
  const { openCart } = useCartDrawer()
  const formatPrice = (value) =>
    Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  const sizeOptions = (sizes ?? []).map((option) => ({
    id: option,
    label: option,
  }))
  const showSizeSelect = sizeOptions.length > 1
  const lines = cartLinesForMerchandise(
    merchandiseId,
    quantity,
    selectedVariant,
  )
  const canAdd = Boolean(lines.length) && availableForSale !== false

  return (
    <div className={`pdp-controls${className ? ` ${className}` : ''}`}>
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
      </div>
    </div>
  )
}
