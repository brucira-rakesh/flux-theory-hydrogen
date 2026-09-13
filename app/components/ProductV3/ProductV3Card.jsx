import iconAdd from "../../assets/icons/icon-add.svg";

function formatPrice(value) {
  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * ProductV3Card — Figma node 2810-2496's per-product tile.
 *
 * `product` is the same toListingCard() view-model shape the PLP grid
 * (app/components/Shop/ProductCard.jsx) consumes — `name`/`price`/`currency`/
 * `image`/`variantGid`/`sizes`/`variantBySize`, plus `shortDescription` (the
 * PDP's custom.short_description metafield, added by fetchHomeProductCards).
 *
 * The "+" button doesn't add to cart itself — same as the PLP card, it calls
 * `onQuickAdd(product)` to open ProductV3's ProductFormPopup (the exact same
 * size/quantity/ATC modal the PLP grid and similar-products rail use), since
 * these products have real size variants that need picking before Add to
 * Cart, not just a single default variant.
 *
 * `ref` is forwarded straight through (React 19 lets function components
 * accept it as a plain prop) so ProductV3 can collect the card DOM nodes for
 * its stack→spread GSAP reveal without needing forwardRef boilerplate.
 */
export default function ProductV3Card({
  product,
  ref,
  className = "",
  onQuickAdd,
  quickAddOpen = false,
}) {
  return (
    <article
      ref={ref}
      className={`relative flex w-full flex-col overflow-hidden will-change-transform ${className}`}
    >
      <div
        className="absolute inset-0 border border-white/[0.16] bg-white/[0.16] backdrop-blur-[12.85px] sm:border-0 sm:bg-[rgba(140,174,191,0.5)] sm:backdrop-blur-[57.5px]"
        aria-hidden="true"
      />

      <div className="relative flex items-center justify-center overflow-hidden py-6 drop-shadow-[0_16px_24px_rgba(0,0,0,0.45)] sm:aspect-[4/5] sm:py-0">
        <img
          src={product.image}
          alt={product.name}
          draggable={false}
          className="relative z-10 h-[142px] w-auto object-contain sm:h-[82%]"
        />
      </div>

      <div className="relative flex flex-1 flex-col gap-2 p-3 sm:gap-3 sm:p-5">
        <div>
          <h3 className="[font-family:var(--font-body)] text-base font-bold uppercase tracking-[1.12px] text-white sm:text-lg sm:font-semibold sm:normal-case sm:tracking-[-0.02em]">
            {product.name}
          </h3>
          <p className="mt-1 line-clamp-2 [font-family:var(--font-body)] text-xs leading-[1.2] tracking-[0.12px] text-white/70 sm:text-[11px] sm:leading-snug sm:tracking-normal sm:text-white/60">
            {product.shortDescription}
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between">
          <span className="[font-family:var(--font-body)] text-[13px] font-semibold uppercase text-white sm:font-medium sm:normal-case sm:tracking-[-0.02em]">
            {product.currency}
            {formatPrice(product.price)}
          </span>
          <button
            type="button"
            aria-label={`Quick add ${product.name}`}
            aria-haspopup="dialog"
            aria-expanded={quickAddOpen}
            onClick={() => onQuickAdd?.(product)}
            className="flex cursor-pointer h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-white backdrop-blur-[2.6px] transition-transform duration-200 hover:scale-105 sm:h-[30px] sm:w-[30px]"
          >
            <img
              src={iconAdd}
              alt=""
              aria-hidden="true"
              className="h-[14px] w-[14px] sm:h-[16px] sm:w-[16px]"
            />
          </button>
        </div>
      </div>
    </article>
  );
}
