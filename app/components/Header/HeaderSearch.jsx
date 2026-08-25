import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Link, useLocation} from 'react-router';
import {
  SEARCH_ENDPOINT,
  SearchFormPredictive,
} from '~/components/SearchFormPredictive';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';
import {urlWithTrackingParams} from '~/lib/search';
import {moneySymbol} from '~/lib/storefrontCatalog';
import ProductCard from '~/components/Shop/ProductCard';
import {useSmoothScrollLock} from '~/components/SmoothScroll/SmoothScroll';
import '~/components/Shop/Shop.css';
import './HeaderSearch.css';

/** Match mobile-nav / cart overlay timing (~300ms). */
const OVERLAY_MS = 300;

/**
 * Header search: icon opens a centered full-viewport modal overlay.
 * Predictive results render below the input inside the overlay;
 * Enter / "See all" navigate to /search.
 *
 * Overlay is always portaled to document.body — the header uses CSS
 * transforms for headroom, which would otherwise trap position:fixed
 * and pin the dialog under the search icon with no visible backdrop.
 */
export function HeaderSearch({toggle, toggleClassName = '', onOpenChange}) {
  const inputRef = useRef(null);
  const overlayRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef(null);
  const titleId = useId();
  const location = useLocation();

  function clearCloseTimer() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openOverlay() {
    clearCloseTimer();
    setMounted(true);
    onOpenChange?.(true);
  }

  function closeOverlay() {
    clearCloseTimer();
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
      onOpenChange?.(false);
    }, OVERLAY_MS);
  }

  function closeOverlayImmediate() {
    clearCloseTimer();
    setVisible(false);
    setMounted(false);
    onOpenChange?.(false);
  }

  useSmoothScrollLock('header-search', mounted);

  // Enter animation: mount at opacity 0, force a paint, then add is-visible
  // so the CSS transition actually runs (skipping the first paint cancels it).
  useEffect(() => {
    if (!mounted) {
      setVisible(false);
      return undefined;
    }
    setVisible(false);
    const id = requestAnimationFrame(() => {
      if (overlayRef.current) void overlayRef.current.offsetWidth;
      setVisible(true);
    });
    return () => cancelAnimationFrame(id);
  }, [mounted]);

  useEffect(() => {
    if (!visible) return undefined;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  useEffect(() => {
    closeOverlayImmediate();
    // Close when the route changes (Enter / result click).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mounted) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closeOverlay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <div className={`header-search${mounted ? ' is-open' : ''}`}>
      <button
        type="button"
        className={toggleClassName}
        aria-label="Search"
        aria-expanded={mounted}
        aria-controls="header-search-panel"
        onClick={openOverlay}
      >
        {toggle}
      </button>

      {mounted && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={overlayRef}
              className={`header-search-overlay${visible ? ' is-visible' : ''}`}
              role="presentation"
            >
              {/* div (not button): avoids UA/Tailwind button background resets
                  that can leave the tint invisible while computed styles lie. */}
              <div
                className="header-search-overlay__backdrop"
                role="button"
                tabIndex={-1}
                aria-label="Close search"
                onClick={closeOverlay}
              />

              <div
                className="header-search-overlay__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <h2 id={titleId} className="sr-only">
                  Search
                </h2>

                <SearchFormPredictive className="header-search-overlay__form">
                  {({inputRef: formInputRef, fetchResults, goToSearch}) => (
                    <>
                      <div className="header-search-overlay__row">
                        <input
                          id="header-search-panel"
                          className="header-search-overlay__input"
                          name="q"
                          type="search"
                          placeholder="Search..."
                          autoComplete="off"
                          onChange={fetchResults}
                          onFocus={fetchResults}
                          ref={(node) => {
                            formInputRef.current = node;
                            inputRef.current = node;
                          }}
                        />
                        <span className="header-search-overlay__icon" aria-hidden="true">
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              cx="11"
                              cy="11"
                              r="6"
                              stroke="currentColor"
                              strokeWidth="1.25"
                            />
                            <path
                              d="M16 16L20 20"
                              stroke="currentColor"
                              strokeWidth="1.25"
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </div>

                      <SearchResultsPredictive>
                        {({items, total, term, state, closeSearch}) => (
                          <HeaderSearchPanel
                            items={items}
                            total={total}
                            term={term}
                            state={state}
                            onNavigate={() => {
                              closeSearch();
                              closeOverlayImmediate();
                            }}
                            onSeeAll={() => {
                              goToSearch();
                              closeOverlayImmediate();
                            }}
                          />
                        )}
                      </SearchResultsPredictive>
                    </>
                  )}
                </SearchFormPredictive>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * @param {{
 *   items: import('~/lib/search').PredictiveSearchReturn['result']['items'];
 *   total: number;
 *   term: React.MutableRefObject<string>;
 *   state: string;
 *   onNavigate: () => void;
 *   onSeeAll: () => void;
 * }}
 */
function HeaderSearchPanel({
  items,
  total,
  term,
  state,
  onNavigate,
  onSeeAll,
}) {
  const query = term.current?.trim() ?? '';
  if (!query && state === 'idle') return null;

  const {products, pages, articles, collections} = items;
  const loading = state === 'loading' && query;

  return (
    <div
      className="header-search-overlay__panel"
      role="listbox"
      aria-label="Search suggestions"
      data-lenis-prevent
      data-lenis-prevent-wheel
    >
      {loading ? (
        <p className="header-search-overlay__status">Loading…</p>
      ) : !total ? (
        <SearchResultsPredictive.Empty term={term} />
      ) : (
        <>
          {products.length ? (
            <section className="header-search-overlay__group">
              <h3 className="header-search-overlay__label">Products</h3>
              <ul className="header-search-overlay__products">
                {products.map((product) => (
                  <li key={product.id}>
                    <ProductCard
                      product={toPredictiveCard(product, query)}
                      showQuickAdd={false}
                      className="product-card--predictive"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {collections.length ? (
            <LinkGroup
              label="Collections"
              items={collections}
              hrefFor={(item) =>
                urlWithTrackingParams({
                  baseUrl: `/collections/${item.handle}`,
                  trackingParams: item.trackingParameters,
                  term: query,
                })
              }
              onNavigate={onNavigate}
            />
          ) : null}

          {pages.length ? (
            <LinkGroup
              label="Pages"
              items={pages}
              hrefFor={(item) =>
                urlWithTrackingParams({
                  baseUrl: `/pages/${item.handle}`,
                  trackingParams: item.trackingParameters,
                  term: query,
                })
              }
              onNavigate={onNavigate}
            />
          ) : null}

          {articles.length ? (
            <LinkGroup
              label="Articles"
              items={articles}
              hrefFor={(item) =>
                urlWithTrackingParams({
                  baseUrl: `/blogs/${item.blog?.handle}/${item.handle}`,
                  trackingParams: item.trackingParameters,
                  term: query,
                })
              }
              onNavigate={onNavigate}
            />
          ) : null}

          <Link
            className="header-search-overlay__all"
            to={`${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`}
            onClick={onSeeAll}
          >
            See all results for <q>{query}</q>
          </Link>
        </>
      )}
    </div>
  );
}

function LinkGroup({label, items, hrefFor, onNavigate}) {
  return (
    <section className="header-search-overlay__group">
      <h3 className="header-search-overlay__label">{label}</h3>
      <ul className="header-search-overlay__links">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className="header-search-overlay__link"
              to={hrefFor(item)}
              onClick={onNavigate}
            >
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function toPredictiveCard(product, term) {
  const variant = product.selectedOrFirstAvailableVariant;
  const price = variant?.price;
  const image = variant?.image;

  return {
    id: product.id,
    listId: product.id,
    name: product.title,
    image: image?.url,
    href: urlWithTrackingParams({
      baseUrl: `/products/${product.handle}`,
      trackingParams: product.trackingParameters,
      term,
    }),
    price: Number(price?.amount ?? 0),
    currency: moneySymbol(price?.currencyCode),
  };
}
