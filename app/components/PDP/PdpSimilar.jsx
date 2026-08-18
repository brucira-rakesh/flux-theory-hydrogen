import { useState } from 'react'
import ProductCard from '../Shop/ProductCard'
import ProductFormPopup from '../Shop/ProductFormPopup'
import { useSmoothScrollLock } from '../SmoothScroll/SmoothScroll'
import '../Shop/Shop.css'

export default function PdpSimilar({ products, onAdd }) {
  const [activeId, setActiveId] = useState(null)
  const activeProduct = products.find((p) => p.id === activeId) ?? null

  useSmoothScrollLock('pdp-similar-popup', Boolean(activeProduct))

  return (
    <section className="pdp-similar" aria-labelledby="pdp-similar-title">
      <h2 id="pdp-similar-title" className="pdp-similar__title">
        Similar Products
      </h2>

      <ul className="pdp-similar__rail">
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
