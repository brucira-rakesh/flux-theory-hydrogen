import {getPdpBySlug} from '~/data/pdp';
import {FILTER_TAGS} from '~/data/shop';

const MOOD_TAG_IDS = new Set(FILTER_TAGS.map((tag) => tag.id));
const DREAMER_BENEFITS_TITLE = getPdpBySlug('the-dreamer')?.benefits?.title;

export function moneySymbol(currencyCode) {
  if (currencyCode === 'INR') return '₹';
  return currencyCode || '₹';
}

export function moneyAmount(money) {
  return Number(money?.amount ?? 0);
}

export function formatMoneyDisplay(money) {
  const amount = moneyAmount(money);
  return `${moneySymbol(money?.currencyCode)}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function cartLinesForMerchandise(merchandiseId, quantity = 1, selectedVariant) {
  if (!merchandiseId) return [];
  const line = {
    merchandiseId,
    quantity: Math.max(1, Number(quantity) || 1),
  };
  if (selectedVariant) line.selectedVariant = selectedVariant;
  return [line];
}

/**
 * Real shopper-facing Size values. Shopify's auto "Title / Default Title"
 * option (products without configured variants) is ignored.
 */
export function sizesFromProduct(product) {
  const options = product?.options ?? [];
  const sizeOption = options.find((option) => option.name?.toLowerCase() === 'size');
  const values = sizeOption?.optionValues?.map((value) => value.name).filter(Boolean) ?? [];
  if (values.length > 1) return values;
  return [];
}

/** Show size UI only when sizesFromProduct returned 2+ real Size values. */
export function shouldShowSizeSelect(sizes) {
  return (sizes ?? []).length > 1;
}

export function categoryFromShopifyProduct(product) {
  const type = String(product?.productType || '').toLowerCase();
  const tags = (product?.tags || []).map((tag) => String(tag).toLowerCase());
  const collections = product?.collections?.nodes?.map((node) => node.handle) ?? [];
  if (
    type.includes('face') ||
    tags.includes('face') ||
    collections.includes('face')
  ) {
    return 'face';
  }
  return 'body';
}

export function moodTagsFromProduct(product) {
  return (product?.tags || [])
    .map((tag) => String(tag).toLowerCase())
    .filter((tag) => MOOD_TAG_IDS.has(tag));
}

export function toListingCard(product, featuredOrder = 0) {
  const money = product?.priceRange?.minVariantPrice;
  const sizes = sizesFromProduct(product);

  const sizeValueFromSelectedOptions = (selectedOptions) =>
    (selectedOptions ?? []).find((o) => o?.name?.toLowerCase() === 'size')?.value;

  const variantNodes = product?.variants?.nodes ?? [];
  const variants = variantNodes
    .map((v) => {
      const sizeValue = sizeValueFromSelectedOptions(v?.selectedOptions);
      return {
        id: v?.id,
        availableForSale: v?.availableForSale !== false,
        sizeValue: sizeValue ? String(sizeValue) : undefined,
        priceAmount: moneyAmount(v?.price),
        priceCurrency: moneySymbol(v?.price?.currencyCode),
      };
    })
    .filter((v) => Boolean(v?.id));

  const variantBySize = variants
    .filter((v) => v.sizeValue)
    .reduce((acc, v) => {
      acc[v.sizeValue] = v;
      return acc;
    }, {});

  const defaultVariant =
    variants.find((v) => v.availableForSale) ?? variants[0] ?? null;
  const defaultSize = defaultVariant?.sizeValue ?? sizes[0];

  // Fallback: when variants aren't present (legacy queries), use the current
  // static default variant id + min price.
  const variantGid = defaultVariant?.id ?? product.selectedOrFirstAvailableVariant?.id;
  const currency = defaultVariant?.priceCurrency ?? moneySymbol(money?.currencyCode);
  const price = defaultVariant?.priceAmount ?? moneyAmount(money);
  return {
    id: product.id,
    handle: product.handle,
    listId: product.id,
    name: product.title,
    price,
    currency,
    money,
    image: product.featuredImage?.url,
    href: `/products/${product.handle}`,
    sizes,
    defaultSize,
    category: categoryFromShopifyProduct(product),
    tags: moodTagsFromProduct(product),
    featuredOrder,
    variantGid,
    variants,
    variantBySize,
  };
}

function mediaPreviewUrl(node) {
  if (!node) return undefined;
  return node.__typename === 'Video'
    ? node.previewImage?.url
    : node.image?.url;
}

function galleryFromProduct(product, overlay) {
  const mediaNodes = product?.media?.nodes ?? [];

  // Last media node is reserved for the accordion bottle graphic.
  // Gallery uses the remainder, capped at 3; fewer than 3 just collapses.
  // A single item stays in the gallery (hero must not go empty); accordion omits.
  const galleryPool =
    mediaNodes.length > 1 ? mediaNodes.slice(0, -1) : mediaNodes;
  const strip = galleryPool.slice(0, 3);

  if (strip.length) {
    const slotIds = ['front', 'human', 'lifestyle'];
    return strip.map((node, index) => {
      const slotId = slotIds[index] ?? `media-${index}`;
      if (node?.__typename === 'Video') {
        return {
          id: slotId,
          kind: 'video',
          alt: product.title,
          poster: node.previewImage?.url ?? undefined,
          sources: node.sources ?? [],
        }
      }

      // MediaImage (default)
      return {
        id: slotId,
        kind: 'image',
        src: node?.image?.url ?? undefined,
        alt: node?.image?.altText || product.title,
      }
    })
  }

  // Fallback: overlay gallery (keeps older handles working if Shopify media is absent).
  if (overlay?.gallery?.length) return overlay.gallery;

  return []
}

function metafieldText(metafield) {
  const value = String(metafield?.value ?? '').trim();
  return value || '';
}

function collectRichText(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(collectRichText).join('');
}

function parseProductDetailsRichText(metafield) {
  const raw = metafieldText(metafield);
  if (!raw) return {intro: '', bullets: []};
  try {
    const tree = JSON.parse(raw);
    const introParts = [];
    const bullets = [];
    for (const child of tree.children ?? []) {
      if (child.type === 'paragraph') {
        const text = collectRichText(child).trim();
        if (text) introParts.push(text);
      } else if (child.type === 'list') {
        for (const item of child.children ?? []) {
          const text = collectRichText(item).trim();
          if (text) bullets.push(text);
        }
      }
    }
    return {intro: introParts.join(' '), bullets};
  } catch {
    return {intro: raw, bullets: []};
  }
}

/**
 * custom.how_to_use → PdpHowTo shape (normalised to match the overlay schema
 * so PdpHowTo.jsx requires no changes).
 * media branches on __typename: MediaImage → image/imageAlt string pair,
 * Video → object with sources/poster so the component can render <video>.
 * Returns undefined when the metafield or media is absent.
 */
function howToFromMetafield(product) {
  const mo = product?.howToUse?.reference;
  if (!mo) return undefined;

  const eyebrow = mo.eyebrow?.value?.trim() ?? '';
  const heading = mo.heading?.value?.trim() ?? '';
  const mediaRef = mo.media?.reference;

  if (!mediaRef) return undefined;

  let mediaShape;
  if (mediaRef.__typename === 'Video') {
    mediaShape = {
      image: mediaRef.previewImage?.url ?? '',
      imageAlt: '',
      video: mediaRef.sources ?? [],
    };
  } else {
    // MediaImage (confirmed case for the-dreamer)
    mediaShape = {
      image: mediaRef.image?.url ?? '',
      imageAlt: mediaRef.image?.altText ?? '',
      video: null,
    };
  }

  const steps = (mo.step?.references?.nodes ?? [])
    .map((n) => ({
      title: n?.title?.value?.trim() ?? '',
      body: n?.description?.value?.trim() ?? '',
    }))
    .filter((s) => s.title);

  if (!mediaShape.image || !steps.length) return undefined;

  return {
    eyebrow: eyebrow || 'HOW TO USE',
    title: heading,
    ...mediaShape,
    steps,
  };
}

/**
 * custom.product_ticker (list.metaobject_reference) → PdpMarquee items array.
 * The FT mark SVG is a local asset supplied by the overlay; this function only
 * returns the items string array. Returns undefined when the metafield is absent.
 */
function marqueeItemsFromMetafield(product) {
  const nodes = product?.productTicker?.references?.nodes;
  if (!nodes?.length) return undefined;
  const items = nodes
    .map((n) => n?.feature?.value?.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/**
 * custom.daily_routine (list.metaobject_reference) → PDP benefits cards.
 * Returns undefined when the metafield is absent.
 */
function benefitsFromMetafield(product) {
  const nodes = product?.dailyRoutine?.references?.nodes ?? [];
  if (!nodes?.length) return undefined;

  const cards = nodes
    .map((n) => {
      const position = Number(n?.position?.value ?? 0);
      if (!Number.isFinite(position) || position <= 0) return null;

      const id = String(position).padStart(2, '0');
      const title = n?.title?.value?.trim() ?? '';
      const body = n?.description?.value?.trim() ?? '';
      const image = n?.image?.reference?.image?.url ?? '';

      if (!title || !body || !image) return null;
      return {position, id, title, body, image};
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position)
    .map(({position: _position, ...rest}) => rest);

  if (!cards.length) return undefined;
  return {cards};
}

/**
 * custom.product_lifestyle_banner_content → PdpLifestyle shape.
 * Returns undefined (section omitted) when the metafield or any required
 * field is absent, so other handles cleanly skip the section.
 */
function lifestyleFromMetafield(product) {
  const mo = product?.lifestyleBanner?.reference;
  if (!mo) return undefined;

  const title = mo.title?.value?.trim() ?? '';
  const blurb = mo.description?.value?.trim() ?? '';
  const bannerImg = mo.image?.reference?.image;
  const bottleImg = mo.productShot?.reference?.image;

  // Require at minimum the background banner to show the section
  if (!bannerImg?.url) return undefined;

  return {
    title: title || undefined,
    blurb: blurb || undefined,
    banner: bannerImg.url,
    bottle: bottleImg?.url ?? undefined,
  };
}

/**
 * Product-level `custom` metafields → PDP accordion.
 * Overlay accordion (the-dreamer) wins when present so the Figma tree stays intact.
 */
export function accordionFromMetafields(product) {
  const details = parseProductDetailsRichText(product?.productDetails);
  const whyLove = metafieldText(product?.whyYoullLoveIt);
  const suitableFor = metafieldText(product?.suitableFor);
  const stateOfMind = metafieldText(product?.stateOfMind);
  const fragranceNotes = metafieldText(product?.fragranceNotes);

  const items = [];
  if (details.intro || details.bullets.length) {
    items.push({
      id: 'product-details',
      title: 'Product details',
      defaultOpen: true,
      intro: details.intro || undefined,
      bullets: details.bullets.length ? details.bullets : undefined,
    });
  }
  if (whyLove) {
    items.push({id: 'why-love', title: 'Why You’ll Love It', body: whyLove});
  }
  if (suitableFor) {
    items.push({id: 'suitable-for', title: 'Suitable For', body: suitableFor});
  }
  if (stateOfMind) {
    items.push({id: 'state-of-mind', title: 'State of Mind', body: stateOfMind});
  }
  if (fragranceNotes) {
    items.push({id: 'fragrance', title: 'Fragrance Notes', body: fragranceNotes});
  }
  return items.length ? items : undefined;
}

export function toPdpViewModel(product) {
  const overlay = getPdpBySlug(product.handle);
  const variant = product.selectedOrFirstAvailableVariant;
  const money = variant?.price ?? product.priceRange?.minVariantPrice;
  const shopifySizes = sizesFromProduct(product);
  const sizes = shopifySizes;

  // Build variantBySize for ProductFormPopup (same logic as toListingCard)
  const sizeValueFromOptions = (opts) =>
    (opts ?? []).find((o) => o?.name?.toLowerCase() === 'size')?.value;
  const variantNodes = product?.variants?.nodes ?? [];
  const variantBySize = variantNodes.reduce((acc, v) => {
    const sv = sizeValueFromOptions(v?.selectedOptions);
    if (sv && v?.id) {
      acc[String(sv)] = {
        id: v.id,
        availableForSale: v.availableForSale !== false,
        sizeValue: String(sv),
        priceAmount: moneyAmount(v.price),
        priceCurrency: moneySymbol(v.price?.currencyCode),
      };
    }
    return acc;
  }, {});
  const mediaNodes = product?.media?.nodes ?? [];
  const firstMedia = mediaNodes[0];
  // Accordion bottle: last item only when there is a leftover after the gallery.
  const lastMedia =
    mediaNodes.length > 1 ? mediaNodes[mediaNodes.length - 1] : undefined;

  return {
    id: product.handle,
    slug: product.handle,
    gid: product.id,
    name: product.title,
    focusTitle: overlay?.focusTitle ?? product.title,
    breadcrumb: overlay?.breadcrumb ?? ['Home', 'Shop All', product.title],
    shortDescription: overlay?.shortDescription ?? product.description ?? '',
    price: moneyAmount(money),
    currency: moneySymbol(money?.currencyCode),
    money,
    sizes,
    defaultSize: sizes[0],
    availableForSale: variant?.availableForSale !== false,
    selectedVariant: variant,
    gallery: galleryFromProduct(product, overlay),
    descriptionTitle: overlay?.descriptionTitle ?? 'Description',
    description: overlay?.description ?? product.description ?? '',
    // Wire “small bottle graphic” + “sticky thumbnail” to native product.media.
    // If Shopify has zero media, omit cleanly by returning undefined.
    detailBottle: mediaPreviewUrl(lastMedia),
    stickyThumb: mediaPreviewUrl(firstMedia),
    accordion: overlay?.accordion ?? accordionFromMetafields(product),
    marquee: (() => {
      const shopifyItems = marqueeItemsFromMetafield(product);
      if (shopifyItems) {
        // mark (FT SVG divider) is a local asset — always sourced from overlay
        return {items: shopifyItems, mark: overlay?.marquee?.mark};
      }
      return overlay?.marquee;
    })(),
    lifestyle: lifestyleFromMetafield(product) ?? overlay?.lifestyle,
    stats: overlay?.stats,
    howTo: howToFromMetafield(product) ?? overlay?.howTo,
    benefits: (() => {
      const shopifyBenefits = benefitsFromMetafield(product);

      // Dreamer's benefits heading is intentionally hardcoded from the overlay.
      const title =
        DREAMER_BENEFITS_TITLE ?? overlay?.benefits?.title ?? undefined;
      if (shopifyBenefits?.cards?.length) {
        if (!title) return undefined;
        return {title, cards: shopifyBenefits.cards};
      }

      return overlay?.benefits;
    })(),
    variantGid: variant?.id,
    variantBySize,
    listId: product.id,
  };
}

/** Overlay loader PDP fields with the currently selected (optimistic) variant. */
export function applySelectedVariant(pdp, variant) {
  if (!pdp || !variant) return pdp;
  const sizeValue = variant.selectedOptions?.find(
    (option) => option.name?.toLowerCase() === 'size',
  )?.value;
  const variantImage = variant.image?.url;
  const gallery = pdp.gallery ?? [];
  const first = gallery[0];
  const galleryWithVariant =
    variantImage && first?.kind === 'image' && first.src !== variantImage
      ? [{...first, src: variantImage}, ...gallery.slice(1)]
      : gallery;

  return {
    ...pdp,
    price: moneyAmount(variant.price ?? pdp.money),
    currency: moneySymbol(variant.price?.currencyCode) || pdp.currency,
    money: variant.price ?? pdp.money,
    variantGid: variant.id,
    availableForSale: variant.availableForSale !== false,
    defaultSize: sizeValue ?? pdp.defaultSize,
    stickyThumb: variantImage || pdp.stickyThumb,
    gallery: galleryWithVariant,
    selectedVariant: variant,
  };
}

/**
 * Fetch all products from the "shop-all" Shopify collection, paginating
 * cursor-by-cursor until exhausted. Returns the same flat catalog array
 * that ShopPage expects — identical shape to the previous flat-products fetch.
 *
 * Using collection(handle:"shop-all") instead of products{} means:
 *  - Products are scoped to the admin-curated collection (easy to manage in admin)
 *  - Collection's manual sort order is respected as the "featured" baseline
 *  - Client-side filter/sort/pagination in ShopPage is completely unchanged
 *
 * Category filters (/shop/body, /shop/face) remain client-side for now —
 * no separate "body"/"face" collections have been created in admin yet.
 */
export async function fetchAllShopProducts(storefront, {pageBy = 50, collectionHandle = 'shop-all'} = {}) {
  const items = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const {collection} = await storefront.query(SHOP_CATALOG_QUERY, {
      variables: {handle: collectionHandle, first: pageBy, after},
    });
    const nodes = collection?.products?.nodes ?? [];
    for (const node of nodes) {
      items.push(toListingCard(node, items.length));
    }
    hasNextPage = Boolean(collection?.products?.pageInfo?.hasNextPage);
    after = collection?.products?.pageInfo?.endCursor ?? null;
    if (!after) hasNextPage = false;
    if (items.length > 500) break;
  }

  return items;
}

/**
 * Queries a Shopify Collection's products. Uses the same product fields
 * as the previous flat products{} query — toListingCard shape is unchanged.
 */
export const SHOP_CATALOG_QUERY = `#graphql
  query ShopCatalog(
    $country: CountryCode
    $language: LanguageCode
    $handle: String!
    $first: Int
    $after: String
  ) @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      id
      handle
      title
      products(first: $first, after: $after) {
        nodes {
          id
          handle
          title
          productType
          tags
          featuredImage {
            id
            url
            altText
            width
            height
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          options {
            name
            optionValues {
              name
            }
          }
          variants(first: 20) {
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
          collections(first: 5) {
            nodes {
              handle
              title
            }
          }
          selectedOrFirstAvailableVariant {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export const PRODUCT_SIMILAR_QUERY = `#graphql
  query ProductSimilar(
    $country: CountryCode
    $language: LanguageCode
    $first: Int
  ) @inContext(country: $country, language: $language) {
    products(first: $first) {
      nodes {
        id
        handle
        title
        productType
        tags
        featuredImage {
          id
          url
          altText
          width
          height
        }
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        options {
          name
          optionValues {
            name
          }
        }
        variants(first: 20) {
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
        collections(first: 5) {
          nodes {
            handle
            title
          }
        }
        selectedOrFirstAvailableVariant {
          id
        }
      }
    }
  }
`;
