import { useCallback, useEffect, useRef, useState } from 'react'
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

/** Brief "Link copied!" toast anchored near the Instagram icon. */
function CopyToast({ visible }) {
  return (
    <span
      className={`pdp-details__copy-toast${visible ? ' is-visible' : ''}`}
      aria-live="polite"
      aria-atomic="true"
    >
      Link copied!
    </span>
  )
}

export default function PdpAccordion({ items, bottleSrc, bottleAlt, productName = '' }) {
  const [openId, setOpenId] = useState(
    () => items.find((item) => item.defaultOpen)?.id ?? null,
  )
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef(null)

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const onToggle = (id) => {
    setOpenId((current) => (current === id ? null : id))
  }

  const shareUrl = useCallback(() => {
    if (typeof window !== 'undefined') return window.location.href
    return ''
  }, [])

  const openPopup = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=480')
  }

  const handleFacebook = (e) => {
    e.preventDefault()
    openPopup(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl())}`)
  }

  const handleX = (e) => {
    e.preventDefault()
    const text = productName ? `Check out ${productName}` : ''
    openPopup(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl())}${text ? `&text=${encodeURIComponent(text)}` : ''}`
    )
  }

  const handleInstagram = (e) => {
    e.preventDefault()
    if (typeof navigator === 'undefined') return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl()).then(() => {
        setToastVisible(true)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastVisible(false), 2200)
      }).catch(() => {
        // Clipboard write failed (permissions denied etc.) — fail silently
      })
    }
    // navigator.clipboard unavailable: no-op, no error thrown
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
            <a
              href="https://facebook.com"
              aria-label="Share on Facebook"
              className="pdp-details__social"
              onClick={handleFacebook}
              rel="noopener noreferrer"
            >
              <img src={iconFacebook} alt="" width={16} height={16} />
            </a>
            <span className="pdp-details__social-wrap">
              <a
                href="#"
                aria-label="Copy link to share on Instagram"
                className="pdp-details__social"
                onClick={handleInstagram}
              >
                <img src={iconInstagram} alt="" width={16} height={16} />
              </a>
              <CopyToast visible={toastVisible} />
            </span>
            <a
              href="https://x.com"
              aria-label="Share on X"
              className="pdp-details__social"
              onClick={handleX}
              rel="noopener noreferrer"
            >
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
