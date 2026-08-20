import marqueeMark from '../../assets/pdp/marquee-ft.svg'

/**
 * Infinite benefit pills. The FT divider mark is always the local SVG —
 * never from Shopify or the dreamer-only overlay.
 */
export default function PdpMarquee({ items }) {
  const loop = [...items, ...items, ...items]

  return (
    <section className="pdp-marquee" aria-label="Product benefits">
      <div className="pdp-marquee__track">
        {loop.map((label, index) => (
          <div key={`${label}-${index}`} className="pdp-marquee__item">
            <span className="pdp-marquee__label">{label}</span>
            <img
              src={marqueeMark}
              alt=""
              className="pdp-marquee__mark"
              width={40}
              height={40}
              draggable={false}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
