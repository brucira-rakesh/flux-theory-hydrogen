import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SiteHeader from '~/components/ProductShelf/SiteHeader'
import FooterV3 from '~/components/Footer/FooterV3'
import PdpHero from '~/components/PDP/PdpHero'
import PdpDescription from '~/components/PDP/PdpDescription'
import PdpAccordion from '~/components/PDP/PdpAccordion'
import PdpMarquee from '~/components/PDP/PdpMarquee'
import PdpLifestyle from '~/components/PDP/PdpLifestyle'

import PdpHowTo from '~/components/PDP/PdpHowTo'
import PdpSimilar from '~/components/PDP/PdpSimilar'
import PdpStickyBar from '~/components/PDP/PdpStickyBar'
import { getPdpBySlug, getSimilarProducts } from '~/data/pdp'
import { HOME_URL } from '~/data/site'
import { usePdpMotion } from '~/hooks/usePdpMotion'
import { scrollToY } from '~/components/SmoothScroll/smoothScrollApi'
import '~/components/PDP/ProductPage.css'

export default function ProductPage({
  product: productProp,
  similar: similarProp,
  onSizeChange: onSizeChangeProp,
} = {}) {
  const params = useParams()
  const slug = params.slug ?? params.handle
  const product = productProp ?? getPdpBySlug(slug)
  const [size, setSize] = useState(product?.defaultSize)
  const [quantity, setQuantity] = useState(1)
  const [stickyVisible, setStickyVisible] = useState(false)
  const [heroFormOutOfView, setHeroFormOutOfView] = useState(false)
  const [lifestyleInView, setLifestyleInView] = useState(false)
  const [howToApproaching, setHowToApproaching] = useState(false)
  const formRef = useRef(null)
  const lifestyleRef = useRef(null)
  const howToRef = useRef(null)
  const heroControlsRef = useRef(null)
  const pageRef = useRef(null)
  const footerSentinelRef = useRef(null)

  // Measure the floating header's bottom edge and expose it as --pdp-header-h
  // so the mobile first-fold min-height calc stays accurate if the header changes.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    const updateHeaderH = () => {
      const header = document.querySelector('.ps-header')
      if (!header) return
      const rect = header.getBoundingClientRect()
      // bottom edge of the header pill relative to the viewport top
      const bottom = Math.round(rect.top + rect.height)
      page.style.setProperty('--pdp-header-h', `${bottom}px`)
    }

    updateHeaderH()

    const header = document.querySelector('.ps-header')
    if (!header || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateHeaderH)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  usePdpMotion(pageRef, { enabled: Boolean(product), replayKey: product?.slug })

  useEffect(() => {
    if (!product) return
    setSize(product.defaultSize)
    setQuantity(1)
    setStickyVisible(false)
    setHeroFormOutOfView(false)
    setLifestyleInView(false)
    setHowToApproaching(false)
    scrollToY(0)
  }, [product?.slug])

  useEffect(() => {
    if (product?.defaultSize) setSize(product.defaultSize)
  }, [product?.defaultSize, product?.variantGid])

  const onSizeChange = (value) => {
    setSize(value)
    onSizeChangeProp?.(value)
  }

  useEffect(() => {
    // Reveal once How to Use is approaching — even if lifestyle is still
    // partially on screen — so the bar isn't stuck waiting for a full exit.
    setStickyVisible(heroFormOutOfView && (!lifestyleInView || howToApproaching))
  }, [heroFormOutOfView, lifestyleInView, howToApproaching])

  useEffect(() => {
    const form = formRef.current
    if (!form || typeof IntersectionObserver === 'undefined') return

    const lifestyle = lifestyleRef.current
    const howTo = howToRef.current
    let formOut = false
    let lifestyleVisible = false
    let howToNear = false

    const recompute = () => {
      setHeroFormOutOfView(formOut)
      setLifestyleInView(lifestyleVisible)
      setHowToApproaching(howToNear)
      setStickyVisible(formOut && (!lifestyleVisible || howToNear))
    }

    // Seed initial state before IO callbacks run.
    formOut = form.getBoundingClientRect().bottom <= 0
    if (lifestyle) {
      const rect = lifestyle.getBoundingClientRect()
      lifestyleVisible = rect.bottom > 0 && rect.top < window.innerHeight
    }
    if (howTo) {
      const rect = howTo.getBoundingClientRect()
      // Match the howTo observer's small bottom rootMargin (~56px early).
      const early = 56
      howToNear = rect.top < window.innerHeight + early && rect.bottom > 0
    }
    recompute()

    // Form + lifestyle: exact viewport edges — hide while lifestyle is truly on screen.
    const gateObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === form) formOut = !entry.isIntersecting
          if (lifestyle && entry.target === lifestyle) {
            lifestyleVisible = entry.isIntersecting
          }
        }
        recompute()
      },
      { threshold: 0, rootMargin: '0px' },
    )

    gateObserver.observe(form)
    if (lifestyle) gateObserver.observe(lifestyle)

    // How to Use: reveal as it reaches the viewport (small bottom rootMargin =
    // slight lead). Observing how-to is more precise than shrinking lifestyle's
    // exit margin — a full-bleed 100dvh lifestyle can't "exit early" via
    // rootMargin without still covering the screen.
    let howToObserver
    if (howTo) {
      howToObserver = new IntersectionObserver(
        ([entry]) => {
          howToNear = entry.isIntersecting
          recompute()
        },
        { threshold: 0, rootMargin: '0px 0px 56px 0px' },
      )
      howToObserver.observe(howTo)
    }

    return () => {
      gateObserver.disconnect()
      howToObserver?.disconnect()
    }
  }, [product?.slug, Boolean(product?.lifestyle), Boolean(product?.howTo)])

  if (!product) {
    if (typeof window !== 'undefined') {
      window.location.replace(HOME_URL)
    }
    return null
  }

  const similar = similarProp ?? getSimilarProducts(product.id)

  return (
    <div ref={pageRef} className="pdp-page">
      <SiteHeader />
      <main className="pdp-main">
        <div data-pdp-reveal data-pdp-reveal-y="18">
          <PdpHero
            product={product}
            size={size}
            quantity={quantity}
            onSizeChange={onSizeChange}
            onQuantityChange={setQuantity}
            formRef={formRef}
            heroControlsRef={heroControlsRef}
          />
        </div>
        <div data-pdp-reveal>
          <PdpDescription
            title={product.descriptionTitle}
            description={product.description}
          />
        </div>
        {product.accordion ? (
          <div data-pdp-reveal>
            <PdpAccordion
              items={product.accordion}
              bottleSrc={product.detailBottle}
              bottleAlt={`${product.name} bottle`}
              productName={product.name}
            />
          </div>
        ) : null}
      </main>

      {product.marquee ? (
        <div data-pdp-reveal data-pdp-reveal-y="0">
          <PdpMarquee items={product.marquee.items} />
        </div>
      ) : null}
      {product.lifestyle ? (
        <PdpLifestyle lifestyle={product.lifestyle} sectionRef={lifestyleRef} />
      ) : null}

      <div className="pdp-main pdp-main--lower">
        {product.howTo ? (
          <div ref={howToRef} data-pdp-reveal>
            <PdpHowTo howTo={product.howTo} />
          </div>
        ) : null}
        {/* Slide-in on the similar rail owns entrance — no parent reveal. */}
        <div className="pdp-main pdp-main--lower">
          <PdpSimilar products={similar} />
        </div>
      </div>

      <PdpStickyBar
        product={product}
        size={size}
        quantity={quantity}
        onSizeChange={onSizeChange}
        onQuantityChange={setQuantity}
        visible={stickyVisible}
        heroControlsRef={heroControlsRef}
        footerSentinelRef={footerSentinelRef}
      />

      <div
        ref={footerSentinelRef}
        className="pdp-footer-sentinel"
        aria-hidden="true"
      />
      <FooterV3 />
      <p className="visually-hidden">
        <a href={HOME_URL} className="visually-hidden">
          Back to home
        </a>
      </p>
    </div>
  )
}
