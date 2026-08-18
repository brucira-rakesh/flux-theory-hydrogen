export default function PdpStats({ stats }) {
  return (
    <section className="pdp-stats" aria-labelledby="pdp-stats-title">
      <p className="pdp-stats__eyebrow">{stats.eyebrow}</p>
      <h2 id="pdp-stats-title" className="pdp-stats__title">
        {stats.title}
      </h2>

      <ul className="pdp-stats__grid">
        {stats.cards.map((card) => (
          <li key={card.value} className="pdp-stats__card">
            <p className="pdp-stats__value">{card.value}</p>
            <p className="pdp-stats__text">{card.text}</p>
          </li>
        ))}
      </ul>

      <p className="pdp-stats__footnote">{stats.footnote}</p>
    </section>
  )
}
