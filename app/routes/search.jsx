import {Link, useLoaderData} from 'react-router';
import {getPaginationVariables, Analytics, Pagination} from '@shopify/hydrogen';
import {SearchForm} from '~/components/SearchForm';
import ProductCard from '~/components/Shop/ProductCard';
import {getEmptyPredictiveSearchResult} from '~/lib/search';
import {urlWithTrackingParams} from '~/lib/search';
import '~/components/Shop/Shop.css';
import '~/styles/search.css';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: `Flux Theory | Search`}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request, context}) {
  const url = new URL(request.url);
  const isPredictive = url.searchParams.has('predictive');
  const searchPromise = isPredictive
    ? predictiveSearch({request, context})
    : regularSearch({request, context});

  searchPromise.catch((error) => {
    console.error(error);
    return {term: '', result: null, error: error.message};
  });

  return await searchPromise;
}

/**
 * Renders the /search route
 */
export default function SearchPage() {
  /** @type {LoaderReturnData} */
  const {type, term, result, error} = useLoaderData();
  if (type === 'predictive') return null;

  const products = result?.items?.products;
  const pages = result?.items?.pages?.nodes ?? [];
  const articles = result?.items?.articles?.nodes ?? [];

  return (
    <div className="search-page">
      <div className="search-page__inner">
        <header className="search-page__hero">
          <p className="search-page__eyebrow">Search</p>
          <h1 className="search-page__title">Find Your Formula</h1>
          <p className="search-page__copy">
            Search products, pages, and journal content across the storefront.
          </p>
        </header>

        <SearchForm className="search-page__form">
        {({inputRef}) => (
          <div className="search-page__form-row">
            <input
              className="search-page__input"
              defaultValue={term}
              name="q"
              placeholder="Search products, pages, articles"
              ref={inputRef}
              type="search"
            />
            <button className="search-page__button" type="submit">
              Search
            </button>
          </div>
        )}
      </SearchForm>

        {error ? <p className="search-page__error">{error}</p> : null}

        {!term ? (
          <p className="search-page__empty">Start typing to search the storefront.</p>
        ) : !result?.total ? (
          <p className="search-page__empty">
            No results found for <q>{term}</q>.
          </p>
        ) : (
          <div className="search-page__results">
            <div className="search-page__summary">
              <p className="search-page__count">
                {result.total} {result.total === 1 ? 'result' : 'results'} for <q>{term}</q>
              </p>
            </div>

            {products?.nodes?.length ? (
              <section className="search-page__section" aria-labelledby="search-products-title">
                <div className="search-page__section-head">
                  <h2 id="search-products-title" className="search-page__section-title">
                    Products
                  </h2>
                </div>
                <Pagination connection={products}>
                  {({nodes, isLoading, NextLink, PreviousLink}) => (
                    <>
                      <ul className="shop-grid search-page__products">
                        {nodes.map((product) => (
                          <li key={product.id} className="shop-grid__item">
                            <ProductCard product={toSearchProductCard(product, term)} showQuickAdd={false} />
                          </li>
                        ))}
                      </ul>
                      <div className="search-page__pager">
                        <PreviousLink className="search-page__pager-link">
                          {isLoading ? 'Loading…' : 'Load previous'}
                        </PreviousLink>
                        <NextLink className="search-page__pager-link">
                          {isLoading ? 'Loading…' : 'Load more'}
                        </NextLink>
                      </div>
                    </>
                  )}
                </Pagination>
              </section>
            ) : null}

            {pages.length ? (
              <section className="search-page__section" aria-labelledby="search-pages-title">
                <h2 id="search-pages-title" className="search-page__section-title">
                  Pages
                </h2>
                <ul className="search-page__link-list">
                  {pages.map((page) => (
                    <li key={page.id} className="search-page__link-item">
                      <Link
                        className="search-page__link-card"
                        prefetch="intent"
                        to={urlWithTrackingParams({
                          baseUrl: `/pages/${page.handle}`,
                          trackingParams: page.trackingParameters,
                          term,
                        })}
                      >
                        <span className="search-page__link-label">Page</span>
                        <span className="search-page__link-title">{page.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {articles.length ? (
              <section className="search-page__section" aria-labelledby="search-articles-title">
                <h2 id="search-articles-title" className="search-page__section-title">
                  Articles
                </h2>
                <ul className="search-page__link-list">
                  {articles.map((article) => (
                    <li key={article.id} className="search-page__link-item">
                      <Link
                        className="search-page__link-card"
                        prefetch="intent"
                        to={urlWithTrackingParams({
                          baseUrl: `/blogs/${article.blog.handle}/${article.handle}`,
                          trackingParams: article.trackingParameters,
                          term,
                        })}
                      >
                        <span className="search-page__link-label">Article</span>
                        <span className="search-page__link-title">{article.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        <Analytics.SearchView data={{searchTerm: term, searchResults: result}} />
      </div>
    </div>
  );
}

function moneySymbol(currencyCode) {
  return currencyCode === 'INR' ? '₹' : currencyCode || '₹';
}

function toSearchProductCard(product, term) {
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

/**
 * Regular search query and fragments
 * (adjust as needed)
 */
const SEARCH_PRODUCT_FRAGMENT = `#graphql
  fragment SearchProduct on Product {
    __typename
    handle
    id
    publishedAt
    title
    trackingParameters
    vendor
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        url
        altText
        width
        height
      }
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
        currencyCode
      }
      selectedOptions {
        name
        value
      }
      product {
        handle
        title
      }
    }
  }
`;

const SEARCH_PAGE_FRAGMENT = `#graphql
  fragment SearchPage on Page {
     __typename
     handle
    id
    title
    trackingParameters
  }
`;

const SEARCH_ARTICLE_FRAGMENT = `#graphql
  fragment SearchArticle on Article {
    __typename
    blog {
      handle
    }
    handle
    id
    title
    trackingParameters
  }
`;

const PAGE_INFO_FRAGMENT = `#graphql
  fragment PageInfoFragment on PageInfo {
    hasNextPage
    hasPreviousPage
    startCursor
    endCursor
  }
`;

// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/search
export const SEARCH_QUERY = `#graphql
  query RegularSearch(
    $country: CountryCode
    $endCursor: String
    $first: Int
    $language: LanguageCode
    $last: Int
    $term: String!
    $startCursor: String
  ) @inContext(country: $country, language: $language) {
    articles: search(
      query: $term,
      types: [ARTICLE],
      first: $first,
    ) {
      nodes {
        ...on Article {
          ...SearchArticle
        }
      }
    }
    pages: search(
      query: $term,
      types: [PAGE],
      first: $first,
    ) {
      nodes {
        ...on Page {
          ...SearchPage
        }
      }
    }
    products: search(
      after: $endCursor,
      before: $startCursor,
      first: $first,
      last: $last,
      query: $term,
      sortKey: RELEVANCE,
      types: [PRODUCT],
      unavailableProducts: HIDE,
    ) {
      nodes {
        ...on Product {
          ...SearchProduct
        }
      }
      pageInfo {
        ...PageInfoFragment
      }
    }
  }
  ${SEARCH_PRODUCT_FRAGMENT}
  ${SEARCH_PAGE_FRAGMENT}
  ${SEARCH_ARTICLE_FRAGMENT}
  ${PAGE_INFO_FRAGMENT}
`;

/**
 * Regular search fetcher
 * @param {Pick<
 *   Route.LoaderArgs,
 *   'request' | 'context'
 * >}
 * @return {Promise<RegularSearchReturn>}
 */
async function regularSearch({request, context}) {
  const {storefront} = context;
  const url = new URL(request.url);
  const variables = getPaginationVariables(request, {pageBy: 8});
  const term = String(url.searchParams.get('q') || '');

  // Search articles, pages, and products for the `q` term
  const {errors, ...items} = await storefront.query(SEARCH_QUERY, {
    variables: {...variables, term},
  });

  if (!items) {
    throw new Error('No search data returned from Shopify API');
  }

  const total = Object.values(items).reduce(
    (acc, {nodes}) => acc + nodes.length,
    0,
  );

  const error = errors
    ? errors.map(({message}) => message).join(', ')
    : undefined;

  return {type: 'regular', term, error, result: {total, items}};
}

/**
 * Predictive search query and fragments
 * (adjust as needed)
 */
const PREDICTIVE_SEARCH_ARTICLE_FRAGMENT = `#graphql
  fragment PredictiveArticle on Article {
    __typename
    id
    title
    handle
    blog {
      handle
    }
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_COLLECTION_FRAGMENT = `#graphql
  fragment PredictiveCollection on Collection {
    __typename
    id
    title
    handle
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_PAGE_FRAGMENT = `#graphql
  fragment PredictivePage on Page {
    __typename
    id
    title
    handle
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_PRODUCT_FRAGMENT = `#graphql
  fragment PredictiveProduct on Product {
    __typename
    id
    title
    handle
    trackingParameters
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        url
        altText
        width
        height
      }
      price {
        amount
        currencyCode
      }
    }
  }
`;

const PREDICTIVE_SEARCH_QUERY_FRAGMENT = `#graphql
  fragment PredictiveQuery on SearchQuerySuggestion {
    __typename
    text
    styledText
    trackingParameters
  }
`;

// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/predictiveSearch
const PREDICTIVE_SEARCH_QUERY = `#graphql
  query PredictiveSearch(
    $country: CountryCode
    $language: LanguageCode
    $limit: Int!
    $limitScope: PredictiveSearchLimitScope!
    $term: String!
    $types: [PredictiveSearchType!]
  ) @inContext(country: $country, language: $language) {
    predictiveSearch(
      limit: $limit,
      limitScope: $limitScope,
      query: $term,
      types: $types,
    ) {
      articles {
        ...PredictiveArticle
      }
      collections {
        ...PredictiveCollection
      }
      pages {
        ...PredictivePage
      }
      products {
        ...PredictiveProduct
      }
      queries {
        ...PredictiveQuery
      }
    }
  }
  ${PREDICTIVE_SEARCH_ARTICLE_FRAGMENT}
  ${PREDICTIVE_SEARCH_COLLECTION_FRAGMENT}
  ${PREDICTIVE_SEARCH_PAGE_FRAGMENT}
  ${PREDICTIVE_SEARCH_PRODUCT_FRAGMENT}
  ${PREDICTIVE_SEARCH_QUERY_FRAGMENT}
`;

/**
 * Predictive search fetcher
 * @param {Pick<
 *   Route.ActionArgs,
 *   'request' | 'context'
 * >}
 * @return {Promise<PredictiveSearchReturn>}
 */
async function predictiveSearch({request, context}) {
  const {storefront} = context;
  const url = new URL(request.url);
  const term = String(url.searchParams.get('q') || '').trim();
  const limit = Number(url.searchParams.get('limit') || 10);
  const type = 'predictive';

  if (!term) return {type, term, result: getEmptyPredictiveSearchResult()};

  // Predictively search articles, collections, pages, products, and queries (suggestions)
  const {predictiveSearch: items, errors} = await storefront.query(
    PREDICTIVE_SEARCH_QUERY,
    {
      variables: {
        // customize search options as needed
        limit,
        limitScope: 'EACH',
        term,
      },
    },
  );

  if (errors) {
    throw new Error(
      `Shopify API errors: ${errors.map(({message}) => message).join(', ')}`,
    );
  }

  if (!items) {
    throw new Error('No predictive search data returned from Shopify API');
  }

  const total = Object.values(items).reduce(
    (acc, item) => acc + item.length,
    0,
  );

  return {type, term, result: {items, total}};
}

/** @typedef {import('./+types/search').Route} Route */
/** @typedef {import('~/lib/search').RegularSearchReturn} RegularSearchReturn */
/** @typedef {import('~/lib/search').PredictiveSearchReturn} PredictiveSearchReturn */
/** @typedef {import('storefrontapi.generated').RegularSearchQuery} RegularSearchQuery */
/** @typedef {import('storefrontapi.generated').PredictiveSearchQuery} PredictiveSearchQuery */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
