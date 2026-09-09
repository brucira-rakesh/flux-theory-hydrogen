import {
  getAdjacentAndFirstAvailableVariants,
  getSelectedProductOptions,
  useOptimisticVariant,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import {Link, useLoaderData} from 'react-router';
import FluxPdpHero from '~/components/FluxPDP/FluxPdpHero';
import Footer from '~/components/Footer/Footer';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {
  applySelectedVariant,
  toPdpViewModel,
  withoutShopifyDefaultTitleOptions,
} from '~/lib/storefrontCatalog';
import '~/components/PDP/ProductPage.css';
import '~/components/FluxPDP/FluxPdp.css';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data}) => {
  return [
    {title: `Flux Theory | ${data?.product?.title ?? ''}`},
    {
      rel: 'canonical',
      href: `/flux-pdp/${data?.product?.handle}`,
    },
  ];
};

/**
 * @param {Route.LoaderArgs} args
 */
export async function loader(args) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);
  return {...deferredData, ...criticalData};
}

/**
 * @param {Route.LoaderArgs}
 */
async function loadCriticalData({context, params, request}) {
  const {handle} = params;
  const {storefront} = context;

  if (!handle) {
    throw new Error('Expected product handle to be defined');
  }

  const {product} = await storefront.query(PRODUCT_QUERY, {
    variables: {handle, selectedOptions: getSelectedProductOptions(request)},
  });

  if (!product?.id) {
    throw new Response(null, {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle, data: product});

  return {
    product,
    pdp: toPdpViewModel(product),
  };
}

/**
 * @param {Route.LoaderArgs}
 */
function loadDeferredData() {
  return {};
}

/** Percent off from Shopify compare-at vs current price. Null when inapplicable. */
function percentOffFromCompare(price, compareAtPrice) {
  const current = Number(price?.amount);
  const compare = Number(compareAtPrice?.amount);
  if (
    !compareAtPrice ||
    !Number.isFinite(current) ||
    !Number.isFinite(compare) ||
    compare <= 0 ||
    current >= compare
  ) {
    return null;
  }
  const percent = Math.round(((compare - current) / compare) * 100);
  return percent > 0 ? percent : null;
}

export default function FluxPdp() {
  /** @type {LoaderReturnData} */
  const {product, pdp} = useLoaderData();
  const selectedVariant = useOptimisticVariant(
    product.selectedOrFirstAvailableVariant,
    getAdjacentAndFirstAvailableVariants(product),
  );
  useSelectedOptionInUrlParam(
    withoutShopifyDefaultTitleOptions(selectedVariant?.selectedOptions),
  );
  const view = applySelectedVariant(pdp, selectedVariant);
  const price = selectedVariant?.price ?? view.money;
  const compareAtPrice = selectedVariant?.compareAtPrice ?? null;
  const percentOff = percentOffFromCompare(price, compareAtPrice);

  return (
    <div className="pdp-page flux-pdp">
      <SiteHeader />
      <main className="pdp-main">
        <nav className="pdp-breadcrumb" aria-label="Breadcrumb">
          {view.breadcrumb.map((crumb, index) => {
            const isLast = index === view.breadcrumb.length - 1;
            return (
              <span key={crumb} className="pdp-breadcrumb__item">
                {index > 0 && (
                  <span className="pdp-breadcrumb__sep" aria-hidden="true">
                    /
                  </span>
                )}
                {isLast ? (
                  <span className="pdp-breadcrumb__current">{crumb}</span>
                ) : (
                  <Link
                    to={index === 0 ? '/' : '#'}
                    className="pdp-breadcrumb__link"
                  >
                    {crumb}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <FluxPdpHero
          product={product}
          view={view}
          selectedVariant={selectedVariant}
          price={price}
          compareAtPrice={compareAtPrice}
          percentOff={percentOff}
        />
      </main>
      <Footer />
    </div>
  );
}

const PRODUCT_VARIANT_FRAGMENT = `#graphql
  fragment ProductVariant on ProductVariant {
    availableForSale
    compareAtPrice {
      amount
      currencyCode
    }
    id
    image {
      __typename
      id
      url
      altText
      width
      height
    }
    price {
      amount
      currencyCode
    }
    product {
      title
      handle
    }
    selectedOptions {
      name
      value
    }
    sku
    title
    unitPrice {
      amount
      currencyCode
    }
  }
`;

const PRODUCT_FRAGMENT = `#graphql
  fragment Product on Product {
    id
    title
    vendor
    handle
    descriptionHtml
    description
    productType
    tags
    encodedVariantExistence
    encodedVariantAvailability
    featuredImage {
      id
      url
      altText
      width
      height
    }
    images(first: 12) {
      nodes {
        id
        url
        altText
        width
        height
      }
    }
    media(first: 10) {
      nodes {
        __typename
        ... on MediaImage {
          image {
            url
            altText
            width
            height
          }
        }
        ... on Video {
          sources {
            url
            mimeType
          }
          previewImage {
            url
          }
        }
      }
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    collections(first: 5) {
      nodes {
        handle
        title
      }
    }
    options {
      name
      optionValues {
        name
        firstSelectableVariant {
          ...ProductVariant
        }
        swatch {
          color
          image {
            previewImage {
              url
            }
          }
        }
      }
    }
    selectedOrFirstAvailableVariant(selectedOptions: $selectedOptions, ignoreUnknownOptions: true, caseInsensitiveMatch: true) {
      ...ProductVariant
    }
    adjacentVariants (selectedOptions: $selectedOptions) {
      ...ProductVariant
    }
    variants(first: 10) {
      nodes {
        id
        availableForSale
        price {
          amount
          currencyCode
        }
        selectedOptions {
          name
          value
        }
      }
    }
    seo {
      description
      title
    }
    productDetails: metafield(namespace: "custom", key: "product_details") {
      type
      value
    }
    shortDescription: metafield(namespace: "custom", key: "short_description") {
      value
    }
    allIngredients: metafield(namespace: "custom", key: "all_ingredients") {
      value
    }
    whyYoullLoveIt: metafield(namespace: "custom", key: "why_you_ll_love_it") {
      value
    }
    suitableFor: metafield(namespace: "custom", key: "suitable_for") {
      value
    }
    allBenefits: metafield(namespace: "custom", key: "all_benefits") {
      type
      value
    }
    howToUse: metafield(namespace: "custom", key: "how_to_use") {
      reference {
        ... on Metaobject {
          eyebrow: field(key: "eyebrow") { value }
          heading: field(key: "heading") { value }
          media: field(key: "media") {
            reference {
              __typename
              ... on MediaImage {
                image { url altText width height }
              }
              ... on Video {
                sources { url mimeType }
                previewImage { url }
              }
            }
          }
          step: field(key: "step") {
            references(first: 10) {
              nodes {
                ... on Metaobject {
                  title: field(key: "title") { value }
                  description: field(key: "description") { value }
                  icon: field(key: "icon") {
                    reference {
                      ... on MediaImage {
                        image { url altText width height }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    productTicker: metafield(namespace: "custom", key: "product_ticker") {
      references(first: 10) {
        nodes {
          ... on Metaobject {
            feature: field(key: "feature") { value }
          }
        }
      }
    }
    formulation: metafield(namespace: "custom", key: "formulation") {
      references(first: 10) {
        nodes {
          ... on Metaobject {
            title: field(key: "title") { value }
            description: field(key: "description") { value }
          }
        }
      }
    }
    dailyRoutine: metafield(namespace: "custom", key: "daily_routine") {
      type
      references(first: 10) {
        nodes {
          ... on Metaobject {
            position: field(key: "position") { value }
            title: field(key: "title") { value }
            description: field(key: "description") { value }
            image: field(key: "image") {
              reference {
                ... on MediaImage {
                  image { url }
                }
              }
            }
          }
        }
      }
    }
    lifestyleBanner: metafield(namespace: "custom", key: "product_lifestyle_banner_content") {
      reference {
        ... on Metaobject {
          title: field(key: "title") { value }
          description: field(key: "description") { value }
          # Canonical media field (Video | MediaImage) — same union as how_to_use.media
          backgroundMedia: field(key: "background_media") {
            reference {
              __typename
              ... on MediaImage {
                image { url altText width height }
              }
              ... on Video {
                sources { url mimeType }
                previewImage { url }
              }
            }
          }
          mobileMedia: field(key: "mobile_media") {
            reference {
              __typename
              ... on MediaImage {
                image { url altText width height }
              }
              ... on Video {
                sources { url mimeType }
                previewImage { url }
              }
            }
          }
          # Legacy keys — null on entries that only have background_media
          image: field(key: "image") {
            reference {
              __typename
              ... on MediaImage {
                image { url altText width height }
              }
              ... on Video {
                sources { url mimeType }
                previewImage { url }
              }
            }
          }
          productShot: field(key: "product_shot") {
            reference {
              ... on MediaImage {
                image { url altText width height }
              }
            }
          }
        }
      }
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
`;

const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...Product
    }
  }
  ${PRODUCT_FRAGMENT}
`;

/** @typedef {import('./+types/flux-pdp.$handle').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
