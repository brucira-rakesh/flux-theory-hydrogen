export default function PdpDescription({ title, description }) {
  return (
    <section className="pdp-description" aria-labelledby="pdp-desc-heading">
      <p id="pdp-desc-heading" className="pdp-description__label">
        {title}
      </p>
      <p className="pdp-description__text">{description}</p>
    </section>
  )
}
