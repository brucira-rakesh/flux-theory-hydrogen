import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import gsap from 'gsap'
import SiteHeader from '../components/ProductShelf/SiteHeader'
import Footer from '../components/Footer/Footer'
import ProductCard from '../components/Shop/ProductCard'
import ProductFormPopup from '../components/Shop/ProductFormPopup'
import ShopFilterDrawer from '../components/Shop/ShopFilterDrawer'
import CustomSelect from '../components/Shop/CustomSelect'
import {
  SORT_OPTIONS,
  SHOP_PAGE_SIZE,
  FACE_FILTER_ENABLED,
  categoryFromParam,
  shopTitle,
  filterAndSortCatalog,
} from '../data/shop'
import { prefersReducedMotion } from '../hooks/useSpotlight'
import { useSmoothScrollLock } from '../components/SmoothScroll/SmoothScroll'
import { scrollToY } from '../components/SmoothScroll/smoothScrollApi'
import '../components/Shop/Shop.css'

export default function ShopPage({ catalog = [] }) {
  const { category: categoryParam } = useParams()
  const navigate = useNavigate()
  const routeValid =
    !categoryParam ||
    categoryParam === 'body' ||
    (FACE_FILTER_ENABLED && categoryParam === 'face')
  const routeCategory = categoryFromParam(categoryParam)

  const [filterOpen, setFilterOpen] = useState(false)
  const [sort, setSort] = useState('featured')
  const [category, setCategory] = useState(routeCategory)
  const [tags, setTags] = useState([])
  const [priceId, setPriceId] = useState('any')
  const [visibleCount, setVisibleCount] = useState(SHOP_PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeProduct, setActiveProduct] = useState(null)

  const gridRef = useRef(null)
  const sentinelRef = useRef(null)
  const revealedIdsRef = useRef(new Set())
  const loadTimerRef = useRef(0)

  useSmoothScrollLock('shop-product-popup', Boolean(activeProduct))

  // Sync drawer category with URL when route changes.
  useEffect(() => {
    setCategory(routeCategory)
    setVisibleCount(SHOP_PAGE_SIZE)
    revealedIdsRef.current = new Set()
    scrollToY(0)
  }, [routeCategory])

  const filtered = useMemo(
    () =>
      filterAndSortCatalog({
        items: catalog,
        category,
        tags,
        priceId,
        sort,
      }),
    [catalog, category, tags, priceId, sort],
  )

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  )
  const hasMore = visibleCount < filtered.length

  // Reset pagination when filters/sort change.
  useEffect(() => {
    setVisibleCount(SHOP_PAGE_SIZE)
    revealedIdsRef.current = new Set()
  }, [category, tags, priceId, sort])

  const animateNewCards = useCallback(() => {
    const root = gridRef.current
    if (!root) return
    const cards = [...root.querySelectorAll('[data-product-card]')]
    const fresh = cards.filter((el) => {
      const id = el.getAttribute('data-product-card')
      if (!id || revealedIdsRef.current.has(id)) return false
      revealedIdsRef.current.add(id)
      return true
    })
    if (!fresh.length) return

    if (prefersReducedMotion()) {
      gsap.set(fresh, { opacity: 1, y: 0 })
      return
    }

    gsap.fromTo(
      fresh,
      { opacity: 0, y: 32 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.06,
        ease: 'power3.out',
        overwrite: 'auto',
      },
    )
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => animateNewCards())
    return () => window.cancelAnimationFrame(frame)
  }, [visible, animateNewCards])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    window.clearTimeout(loadTimerRef.current)
    loadTimerRef.current = window.setTimeout(() => {
      setVisibleCount((n) => Math.min(n + SHOP_PAGE_SIZE, filtered.length))
      setLoadingMore(false)
    }, 420)
  }, [loadingMore, hasMore, filtered.length])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore()
      },
      { rootMargin: '280px 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, hasMore])

  useEffect(
    () => () => {
      window.clearTimeout(loadTimerRef.current)
    },
    [],
  )

  const onCategoryChange = (next) => {
    setCategory(next)
    if (next === 'all') navigate('/shop', { replace: true })
    else if (next === 'face' && !FACE_FILTER_ENABLED) navigate('/shop', { replace: true })
    else navigate(`/shop/${next}`, { replace: true })
  }

  const onClearFilters = () => {
    setTags([])
    setPriceId('any')
    setCategory(routeCategory)
    if (routeCategory === 'all') navigate('/shop', { replace: true })
    else navigate(`/shop/${routeCategory}`, { replace: true })
  }

  const badgeCount =
    tags.length +
    (priceId !== 'any' ? 1 : 0) +
    (category !== routeCategory ? 1 : 0)

  if (!routeValid) {
    return <Navigate to="/shop" replace />
  }

  return (
    <div className="shop-page">
      <SiteHeader logoTo="/" />

      <main className="shop-main">
        <header className="shop-hero">
          <nav className="shop-breadcrumb" aria-label="Breadcrumb">
            <span className="shop-breadcrumb__item">
              <Link to="/" className="shop-breadcrumb__link">
                Home
              </Link>
            </span>
            {routeCategory === 'all' ? (
              <span className="shop-breadcrumb__item">
                <span className="shop-breadcrumb__sep" aria-hidden="true">
                  /
                </span>
                <span className="shop-breadcrumb__current">Shop All</span>
              </span>
            ) : (
              <>
                <span className="shop-breadcrumb__item">
                  <span className="shop-breadcrumb__sep" aria-hidden="true">
                    /
                  </span>
                  <Link to="/shop" className="shop-breadcrumb__link">
                    Shop All
                  </Link>
                </span>
                <span className="shop-breadcrumb__item">
                  <span className="shop-breadcrumb__sep" aria-hidden="true">
                    /
                  </span>
                  <span className="shop-breadcrumb__current">
                    {shopTitle(routeCategory)}
                  </span>
                </span>
              </>
            )}
          </nav>
          <h1 className="shop-hero__title">{shopTitle(routeCategory)}</h1>
          <p className="shop-hero__copy">
            Every formula is a state of mind. Find the wash that matches yours.
          </p>
        </header>

        <div className="shop-toolbar">
          <p className="shop-toolbar__count" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
          </p>

          <div className="shop-toolbar__actions">
            <CustomSelect
              className="custom-select--toolbar"
              label="Sort by"
              ariaLabel="Sort products"
              align="right"
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
            />

            <button
              type="button"
              className="shop-toolbar__filter"
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(true)}
            >
              <span className="shop-toolbar__filter-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 4H14M4 8H12M6 12H10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              Filters
              {badgeCount > 0 && (
                <span className="shop-toolbar__badge">{badgeCount}</span>
              )}
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="shop-empty">
            <p>No products match these filters.</p>
            <button type="button" className="shop-empty__clear" onClick={onClearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <ul ref={gridRef} className="shop-grid">
            {visible.map((product) => (
              <li key={product.listId} className="shop-grid__item">
                <ProductCard
                  product={product}
                  quickAddOpen={activeProduct?.listId === product.listId}
                  onQuickAdd={setActiveProduct}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="shop-infinite" aria-hidden={!hasMore && !loadingMore}>
          <div ref={sentinelRef} className="shop-infinite__sentinel" />
          {loadingMore && (
            <p className="shop-infinite__status" aria-live="polite">
              Loading more
              <span className="shop-infinite__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
          {!hasMore && visible.length > 0 && (
            <p className="shop-infinite__end">You’ve reached the end</p>
          )}
        </div>
      </main>

      <Footer />

      <ShopFilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        category={category}
        onCategoryChange={onCategoryChange}
        tags={tags}
        onTagsChange={setTags}
        priceId={priceId}
        onPriceChange={setPriceId}
        onClear={onClearFilters}
        resultCount={filtered.length}
      />

      {activeProduct && (
        <ProductFormPopup
          product={activeProduct}
          onClose={() => setActiveProduct(null)}
        />
      )}
    </div>
  )
}
