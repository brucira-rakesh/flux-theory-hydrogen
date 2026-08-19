import { useState } from 'react'
import PdpControls from './PdpControls'
import ProductFormPopup from '../Shop/ProductFormPopup'
import { useSmoothScrollLock } from '../SmoothScroll/SmoothScroll'

export default function PdpStickyBar({
  product,
  size,
  quantity,
  onSizeChange,
  onQuantityChange,
  visible = false,
  onAdd,
  heroControlsRef,
}) {
  const [popupOpen, setPopupOpen] = useState(false)

  useSmoothScrollLock('pdp-sticky-popup', popupOpen)

  return (
    <>
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

        {/* Desktop/tablet: connector controls — no CartForm, submits hero's form */}
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
