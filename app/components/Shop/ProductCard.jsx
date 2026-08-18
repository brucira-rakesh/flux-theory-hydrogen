import { Link } from 'react-router-dom'
import cartIcon from '../../assets/pdp/icon-cart.svg'

function formatPrice(value) {
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * PDP-matching product card for PLP grid + similar rail.
 */
export default function ProductCard({
  product,
  onQuickAdd,
  quickAddOpen = false,
  className = '',
  showQuickAdd = true,
}) {
  const key = product.listId ?? product.id

  return (
    <article className={`product-card${className ? ` ${className}` : ''}`} data-product-card={key}>
      {product.href ? (
        <Link to={product.href} className="product-card__media">
          <img src={product.image} alt="" draggable={false} />
        </Link>
      ) : (
        <div className="product-card__media">
          <img src={product.image} alt="" draggable={false} />
        </div>
      )}

      <div className="product-card__meta">
        <div>
          {product.href ? (
            <Link to={product.href} className="product-card__name">
              {product.name}
            </Link>
          ) : (
            <p className="product-card__name">{product.name}</p>
          )}
          <p className="product-card__price">
            {product.currency}
            {formatPrice(product.price)}
          </p>
        </div>
        {showQuickAdd ? (
          <button
            type="button"
            className="product-card__cart"
            aria-label={`Quick add ${product.name}`}
            aria-haspopup="dialog"
            aria-expanded={quickAddOpen}
            onClick={() => onQuickAdd?.(product)}
          >
            <img src={cartIcon} alt="" width={40} height={40} />
          </button>
        ) : null}
      </div>
    </article>
  )
}
