import { useState } from 'react'
import iconFacebook from '../../assets/pdp/icon-facebook.svg'
import iconInstagram from '../../assets/pdp/icon-instagram.svg'
import iconTwitter from '../../assets/pdp/icon-twitter.svg'

function AccordionItem({ item, open, onToggle }) {
  const panelId = `pdp-acc-${item.id}`
  const hasBody = Boolean(item.intro || item.body || item.bullets?.length)

  return (
    <div className={`pdp-acc__item${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pdp-acc__trigger"
        aria-expanded={open}
        aria-controls={hasBody ? panelId : undefined}
        onClick={() => onToggle(item.id)}
      >
        <span>{item.title}</span>
        <span className="pdp-acc__icon" aria-hidden="true">
          <span className="pdp-acc__icon-h" />
          <span className="pdp-acc__icon-v" />
        </span>
      </button>

      {hasBody && (
        <div
          id={panelId}
          className="pdp-acc__panel"
          role="region"
          aria-label={item.title}
          aria-hidden={!open}
          inert={!open ? true : undefined}
        >
          <div className="pdp-acc__panel-inner">
            {item.intro && <p className="pdp-acc__intro">{item.intro}</p>}
            {item.body && <p className="pdp-acc__body">{item.body}</p>}
            {item.bullets?.length > 0 && (
              <ul className="pdp-acc__list">
                {item.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PdpAccordion({ items, bottleSrc, bottleAlt }) {
  const [openId, setOpenId] = useState(
    () => items.find((item) => item.defaultOpen)?.id ?? null,
  )

  const onToggle = (id) => {
    setOpenId((current) => (current === id ? null : id))
  }

  return (
    <section className="pdp-details" aria-label="Product details">
      <div className="pdp-details__accordion">
        {items.map((item) => (
          <AccordionItem
            key={item.id}
            item={item}
            open={openId === item.id}
            onToggle={onToggle}
          />
        ))}

        <div className="pdp-details__footer">
          <div className="pdp-details__share">
            <span>Share:</span>
            <a href="#" aria-label="Share on Facebook" className="pdp-details__social">
              <img src={iconFacebook} alt="" width={16} height={16} />
            </a>
            <a href="#" aria-label="Share on Instagram" className="pdp-details__social">
              <img src={iconInstagram} alt="" width={16} height={16} />
            </a>
            <a href="#" aria-label="Share on X" className="pdp-details__social">
              <img src={iconTwitter} alt="" width={14} height={14} />
            </a>
          </div>
          <a href="#contact" className="pdp-details__help">
            Need Help?
          </a>
        </div>
      </div>

      {bottleSrc ? (
        <figure className="pdp-details__media">
          <img src={bottleSrc} alt={bottleAlt} draggable={false} />
        </figure>
      ) : null}
    </section>
  )
}
