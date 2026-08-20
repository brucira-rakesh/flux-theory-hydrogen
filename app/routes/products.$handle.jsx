import {useEffect, useState} from 'react';
import {useLoaderData, useNavigate} from 'react-router';
import {
  getAdjacentAndFirstAvailableVariants,
  getProductOptions,
  getSelectedProductOptions,
  useOptimisticVariant,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {
  PRODUCT_SIMILAR_QUERY,
  applySelectedVariant,
  toListingCard,
  toPdpViewModel,
  withoutShopifyDefaultTitleOptions,
} from '~/lib/storefrontCatalog';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data}) => {
  return [
    {title: `Flux Theory | ${data?.product?.title ?? ''}`},
    {
      rel: 'canonical',
      href: `/products/${data?.product?.handle}`,
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

  const [{product}, similarResult] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      variables: {handle, selectedOptions: getSelectedProductOptions(request)},
    }),
    storefront.query(PRODUCT_SIMILAR_QUERY, {
      variables: {first: 8},
    }),
  ]);

  if (!product?.id) {
    throw new Response(null, {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle, data: product});

  const similar = (similarResult?.products?.nodes ?? [])
    .filter((node) => node.handle !== product.handle)
    .map((node, index) => toListingCard(node, index));

  return {
    product,
    pdp: toPdpViewModel(product),
    similar,
  };
}

/**
 * @param {Route.LoaderArgs}
 */
function loadDeferredData() {
  return {};
}

export default function ProductHandle() {
  /** @type {LoaderReturnData} */
  const {product, pdp, similar} = useLoaderData();
  const navigate = useNavigate();
  const selectedVariant = useOptimisticVariant(
    product.selectedOrFirstAvailableVariant,
    getAdjacentAndFirstAvailableVariants(product),
  );
  useSelectedOptionInUrlParam(
    withoutShopifyDefaultTitleOptions(selectedVariant?.selectedOptions),
  );
  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });
  const view = applySelectedVariant(pdp, selectedVariant);

  const onSizeChange = (value) => {
    const sizeOption = productOptions.find(
      (option) => option.name?.toLowerCase() === 'size',
    );
    const next = sizeOption?.optionValues?.find((option) => option.name === value);
    if (next?.variantUriQuery) {
      void navigate(`?${next.variantUriQuery}`, {
        replace: true,
        preventScrollReset: true,
      });
    }
  };

  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    Promise.all([
      import('~/pages/ProductPage'),
      import('~/components/SmoothScroll/SmoothScroll'),
    ]).then(([pageMod, scrollMod]) => {
      setBundle({
        Page: pageMod.default,
        SmoothScroll: scrollMod.default,
      });
    });
  }, []);

  if (!bundle) return null;
  const {Page, SmoothScroll} = bundle;
  return (
    <SmoothScroll>
      <Page product={view} similar={similar} onSizeChange={onSizeChange} />
    </SmoothScroll>
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
    stateOfMind: metafield(namespace: "custom", key: "state_of_mind") {
      value
    }
    fragranceNotes: metafield(namespace: "custom", key: "fragrance_notes") {
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

/** @typedef {import('./+types/products.$handle').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
