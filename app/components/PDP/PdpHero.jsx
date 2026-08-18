import { useRef } from 'react'
import { Link } from 'react-router-dom'
import PdpControls from './PdpControls'
import PdpAutoplayVideo from './PdpAutoplayVideo'

export default function PdpHero({
  product,
  size,
  quantity,
  onSizeChange,
  onQuantityChange,
  formRef,
}) {
  const galleryRef = useRef(null)
  const dragRef = useRef({
    active: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  })

  const onPointerDown = (event) => {
    const track = galleryRef.current
    if (!track || event.button !== 0) return

    dragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: track.scrollLeft,
      moved: false,
    }
    track.setPointerCapture(event.pointerId)
    track.classList.add('is-dragging')
  }

  const onPointerMove = (event) => {
    const track = galleryRef.current
    const drag = dragRef.current
    if (!track || !drag.active) return

    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 4) drag.moved = true
    track.scrollLeft = drag.scrollLeft - delta
  }

  const endDrag = (event) => {
    const track = galleryRef.current
    const drag = dragRef.current
    if (!track || !drag.active) return

    drag.active = false
    track.classList.remove('is-dragging')
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId)
    }
  }

  const onClickCapture = (event) => {
    if (dragRef.current.moved) {
      event.preventDefault()
      event.stopPropagation()
      dragRef.current.moved = false
    }
  }

  return (
    <section className="pdp-hero" aria-label={`${product.name} product hero`}>
      <nav className="pdp-breadcrumb" aria-label="Breadcrumb">
        {product.breadcrumb.map((crumb, index) => {
          const isLast = index === product.breadcrumb.length - 1
          return (
            <span key={crumb} className="pdp-breadcrumb__item">
              {index > 0 && (
                <span className="pdp-breadcrumb__sep" aria-hidden="true">
                  /
                </span>
              )}
              {isLast ? (
                <span className="pdp-breadcrumb__current">{crumb}</span>
              ) : (
                <Link
                  to={index === 0 ? '/' : '#'}
                  className="pdp-breadcrumb__link"
                >
                  {crumb}
                </Link>
              )}
            </span>
          )
        })}
      </nav>

      <div
        ref={galleryRef}
        className="pdp-gallery"
        role="list"
        aria-label="Product images"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {product.gallery.map((item) => (
          <figure
            key={item.id}
            className={`pdp-gallery__item pdp-gallery__item--${item.id}`}
            role="listitem"
          >
            {item.kind === 'video' ? (
              <PdpAutoplayVideo
                sources={item.sources}
                poster={item.poster}
                className="pdp-gallery__video"
                ariaLabel={item.alt}
              />
            ) : (
              <img src={item.src} alt={item.alt} draggable={false} />
            )}
          </figure>
        ))}
      </div>

      <div ref={formRef} className="pdp-hero__info">
        <div className="pdp-hero__copy">
          <h1 className="pdp-hero__title">{product.name}</h1>
          <p className="pdp-hero__blurb">{product.shortDescription}</p>
        </div>

        <PdpControls
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
      </div>
    </section>
  )
}
