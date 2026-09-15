import {useCallback, useEffect, useRef, useState} from 'react';
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
import FooterV3 from '~/components/Footer/FooterV3';
import SmoothScroll from '~/components/SmoothScroll/SmoothScroll';
import PdpAccordion from '~/components/PDP/PdpAccordion';
import PdpLifestyle from '~/components/PDP/PdpLifestyle';
import PdpMarquee from '~/components/PDP/PdpMarquee';
import PdpSimilar from '~/components/PDP/PdpSimilar';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import FluxPdpStickyBar from '~/components/FluxPDP/FluxPdpStickyBar';
import {usePdpMotion} from '~/hooks/usePdpMotion';
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
 *   selectedOrFirstAvailableVariant?: {id?: string, availableForSale?: boolean} | null,
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
      variantGid: node.selectedOrFirstAvailableVariant?.id || null,
      availableForSale:
        node.selectedOrFirstAvailableVariant?.availableForSale !== false,
    });
  }

  const current = {
    id: product.id,
    handle: product.handle,
    title: product.title || product.handle,
    imageUrl: product.featuredImage?.url || null,
    imageAlt: product.featuredImage?.altText || product.title || '',
    isCurrent: true,
    variantGid: product.selectedOrFirstAvailableVariant?.id || null,
    availableForSale:
      product.selectedOrFirstAvailableVariant?.availableForSale !== false,
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
  /** Desktop: ticker fully entered — sticky may show. */
  const [tickerFullyOnScreen, setTickerFullyOnScreen] = useState(false);
  /** Gift section intersects the viewport — hide mobile sticky while on it. */
  const [giftInView, setGiftInView] = useState(false);
  /** Founder pin/scrub (zoom → fill → zoom-out) — hide sticky while active. */
  const [founderPinActive, setFounderPinActive] = useState(false);
  /** Mobile sticky ATC: hero buy box still on screen → direct add; else open picker. */
  const [heroInView, setHeroInView] = useState(true);
  const [isMobileSticky, setIsMobileSticky] = useState(false);
  const formRef = useRef(null);
  const lifestyleRef = useRef(null);
  const giftSectionRef = useRef(null);
  const tickerRef = useRef(null);
  /** Pinned while the gift section curtains over the end of the hero. */
  const heroCurtainPinRef = useRef(null);
  const heroControlsRef = useRef(null);
  const footerSentinelRef = useRef(null);
  const pageRef = useRef(null);

  usePdpMotion(pageRef, {
    enabled: Boolean(product),
    replayKey: product?.handle,
  });

  const onFounderPinActiveChange = useCallback((active) => {
    setFounderPinActive(Boolean(active));
  }, []);

  useEffect(() => {
    setQuantity(1);
    setStickyVisible(false);
    setTickerFullyOnScreen(false);
    setGiftInView(false);
    setFounderPinActive(false);
    setHeroInView(true);
  }, [product.handle]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobileSticky(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Mobile: sticky on by default; hide on gift + while CEO pin/zoom is active.
  // Desktop: show after ticker is fully on screen; hide during CEO pin.
  useEffect(() => {
    if (isMobileSticky) {
      setStickyVisible(!giftInView && !founderPinActive);
      return;
    }
    setStickyVisible(tickerFullyOnScreen && !founderPinActive);
  }, [isMobileSticky, giftInView, founderPinActive, tickerFullyOnScreen]);

  useEffect(() => {
    const hero = document.querySelector('.flux-pdp-hero');
    const form = formRef.current;
    const target = hero || form;
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setHeroInView(Boolean(entry?.isIntersecting)),
      {threshold: 0, rootMargin: '0px'},
    );
    io.observe(target);
    return () => io.disconnect();
  }, [product.handle]);

  // Gift in view (mobile sticky hide while the gifting section is on screen).
  useEffect(() => {
    const gift = giftSectionRef.current;
    if (!gift || typeof IntersectionObserver === 'undefined') {
      setGiftInView(false);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => setGiftInView(Boolean(entry?.isIntersecting)),
      {threshold: 0, rootMargin: '0px'},
    );
    io.observe(gift);
    return () => io.disconnect();
  }, [product.handle, Boolean(giftBundle)]);

  useEffect(() => {
    const ticker = tickerRef.current;
    const gift = giftSectionRef.current;
    const form = formRef.current;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const scroller = document.querySelector('[data-scroll-root]') ?? window;
    let lastReady = null;
    let ticking = false;

    const readTickerReady = () => {
      let next = false;
      if (ticker) {
        // 100% on screen, or scrolled past: the ticker's bottom has reached
        // the viewport bottom (entire section has entered from below).
        next = ticker.getBoundingClientRect().bottom <= window.innerHeight;
      } else if (gift) {
        next = gift.getBoundingClientRect().top < 0;
      } else if (form) {
        next = form.getBoundingClientRect().bottom <= 0;
      }
      if (next === lastReady) return;
      lastReady = next;
      setTickerFullyOnScreen(next);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        readTickerReady();
      });
    };

    readTickerReady();

    if (scroller === window) {
      window.addEventListener('scroll', onScroll, {passive: true});
    } else {
      scroller.addEventListener('scroll', onScroll, {passive: true});
    }

    const targets = [ticker, gift, form].filter(Boolean);
    let io;
    if (targets.length) {
      io = new IntersectionObserver(readTickerReady, {
        threshold: [0, 1],
      });
      for (const target of targets) io.observe(target);
    }

    return () => {
      if (scroller === window) {
        window.removeEventListener('scroll', onScroll);
      } else {
        scroller.removeEventListener('scroll', onScroll);
      }
      io?.disconnect();
    };
  }, [product.handle, Boolean(giftBundle), Boolean(view.marquee)]);

  return (
    <SmoothScroll lenisOptions={{duration: 0.4}}>
      <div ref={pageRef} className="pdp-page flux-pdp">
        <SiteHeader />
        {/* No data-pdp-reveal on main — transforms break the gift curtain pin. */}
        <main ref={heroCurtainPinRef} className="pdp-main flux-pdp-curtain-pin">
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
        {giftBundle ? (
          <FluxPdpGiftBanner
            bundle={giftBundle}
            sectionRef={giftSectionRef}
            pinTargetRef={heroCurtainPinRef}
          />
        ) : null}
        {view.marquee ? (
          <div ref={tickerRef} data-pdp-reveal data-pdp-reveal-y="0">
            <PdpMarquee items={view.marquee.items} variant="light" />
          </div>
        ) : null}
        {view.lifestyle ? (
          <div data-pdp-reveal>
            <PdpLifestyle lifestyle={view.lifestyle} sectionRef={lifestyleRef} />
          </div>
        ) : null}
        {/* No data-pdp-reveal wrapper — parent transforms break ScrollTrigger pin. */}
        <FluxPdpTestimonial onPinActiveChange={onFounderPinActiveChange} />
        {/* Slide-in on the review grid owns entrance — no parent reveal
            (parent transforms hide / fight the horizontal rail entry). */}
        <FluxPdpReviewCta reviews={reviews} />
        <div className="pdp-main pdp-main--lower">
          <PdpSimilar products={similar} />
        </div>
        <FluxPdpStickyBar
          product={product}
          selectedVariant={selectedVariant}
          price={price}
          compareAtPrice={compareAtPrice}
          title={view.name}
          visible={stickyVisible}
          heroInView={heroInView}
          quantity={quantity}
          onQuantityChange={setQuantity}
          heroControlsRef={heroControlsRef}
          footerSentinelRef={footerSentinelRef}
        />
        <div
          ref={footerSentinelRef}
          className="pdp-footer-sentinel"
          aria-hidden="true"
        />
        <div data-pdp-reveal data-pdp-reveal-y="16">
          <FooterV3 />
        </div>
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
            selectedOrFirstAvailableVariant {
              id
              availableForSale
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
    productIcons: metafield(namespace: "custom", key: "product_icons") {
      references(first: 8) {
        nodes {
          ... on Metaobject {
            title: field(key: "title") { value }
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
