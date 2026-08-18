import {useEffect, useId, useRef, useState} from 'react';
import {Link, useLocation} from 'react-router';
import {
  SEARCH_ENDPOINT,
  SearchFormPredictive,
} from '~/components/SearchFormPredictive';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';
import {urlWithTrackingParams} from '~/lib/search';
import {moneySymbol} from '~/lib/storefrontCatalog';
import ProductCard from '~/components/Shop/ProductCard';
import '~/components/Shop/Shop.css';
import './HeaderSearch.css';

/**
 * Inline header search: icon expands into an input in the header cluster.
 * Predictive results drop below the input; Enter / "See all" go to /search.
 */
export function HeaderSearch({toggle, toggleClassName = '', onOpenChange}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const queriesDatalistId = useId();
  const location = useLocation();

  function setOpened(next) {
    setOpen(next);
    onOpenChange?.(next);
  }

  useEffect(() => {
    if (!open) return undefined;
    const input = rootRef.current?.querySelector('#header-search-panel');
    input?.focus();
    return undefined;
  }, [open]);

  useEffect(() => {
    setOpen(false);
    onOpenChange?.(false);
    // Close when the route changes (Enter / result click).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpened(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpened(false);
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`header-search${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className={toggleClassName}
        aria-label="Search"
        aria-expanded={open}
        aria-controls="header-search-panel"
        hidden={open}
        onClick={() => setOpened(true)}
      >
        {toggle}
      </button>

      <SearchFormPredictive className="header-search__form">
        {({inputRef, fetchResults, goToSearch}) => (
          <>
            <input
              id="header-search-panel"
              className="header-search__input"
              name="q"
              type="search"
              placeholder="Search"
              autoComplete="off"
              list={queriesDatalistId}
              onChange={fetchResults}
              onFocus={fetchResults}
              ref={inputRef}
              tabIndex={open ? 0 : -1}
            />

            {open ? (
              <SearchResultsPredictive>
                {({items, total, term, state, closeSearch}) => (
                  <HeaderSearchPanel
                    items={items}
                    total={total}
                    term={term}
                    state={state}
                    queriesDatalistId={queriesDatalistId}
                    onNavigate={() => {
                      closeSearch();
                      setOpened(false);
                    }}
                    onSeeAll={() => {
                      goToSearch();
                      setOpened(false);
                    }}
                  />
                )}
              </SearchResultsPredictive>
            ) : null}
          </>
        )}
      </SearchFormPredictive>
    </div>
  );
}

/**
 * @param {{
 *   items: import('~/lib/search').PredictiveSearchReturn['result']['items'];
 *   total: number;
 *   term: React.MutableRefObject<string>;
 *   state: string;
 *   queriesDatalistId: string;
 *   onNavigate: () => void;
 *   onSeeAll: () => void;
 * }}
 */
function HeaderSearchPanel({
  items,
  total,
  term,
  state,
  queriesDatalistId,
  onNavigate,
  onSeeAll,
}) {
  const query = term.current?.trim() ?? '';
  if (!query && state === 'idle') return null;

  const {products, pages, articles, collections, queries} = items;
  const loading = state === 'loading' && query;

  return (
    <div className="header-search__panel" role="listbox" aria-label="Search suggestions">
      <SearchResultsPredictive.Queries
        queries={queries}
        queriesDatalistId={queriesDatalistId}
      />

      {loading ? (
        <p className="header-search__status">Loading…</p>
      ) : !total ? (
        <SearchResultsPredictive.Empty term={term} />
      ) : (
        <>
          {products.length ? (
            <section className="header-search__group">
              <h3 className="header-search__label">Products</h3>
              <ul className="header-search__products">
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
            className="header-search__all"
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
    <section className="header-search__group">
      <h3 className="header-search__label">{label}</h3>
      <ul className="header-search__links">
        {items.map((item) => (
          <li key={item.id}>
            <Link className="header-search__link" to={hrefFor(item)} onClick={onNavigate}>
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
