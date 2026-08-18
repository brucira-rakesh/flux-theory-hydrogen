import PdpControls from './PdpControls'

export default function PdpStickyBar({
  product,
  size,
  quantity,
  onSizeChange,
  onQuantityChange,
  visible = false,
}) {
  return (
    <aside
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
          <p className="pdp-sticky__blurb">{product.shortDescription}</p>
        </div>
      </div>

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
      />
    </aside>
  )
}
