import { useId } from 'react'
import { formatShopPrice } from '../../data/shop'

/**
 * Dual-handle price range slider for the shop filter drawer.
 * No shared slider component exists elsewhere in the storefront — this is
 * built to match the drawer's visual language (Geist / shop tokens).
 */
export default function PriceRangeSlider({
  bounds,
  value,
  onChange,
  currency = '₹',
  disabled = false,
  tabIndex = -1,
}) {
  const labelId = useId()
  const { min: boundMin, max: boundMax } = bounds
  const samePrice = boundMin >= boundMax
  const valueMin = Math.max(boundMin, Math.min(value.min, value.max))
  const valueMax = Math.min(boundMax, Math.max(value.min, value.max))
  const span = Math.max(boundMax - boundMin, 1)
  const fillLeft = ((valueMin - boundMin) / span) * 100
  const fillWidth = ((valueMax - valueMin) / span) * 100

  const setMin = (nextMin) => {
    const clamped = Math.max(boundMin, Math.min(nextMin, valueMax))
    onChange({ min: clamped, max: valueMax })
  }

  const setMax = (nextMax) => {
    const clamped = Math.min(boundMax, Math.max(nextMax, valueMin))
    onChange({ min: valueMin, max: clamped })
  }

  if (samePrice) {
    return (
      <div className="shop-price-range shop-price-range--static">
        <p className="shop-price-range__values" id={labelId}>
          {formatShopPrice(boundMin, currency)}
        </p>
        <p className="shop-price-range__hint">All products share this price.</p>
      </div>
    )
  }

  return (
    <div className={`shop-price-range${disabled ? ' is-disabled' : ''}`}>
      <p className="shop-price-range__values" id={labelId}>
        {formatShopPrice(valueMin, currency)}
        <span aria-hidden="true"> – </span>
        {formatShopPrice(valueMax, currency)}
      </p>

      <div className="shop-price-range__track-wrap">
        <div className="shop-price-range__track">
          <div
            className="shop-price-range__fill"
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
            aria-hidden="true"
          />
          <input
            type="range"
            className="shop-price-range__input shop-price-range__input--min"
            min={boundMin}
            max={boundMax}
            step={1}
            value={valueMin}
            disabled={disabled}
            tabIndex={tabIndex}
            aria-labelledby={labelId}
            aria-label="Minimum price"
            onInput={(event) => setMin(Number(event.target.value))}
          />
          <input
            type="range"
            className="shop-price-range__input shop-price-range__input--max"
            min={boundMin}
            max={boundMax}
            step={1}
            value={valueMax}
            disabled={disabled}
            tabIndex={tabIndex}
            aria-labelledby={labelId}
            aria-label="Maximum price"
            onInput={(event) => setMax(Number(event.target.value))}
          />
        </div>
        <div className="shop-price-range__bounds" aria-hidden="true">
          <span>{formatShopPrice(boundMin, currency)}</span>
          <span>{formatShopPrice(boundMax, currency)}</span>
        </div>
      </div>
    </div>
  )
}
