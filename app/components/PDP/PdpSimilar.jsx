import {useLayoutEffect, useRef, useState} from 'react'
import ProductCard from '../Shop/ProductCard'
import ProductFormPopup from '../Shop/ProductFormPopup'
import {useSmoothScrollLock} from '../SmoothScroll/SmoothScroll'
import '../Shop/Shop.css'

/**
 * Similar products rail. Uses fixed Figma card width + horizontal scroll when
 * the set overflows; when N fixed cards + gaps fit the section, cards flex-grow
 * evenly to fill the row (no scroll / peek / trailing gap).
 */
export default function PdpSimilar({products, onAdd}) {
  const [activeId, setActiveId] = useState(null)
  const [fillsRow, setFillsRow] = useState(false)
  const sectionRef = useRef(null)
  const railRef = useRef(null)
  const measureRef = useRef(null)
  const activeProduct = products.find((p) => p.id === activeId) ?? null

  useSmoothScrollLock('pdp-similar-popup', Boolean(activeProduct))

  useLayoutEffect(() => {
    const section = sectionRef.current
    const rail = railRef.current
    const measure = measureRef.current
    if (!section || !rail || !measure || products.length === 0) {
      setFillsRow(false)
      return
    }

    const update = () => {
      const cardW = measure.offsetWidth
      const gap =
        parseFloat(getComputedStyle(rail).columnGap || getComputedStyle(rail).gap) ||
        0
      const n = products.length
      const needed = n * cardW + Math.max(0, n - 1) * gap
      const available = section.clientWidth
      // Subpixel slack — avoid flicker when widths are effectively equal.
      setFillsRow(needed <= available + 0.5)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(section)
    return () => ro.disconnect()
  }, [products.length])

  return (
    <section
      ref={sectionRef}
      className="pdp-similar"
      aria-labelledby="pdp-similar-title"
    >
      {/* Resolves --pdp-similar-card-w to px for overflow math (layout-independent). */}
      <span
        ref={measureRef}
        className="pdp-similar__card-measure"
        aria-hidden="true"
      />
      <h2 id="pdp-similar-title" className="pdp-similar__title">
        Similar Products
      </h2>

      <ul
        ref={railRef}
        className={`pdp-similar__rail${fillsRow ? ' is-fill' : ''}`}
      >
        {products.map((product) => (
          <li key={product.id} className="pdp-similar__item">
            <ProductCard
              product={product}
              className="pdp-similar__card-host"
              quickAddOpen={activeId === product.id}
              onQuickAdd={(item) => setActiveId(item.id)}
            />
          </li>
        ))}
      </ul>

      {activeProduct && (
        <ProductFormPopup
          product={activeProduct}
          onClose={() => setActiveId(null)}
          onAdd={onAdd}
        />
      )}
    </section>
  )
}
