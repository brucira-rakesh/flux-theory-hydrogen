import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import SiteHeader from '~/components/ProductShelf/SiteHeader'
import Footer from '~/components/Footer/Footer'
import PdpHero from '~/components/PDP/PdpHero'
import PdpDescription from '~/components/PDP/PdpDescription'
import PdpAccordion from '~/components/PDP/PdpAccordion'
import PdpMarquee from '~/components/PDP/PdpMarquee'
import PdpLifestyle from '~/components/PDP/PdpLifestyle'
import PdpStats from '~/components/PDP/PdpStats'
import PdpHowTo from '~/components/PDP/PdpHowTo'
import PdpBenefits from '~/components/PDP/PdpBenefits'
import PdpSimilar from '~/components/PDP/PdpSimilar'
import PdpStickyBar from '~/components/PDP/PdpStickyBar'
import { getPdpBySlug, getSimilarProducts } from '~/data/pdp'
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
  const formRef = useRef(null)
  const heroControlsRef = useRef(null)
  const pageRef = useRef(null)

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
    const form = formRef.current
    if (!form || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setStickyVisible(!entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '0px' },
    )

    observer.observe(form)
    return () => observer.disconnect()
  }, [product])

  if (!product) {
    return <Navigate to="/" replace />
  }

  const similar = similarProp ?? getSimilarProducts(product.id)

  return (
    <div ref={pageRef} className="pdp-page">
      <SiteHeader logoTo="/" />
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
          <PdpMarquee items={product.marquee.items} mark={product.marquee.mark} />
        </div>
      ) : null}
      {product.lifestyle ? <PdpLifestyle lifestyle={product.lifestyle} /> : null}
      {product.stats ? (
        <div data-pdp-reveal>
          <PdpStats stats={product.stats} />
        </div>
      ) : null}

      <div className="pdp-main pdp-main--lower">
        {product.howTo ? (
          <div data-pdp-reveal>
            <PdpHowTo howTo={product.howTo} />
          </div>
        ) : null}
        {product.benefits ? (
          <div data-pdp-reveal>
            <PdpBenefits benefits={product.benefits} />
          </div>
        ) : null}
        <div data-pdp-reveal>
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
      />

      <Footer />
      <p className="visually-hidden">
        <Link to="/">Back to home</Link>
      </p>
    </div>
  )
}
