import {useEffect, useRef, useState} from 'react';
import {
  getAdjacentAndFirstAvailableVariants,
  getSelectedProductOptions,
  useOptimisticVariant,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import {data, useLoaderData} from 'react-router';
import FluxPdpFeatureGrid from '~/components/FluxPDP/FluxPdpFeatureGrid';
import FluxPdpGiftBanner from '~/components/FluxPDP/FluxPdpGiftBanner';
import FluxPdpHero from '~/components/FluxPDP/FluxPdpHero';
import FluxPdpReviewCta from '~/components/FluxPDP/FluxPdpReviewCta';
import FluxPdpTestimonial from '~/components/FluxPDP/FluxPdpTestimonial';
import Footer from '~/components/Footer/Footer';
import SmoothScroll from '~/components/SmoothScroll/SmoothScroll';
import PdpAccordion from '~/components/PDP/PdpAccordion';
import PdpLifestyle from '~/components/PDP/PdpLifestyle';
import PdpMarquee from '~/components/PDP/PdpMarquee';
import PdpSimilar from '~/components/PDP/PdpSimilar';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
// TEMPORARY: sticky ATC hidden — re-import PdpStickyBar when restoring.
// import PdpStickyBar from '~/components/PDP/PdpStickyBar';
import {
  clientIpFromRequest,
  loadJudgeMeProductReviews,
  submitJudgeMeReview,
} from '~/lib/judgeme';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {
  PRODUCT_SIMILAR_QUERY,
  activeOffersFromMetafield,
  applySelectedVariant,
  giftBundleFromMetafield,
  toListingCard,
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
 * Judge.me web-review create — private token never used; shop_domain + product
 * id resolved on the server from env / handle.
 *
 * @param {Route.ActionArgs} args
 */
export async function action({request, context, params}) {
  const formData = await request.formData();
  if (formData.get('intent') !== 'judgeme-review') {
    return data({ok: false, error: 'Invalid request.'}, {status: 400});
  }

  const handle = params.handle;
  if (!handle) {
    return data({ok: false, error: 'Missing product.'}, {status: 400});
  }

  const {product} = await context.storefront.query(PRODUCT_ID_QUERY, {
    variables: {handle},
  });

  if (!product?.id) {
    return data({ok: false, error: 'Product not found.'}, {status: 404});
  }

  const pictureUrls = formData
    .getAll('picture_urls')
    .map((value) => String(value ?? '').trim())
    .filter((value) => /^https?:\/\//i.test(value));

  const result = await submitJudgeMeReview({
    env: context.env,
    productGid: product.id,
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    rating: Number(formData.get('rating')),
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    ipAddr: clientIpFromRequest(request),
    pictureUrls,
  });

  if (!result.ok) {
    return data({ok: false, error: result.error}, {status: 400});
  }

  return data({ok: true});
}

/**
 * @param {Route.LoaderArgs}
 */
const PREFERRED_PACK_VALUE = 'Pack of 2';

/**
 * Default SELECT PACK to "Pack of 2" when the URL does not already pick a pack
 * and that value exists on the product. Otherwise keep Shopify's first-available.
 * @param {Array<{name: string, value: string}>} selectedOptions
 * @param {{options?: Array<{name: string, optionValues?: Array<{name: string}>}>}} product
 */
function withPreferredPackOption(selectedOptions, product) {
  const packOption = (product?.options ?? []).find((option) => {
    const name = option?.name?.toLowerCase() ?? '';
    if (name.includes('pack')) return true;
    return (option?.optionValues ?? []).some((value) =>
      /pack of\s*\d+/i.test(value?.name ?? ''),
    );
  });
  if (!packOption?.name) return selectedOptions;

  const hasPackInUrl = selectedOptions.some(
    (option) => option.name === packOption.name,
  );
  if (hasPackInUrl) return selectedOptions;

  const packOf2 = (packOption.optionValues ?? []).find(
    (value) => value.name === PREFERRED_PACK_VALUE,
  );
  if (!packOf2) return selectedOptions;

  return [
    ...selectedOptions.filter((option) => option.name !== packOption.name),
    {name: packOption.name, value: PREFERRED_PACK_VALUE},
  ];
}

async function loadCriticalData({context, params, request}) {
  const {handle} = params;
  const {storefront, env} = context;

  if (!handle) {
    throw new Error('Expected product handle to be defined');
  }

  const urlSelectedOptions = getSelectedProductOptions(request);

  const [{product: productProbe}, similarResult] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      variables: {handle, selectedOptions: urlSelectedOptions},
    }),
    storefront.query(PRODUCT_SIMILAR_QUERY, {
      variables: {first: 8},
    }),
  ]);

  if (!productProbe?.id) {
    throw new Response(null, {status: 404});
  }

  const preferredOptions = withPreferredPackOption(
    urlSelectedOptions,
    productProbe,
  );
  const needsReprefetch =
    preferredOptions.length !== urlSelectedOptions.length ||
    preferredOptions.some(
      (option, index) =>
        option.name !== urlSelectedOptions[index]?.name ||
        option.value !== urlSelectedOptions[index]?.value,
    );

  const product = needsReprefetch
    ? (
        await storefront.query(PRODUCT_QUERY, {
          variables: {handle, selectedOptions: preferredOptions},
        })
      ).product
    : productProbe;

  if (!product?.id) {
    throw new Response(null, {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle, data: product});

  const similar = (similarResult?.products?.nodes ?? [])
    .filter((node) => node.handle !== product.handle)
    .map((node, index) => toListingCard(node, index));

  // Judge.me private token stays on the server — never fetched from the client.
  // Offers: Storefront metaobject entries only (drafts already omitted by Shopify).
  const reviews = await loadJudgeMeProductReviews({
    env,
    productGid: product.id,
  });
  const activeOffers = activeOffersFromMetafield(product);

  return {
    product,
    pdp: toPdpViewModel(product),
    similar,
    reviews,
    relatedProducts: relatedProductsFromMetafield(product),
    giftBundle: giftBundleFromMetafield(product),
    activeOffers,
  };
}

/**
 * @param {Route.LoaderArgs}
 */
function loadDeferredData() {
  return {};
}

/**
 * SELECT VARIANT swatches from `custom.product_variants` (list.product_reference).
 * Always includes the current product (marked current); metafield products link
 * to `/products/{handle}`.
 *
 * @param {{
 *   id?: string,
 *   handle?: string,
 *   title?: string,
 *   featuredImage?: {url?: string, altText?: string | null} | null,
 *   productVariants?: {references?: {nodes?: unknown[]}} | null,
 * }} product
 */
function relatedProductsFromMetafield(product) {
  if (!product?.id || !product?.handle) return null;

  const nodes = product?.productVariants?.references?.nodes ?? [];
  const related = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (!node.handle || !node.id) continue;
    related.push({
      id: node.id,
      handle: node.handle,
      title: node.title || node.handle,
      imageUrl: node.featuredImage?.url || null,
      imageAlt: node.featuredImage?.altText || node.title || '',
    });
  }

  const current = {
    id: product.id,
    handle: product.handle,
    title: product.title || product.handle,
    imageUrl: product.featuredImage?.url || null,
    imageAlt: product.featuredImage?.altText || product.title || '',
    isCurrent: true,
  };

  const withoutCurrent = related.filter((item) => item.id !== product.id);
  return [current, ...withoutCurrent];
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
  const {
    product,
    pdp,
    similar,
    reviews,
    relatedProducts,
    giftBundle,
    activeOffers,
  } = useLoaderData();
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

  const [quantity, setQuantity] = useState(1);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [heroFormOutOfView, setHeroFormOutOfView] = useState(false);
  const [lifestyleInView, setLifestyleInView] = useState(false);
  const [howToApproaching, setHowToApproaching] = useState(false);
  const formRef = useRef(null);
  const lifestyleRef = useRef(null);
  const howToRef = useRef(null);
  const heroControlsRef = useRef(null);
  const footerSentinelRef = useRef(null);

  useEffect(() => {
    setQuantity(1);
    setStickyVisible(false);
    setHeroFormOutOfView(false);
    setLifestyleInView(false);
    setHowToApproaching(false);
  }, [product.handle]);

  useEffect(() => {
    setStickyVisible(heroFormOutOfView && (!lifestyleInView || howToApproaching));
  }, [heroFormOutOfView, lifestyleInView, howToApproaching]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || typeof IntersectionObserver === 'undefined') return;

    const lifestyle = lifestyleRef.current;
    const howTo = howToRef.current;
    let formOut = false;
    let lifestyleVisible = false;
    let howToNear = false;

    const recompute = () => {
      setHeroFormOutOfView(formOut);
      setLifestyleInView(lifestyleVisible);
      setHowToApproaching(howToNear);
      setStickyVisible(formOut && (!lifestyleVisible || howToNear));
    };

    formOut = form.getBoundingClientRect().bottom <= 0;
    if (lifestyle) {
      const rect = lifestyle.getBoundingClientRect();
      lifestyleVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    }
    if (howTo) {
      const rect = howTo.getBoundingClientRect();
      const early = 56;
      howToNear = rect.top < window.innerHeight + early && rect.bottom > 0;
    }
    recompute();

    const gateObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === form) formOut = !entry.isIntersecting;
          if (lifestyle && entry.target === lifestyle) {
            lifestyleVisible = entry.isIntersecting;
          }
        }
        recompute();
      },
      {threshold: 0, rootMargin: '0px'},
    );

    gateObserver.observe(form);
    if (lifestyle) gateObserver.observe(lifestyle);

    let howToObserver;
    if (howTo) {
      howToObserver = new IntersectionObserver(
        ([entry]) => {
          howToNear = entry.isIntersecting;
          recompute();
        },
        {threshold: 0, rootMargin: '0px 0px 56px 0px'},
      );
      howToObserver.observe(howTo);
    }

    return () => {
      gateObserver.disconnect();
      howToObserver?.disconnect();
    };
  }, [product.handle, Boolean(view.lifestyle), Boolean(view.howTo)]);

  return (
    <SmoothScroll>
      <div className="pdp-page flux-pdp">
        <SiteHeader />
        <main className="pdp-main">
          <FluxPdpHero
            product={product}
            view={view}
            selectedVariant={selectedVariant}
            price={price}
            compareAtPrice={compareAtPrice}
            percentOff={percentOff}
            quantity={quantity}
            onQuantityChange={setQuantity}
            formRef={formRef}
            heroControlsRef={heroControlsRef}
            relatedProducts={relatedProducts}
            activeOffers={activeOffers}
            details={
              view.accordion ? (
                <PdpAccordion
                  items={view.accordion}
                  bottleSrc={null}
                  bottleAlt={`${view.name} bottle`}
                  productName={view.name}
                  detailsExtra={<FluxPdpFeatureGrid handle={product.handle} />}
                />
              ) : null
            }
          />
        </main>
        <FluxPdpGiftBanner bundle={giftBundle} />
        {view.marquee ? (
          <PdpMarquee items={view.marquee.items} variant="light" />
        ) : null}
        {view.lifestyle ? (
          <PdpLifestyle lifestyle={view.lifestyle} sectionRef={lifestyleRef} />
        ) : null}
        <FluxPdpTestimonial />
        <FluxPdpReviewCta reviews={reviews} />
        <div className="pdp-main pdp-main--lower">
          <PdpSimilar products={similar} />
        </div>
        {/* TEMPORARY: sticky ATC hidden on Flux PDP — restore PdpStickyBar when ready. */}
        <div
          ref={footerSentinelRef}
          className="pdp-footer-sentinel"
          aria-hidden="true"
        />
        <Footer />
      </div>
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
    productVariants: metafield(
      namespace: "custom"
      key: "product_variants"
    ) {
      references(first: 12) {
        nodes {
          ... on Product {
            id
            handle
            title
            featuredImage {
              id
              url
              altText
              width
              height
            }
          }
        }
      }
    }
    productOffers: metafield(namespace: "custom", key: "product_offers") {
      references(first: 10) {
        nodes {
          ... on Metaobject {
            id
            # Storefront Metaobject has no status field. For publishable types,
            # Draft entries are omitted here — presence implies Admin
            # capabilities.publishable.status === ACTIVE.
            couponCode: field(key: "coupon_code") { value }
            name: field(key: "name") { value }
            description: field(key: "description") { value }
          }
        }
      }
    }
    productBundle: metafield(namespace: "custom", key: "product_bundle") {
      reference {
        ... on Metaobject {
          sectionTitle: field(key: "section_title") { value }
          sectionDescription: field(key: "section_description") { value }
          desktopBanner: field(key: "desktop_banner") {
            reference {
              ... on MediaImage {
                image { url altText width height }
              }
            }
          }
          mobileBanner: field(key: "mobile_banner") {
            reference {
              ... on MediaImage {
                image { url altText width height }
              }
            }
          }
          bundleHotspot: field(key: "bundle_hotspot") {
            references(first: 12) {
              nodes {
                ... on Metaobject {
                  id
                  product: field(key: "product") {
                    reference {
                      ... on Product {
                        id
                        handle
                        title
                        variants(first: 25) {
                          nodes {
                            id
                            title
                            availableForSale
                            price { amount currencyCode }
                            compareAtPrice { amount currencyCode }
                            image { id url altText width height }
                            selectedOptions { name value }
                            product { id handle title }
                          }
                        }
                      }
                    }
                  }
                  desktopXy: field(key: "desktop_xy") { value }
                  mobileXy: field(key: "mobile_xy") { value }
                }
              }
            }
          }
        }
      }
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

const PRODUCT_ID_QUERY = `#graphql
  query ProductIdForReview(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
    }
  }
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
