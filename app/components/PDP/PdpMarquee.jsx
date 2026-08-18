export default function PdpMarquee({ items, mark }) {
  const loop = [...items, ...items, ...items]

  return (
    <section className="pdp-marquee" aria-label="Product benefits">
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
