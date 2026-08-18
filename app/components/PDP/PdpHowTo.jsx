import PdpAutoplayVideo from './PdpAutoplayVideo'

function HowToMedia({ howTo }) {
  if (howTo.video?.length) {
    return (
      <PdpAutoplayVideo
        sources={howTo.video}
        poster={howTo.image}
        className="pdp-howto__video"
      />
    )
  }
  return <img src={howTo.image} alt={howTo.imageAlt} draggable={false} />
}

export default function PdpHowTo({ howTo }) {
  return (
    <section className="pdp-howto" aria-labelledby="pdp-howto-title">
      <figure className="pdp-howto__media">
        <HowToMedia howTo={howTo} />
      </figure>

      <div className="pdp-howto__content">
        <header className="pdp-howto__header">
          <p className="pdp-howto__eyebrow">{howTo.eyebrow}</p>
          <h2 id="pdp-howto-title" className="pdp-howto__title">
            {howTo.title}
          </h2>
        </header>

        <ol className="pdp-howto__steps">
          {howTo.steps.map((step) => (
            <li key={step.title} className="pdp-howto__step">
              <span className="pdp-howto__icon" aria-hidden="true" />
              <div className="pdp-howto__step-copy">
                <p className="pdp-howto__step-title">{step.title}</p>
                <p className="pdp-howto__step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
