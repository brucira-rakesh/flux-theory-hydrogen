import marqueeMarkDark from '../../assets/pdp/marquee-ft.svg'
import marqueeMarkLight from '../../assets/pdp/marquee-ft-light.svg'

/**
 * Infinite benefit pills. The FT divider mark is always a local SVG —
 * never from Shopify or the dreamer-only overlay.
 *
 * @param {{ items: string[], variant?: 'dark' | 'light' }} props
 *   `light` = Flux Figma 3101:2760 (white bar, black Oswald copy).
 *   `dark`  = legacy black bar (old PDP / about).
 */
export default function PdpMarquee({items, variant = 'dark'}) {
  const loop = [...items, ...items, ...items]
  const mark = variant === 'light' ? marqueeMarkLight : marqueeMarkDark
  const className =
    variant === 'light' ? 'pdp-marquee pdp-marquee--light' : 'pdp-marquee'

  return (
    <section className={className} aria-label="Product benefits">
      <div className="pdp-marquee__track">
        {loop.map((label, index) => (
          <div key={`${label}-${index}`} className="pdp-marquee__item">
            <span className="pdp-marquee__label">{label}</span>
            <img
              src={mark}
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
