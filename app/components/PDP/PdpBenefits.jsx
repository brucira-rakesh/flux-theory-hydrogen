export default function PdpBenefits({ benefits }) {
  return (
    <section className="pdp-benefits" aria-labelledby="pdp-benefits-title">
      <h2 id="pdp-benefits-title" className="pdp-benefits__title">
        {benefits.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h2>

      <ul className="pdp-benefits__grid">
        {benefits.cards.map((card) => (
          <li key={card.id} className="pdp-benefits__card">
            <img src={card.image} alt="" draggable={false} />
            <div className="pdp-benefits__overlay">
              <p className="pdp-benefits__index">{card.id}</p>
              <h3 className="pdp-benefits__name">{card.title}</h3>
              <p className="pdp-benefits__body">{card.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
