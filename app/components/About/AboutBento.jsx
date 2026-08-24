import {Link} from 'react-router';
import {Drop, Flask, ShieldCheck, UserFocus} from '@phosphor-icons/react';
import {ABOUT_BENTO} from '~/data/about';
import bentoImage from '~/assets/pdp/gallery-lifestyle.png';

const ICONS = {
  flask: Flask,
  user: UserFocus,
  drop: Drop,
  shield: ShieldCheck,
};

function BentoIcon({name}) {
  const Icon = ICONS[name] ?? Flask;
  return <Icon className="about-bento__icon" weight="thin" aria-hidden size={28} />;
}

export default function AboutBento() {
  const {title, image, freeFrom, clinical, beliefs, formulas} = ABOUT_BENTO;

  return (
    <section className="about-section about-bento" aria-labelledby="about-bento-title">
      <div className="about-inner">
        <header className="about-bento__head">
          <h2 id="about-bento-title" className="about-display about-h-section about-bento__title">
            {title.split('\n').map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))}
          </h2>
        </header>

        <div className="about-bento__grid">
          {/* A — tall lifestyle image */}
          <figure className="about-bento__tile about-bento__tile--image">
            <img
              src={bentoImage}
              alt={image.alt}
              className="about-bento__image"
              draggable={false}
            />
            <figcaption className="about-bento__caption">{image.caption}</figcaption>
          </figure>

          {/* B — free-froms stat */}
          <article className="about-bento__tile about-bento__tile--stat about-bento__tile--free">
            <p className="about-bento__value">{freeFrom.value}</p>
            <p className="about-bento__label">{freeFrom.label}</p>
          </article>

          {/* C — clinical card */}
          <article className="about-bento__tile about-bento__tile--clinical">
            <BentoIcon name={clinical.icon} />
            <h3 className="about-bento__card-title">{clinical.title}</h3>
            <p className="about-bento__card-body">{clinical.body}</p>
            {clinical.cta.href.startsWith('#') ? (
              <a href={clinical.cta.href} className="about-bento__cta">
                {clinical.cta.label}
              </a>
            ) : (
              <Link to={clinical.cta.href} className="about-bento__cta">
                {clinical.cta.label}
              </Link>
            )}
          </article>

          {/* E — formulas stat */}
          <article className="about-bento__tile about-bento__tile--stat about-bento__tile--formulas">
            <p className="about-bento__value">{formulas.value}</p>
            <p className="about-bento__label">{formulas.label}</p>
          </article>

          {/* D — beliefs strip */}
          <article className="about-bento__tile about-bento__tile--beliefs">
            <h3 className="about-bento__beliefs-heading">{beliefs.heading}</h3>
            <ul className="about-bento__beliefs">
              {beliefs.items.map((item) => (
                <li key={item.title} className="about-bento__belief">
                  <BentoIcon name={item.icon} />
                  <div>
                    <p className="about-bento__belief-title">{item.title}</p>
                    <p className="about-bento__belief-body">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
