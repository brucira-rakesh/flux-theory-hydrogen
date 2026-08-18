import AnimatedDescription from '../AnimatedDescription/AnimatedDescription'

export default function ProductDetailsV2({ product, detailsRef, onBuy }) {
  const tags = product?.benefits ?? []

  return (
    <aside
      ref={detailsRef}
      className="psv2-details relative right-auto bottom-auto z-[3] mx-auto mb-6 flex w-[min(92%,360px)] min-h-[330px] flex-col justify-between bg-[#feffff] text-left text-black md:absolute md:right-[clamp(0.75rem,2.2vw,1.5rem)] md:bottom-[clamp(1.25rem,4vh,2.5rem)] md:mx-0 md:mb-0 md:w-[min(calc(100%-1.5rem),343px)]"
      aria-label={product ? `${product.name} details` : 'Product details'}
      aria-hidden={!product}
    >
      <div className="psv2-details__body flex flex-col gap-[1.1rem] px-[0.95rem] pt-[1.35rem] pr-4 pb-0">
        <p className="psv2-details__price m-0 flex items-start gap-[0.2rem] capitalize leading-none tracking-[-0.04em] text-black [font-family:var(--font-title)] text-[clamp(2rem,2.8vw,2.5rem)] font-bold">
          <span className="psv2-details__currency text-[0.95em]">
            {product?.currency ?? '₹'}
          </span>
          <span>{product?.price ?? '—'}</span>
        </p>

        <ul className="psv2-details__tags m-0 flex list-none flex-wrap items-center gap-6 p-0">
          {tags.map((tag) => {
            const label = typeof tag === 'string' ? tag : tag.label
            const color = typeof tag === 'string' ? undefined : tag.color
            return (
              <li
                key={label}
                className="psv2-details__tag flex items-center gap-2 uppercase leading-none tracking-[0.02em] [font-family:var(--font-title)] text-sm font-semibold"
                style={color ? { color } : undefined}
              >
                <span
                  className="psv2-details__swatch size-2 shrink-0 bg-[#2a6db5]"
                  style={color ? { background: color } : undefined}
                  aria-hidden="true"
                />
                {label}
              </li>
            )
          })}
        </ul>

        {product?.description ? (
          <AnimatedDescription
            className="psv2-details__desc m-0 max-w-[295px] leading-[1.45] text-black [font-family:var(--font-body)] text-sm font-medium"
            replayKey={product.id}
            delay={0.12}
          >
            {product.description}
          </AnimatedDescription>
        ) : (
          <p className="psv2-details__desc m-0" />
        )}
      </div>

      <button
        type="button"
        className="psv2-details__buy m-[0.95rem] mt-[1.1rem] h-14 w-[calc(100%-1.9rem)] cursor-pointer border-0 bg-black uppercase tracking-[0.07em] text-white transition-[background,transform] duration-[250ms] [font-family:var(--font-title)] text-base font-semibold hover:bg-[#222] focus-visible:bg-[#222] active:scale-[0.985]"
        onClick={() => product && onBuy?.(product)}
        disabled={!product}
      >
        BUY NOW
      </button>
    </aside>
  )
}
