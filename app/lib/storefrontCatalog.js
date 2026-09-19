import {getPdpBySlug} from '~/data/pdp';
import {getProductById} from '~/data/products';

const FILTER_TAG_RE = /^filter:([^:]+):(.+)$/i;
/** Hardcoded stats chrome (eyebrow/title/footnote) — shared across all products. */
const DREAMER_STATS_CHROME = (() => {
  const stats = getPdpBySlug('the-dreamer')?.stats;
  if (!stats) return null;
  return {
    eyebrow: stats.eyebrow,
    title: stats.title,
    footnote: stats.footnote,
  };
})();

/** Parse filter:{type}:{value} tags into grouped filter facets. */
export function parseFilterTags(product) {
  /** @type {{ category: string[], mood: string[] }} */
  const facets = {category: [], mood: []};

  for (const raw of product?.tags ?? []) {
    const match = String(raw).trim().toLowerCase().match(FILTER_TAG_RE);
    if (!match) continue;

    const type = match[1];
    const value = match[2];
    if (!value || !(type in facets)) continue;
    facets[type].push(value);
  }

  return facets;
}

export function categoryTagsFromProduct(product) {
  return parseFilterTags(product).category;
}

export function moodTagsFromProduct(product) {
  return parseFilterTags(product).mood;
}

export function moneySymbol(currencyCode) {
  if (currencyCode === 'INR') return '₹';
  return currencyCode || '₹';
}

export function moneyAmount(money) {
  return Number(money?.amount ?? 0);
}

/** Cart subtotal at/above this (INR) qualifies for free shipping. */
export const FREE_SHIPPING_THRESHOLD = 300;
export const SHIPPING_FEE_NOTE = '+₹49 Shipping Fee';
export const FREE_SHIPPING_NOTE = 'Free Shipping';

/**
 * Unique merchandising offers from products currently in the cart.
 * Same shape as PDP `activeOffersFromMetafield`.
 */
export function uniqueOffersFromCart(cart) {
  const seen = new Set();
  const offers = [];
  for (const line of cart?.lines?.nodes ?? []) {
    const product = line?.merchandise?.product;
    if (!product) continue;
    for (const offer of activeOffersFromMetafield(product)) {
      const key = offer.code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Shipping copy for a pack swatch. Driven by projected cart value after
 * adding this variant (existing lines of the same product are replaced).
 */
export function packShippingNote(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < FREE_SHIPPING_THRESHOLD
    ? SHIPPING_FEE_NOTE
    : FREE_SHIPPING_NOTE;
}

/** Default pack on listing cards, quick-add, and PDP when the option exists. */
export const PREFERRED_PACK_VALUE = 'Pack of 2';

/**
 * Prefer Pack of 2 on listing cards so price, ATC, and the picker match.
 * Falls back to the first available variant when that pack is missing.
 * @param {Array<{sizeValue?: string, availableForSale?: boolean}>} variants
 */
export function preferredListingVariant(variants) {
  const nodes = variants ?? [];
  const packOf2 = nodes.find((variant) => variant.sizeValue === PREFERRED_PACK_VALUE);
  if (packOf2) return packOf2;
  return nodes.find((variant) => variant.availableForSale) ?? nodes[0] ?? null;
}

/** Variant matching a Pack option label (e.g. "Pack of 1"). */
export function variantForPackLabel(product, packLabel) {
  const nodes = product?.variants?.nodes ?? [];
  if (!packLabel || !nodes.length) return null;
  return (
    nodes.find((variant) =>
      (variant.selectedOptions ?? []).some((option) => {
        if (option?.value !== packLabel) return false;
        const name = option?.name ?? '';
        const value = option?.value ?? '';
        return /pack/i.test(name) || /pack of\s*\d+/i.test(value);
      }),
    ) ?? null
  );
}

/**
 * Cart subtotal if this product's current lines were swapped for
 * `quantity` of `variantPrice`. Empty cart falls through to the variant total.
 */
export function projectedCartAmountForVariant({
  cart,
  productId,
  variantPrice,
  quantity = 1,
}) {
  const qty = Math.max(1, Number(quantity) || 1);
  const variantTotal = moneyAmount(variantPrice) * qty;
  const subtotal = moneyAmount(cart?.cost?.subtotalAmount);
  if (!cart || subtotal <= 0) return variantTotal;

  const existing = (cart?.lines?.nodes ?? []).reduce((sum, line) => {
    if (line?.merchandise?.product?.id !== productId) return sum;
    return sum + moneyAmount(line?.cost?.totalAmount);
  }, 0);

  return Math.max(0, subtotal - existing) + variantTotal;
}

export function formatMoneyDisplay(money) {
  const amount = moneyAmount(money);
  return `${moneySymbol(money?.currencyCode)}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Percent off from Shopify compare-at vs current price. Null when inapplicable. */
export function percentOffFromCompare(price, compareAtPrice) {
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

function moneyTimes(money, quantity) {
  if (!money) return null;
  const qty = Math.max(1, Number(quantity) || 1);
  return {
    amount: String(moneyAmount(money) * qty),
    currencyCode: money.currencyCode,
  };
}

/** Line payable, compare-at total (qty × unit compare), and percent off. */
export function cartLinePricing(line) {
  const qty = Math.max(1, Number(line?.quantity) || 1);
  const payable = line?.cost?.totalAmount ?? line?.merchandise?.price ?? null;
  const perCompare =
    line?.cost?.compareAtAmountPerQuantity ??
    line?.merchandise?.compareAtPrice ??
    null;
  const compareTotal = moneyTimes(perCompare, qty);
  const percentOff = percentOffFromCompare(payable, compareTotal);
  const showCompare =
    Boolean(compareTotal) && moneyAmount(compareTotal) > moneyAmount(payable);
  return {
    payable,
    compareTotal: showCompare ? compareTotal : null,
    percentOff,
  };
}

/**
 * Cart payable subtotal plus the pre-discount total (sum of line compare-at
 * amounts, falling back to line payable when a line has no compare price).
 */
export function cartCompareSubtotal(cart) {
  const payable = cart?.cost?.subtotalAmount ?? null;
  let compareSum = 0;
  let currency = payable?.currencyCode;
  for (const line of cart?.lines?.nodes ?? []) {
    const {payable: linePayable, compareTotal} = cartLinePricing(line);
    if (compareTotal) {
      compareSum += moneyAmount(compareTotal);
      currency = compareTotal.currencyCode || currency;
    } else {
      compareSum += moneyAmount(linePayable);
      currency = linePayable?.currencyCode || currency;
    }
  }
  const payableAmount = moneyAmount(payable);
  const compare =
    compareSum > payableAmount
      ? {amount: String(compareSum), currencyCode: currency}
      : null;
  return {
    payable,
    compare,
    count: cart?.totalQuantity ?? 0,
  };
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
 * Pack-of-1 (base) variant for gift-bundle ATC — independent of PDP pack selection.
 * @param {{variants?: {nodes?: Array<{
 *   id?: string,
 *   title?: string | null,
 *   availableForSale?: boolean,
 *   price?: {amount?: string, currencyCode?: string} | null,
 *   compareAtPrice?: {amount?: string, currencyCode?: string} | null,
 *   selectedOptions?: Array<{name?: string | null, value?: string | null}> | null,
 *   image?: unknown,
 * }>}}} product
 */
export function basePackVariantFromProduct(product) {
  const nodes = product?.variants?.nodes ?? [];
  if (!nodes.length) return null;

  const isPackOf1 = (variant) => {
    const title = String(variant?.title ?? '');
    if (/pack\s*of\s*1/i.test(title)) return true;
    return (variant?.selectedOptions ?? []).some((option) =>
      /pack\s*of\s*1/i.test(String(option?.value ?? '')),
    );
  };

  return (
    nodes.find(isPackOf1) ??
    nodes.find((variant) => variant.availableForSale !== false) ??
    nodes[0] ??
    null
  );
}

/** Parse list.number_decimal / JSON list metafield values into [x, y] percentages. */
function parseXyPercent(raw) {
  if (raw == null) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  const x = Number(parsed[0]);
  const y = Number(parsed[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {x, y};
}

function mediaImageFromReference(field) {
  const image = field?.reference?.image;
  if (!image?.url) return null;
  return {
    url: image.url,
    altText: image.altText ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}

/**
 * `custom.product_bundle` → gift section view model.
 * Returns null when metafield / banner / hotspots are absent (omit section).
 *
 * @param {{
 *   productBundle?: {
 *     reference?: {
 *       sectionTitle?: {value?: string | null} | null,
 *       sectionDescription?: {value?: string | null} | null,
 *       desktopBanner?: {reference?: {image?: unknown}} | null,
 *       mobileBanner?: {reference?: {image?: unknown}} | null,
 *       bundleHotspot?: {references?: {nodes?: unknown[]}} | null,
 *     } | null,
 *   } | null,
 * }} product
 */
export function giftBundleFromMetafield(product) {
  const meta = product?.productBundle?.reference;
  if (!meta) return null;

  const desktopBanner = mediaImageFromReference(meta.desktopBanner);
  const mobileBanner =
    mediaImageFromReference(meta.mobileBanner) ?? desktopBanner;
  if (!desktopBanner) return null;

  const titleRaw = String(meta.sectionTitle?.value ?? '').trim();
  const description = String(meta.sectionDescription?.value ?? '').trim();

  /** @type {string[]} */
  let titleLines = [];
  if (titleRaw.includes('\n')) {
    titleLines = titleRaw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  } else {
    const ofBreak = titleRaw.search(/\s+OF\s+/i);
    if (ofBreak > 0) {
      titleLines = [
        titleRaw.slice(0, ofBreak).trim(),
        titleRaw.slice(ofBreak + 1).trim(),
      ];
    } else if (titleRaw) {
      titleLines = [titleRaw];
    }
  }
  if (!titleLines.length) return null;

  const hotspotNodes = meta.bundleHotspot?.references?.nodes ?? [];
  const hotspots = [];
  for (const node of hotspotNodes) {
    if (!node || typeof node !== 'object') continue;
    const referenced = node.product?.reference;
    if (!referenced?.id) continue;
    const variant = basePackVariantFromProduct(referenced);
    if (!variant?.id) continue;

    const desktopXy = parseXyPercent(node.desktopXy?.value);
    const mobileXy = parseXyPercent(node.mobileXy?.value) ?? desktopXy;
    if (!desktopXy) continue;

    hotspots.push({
      id: node.id || referenced.id,
      productId: referenced.id,
      handle: referenced.handle || '',
      title: referenced.title || referenced.handle || 'Product',
      desktopXy,
      mobileXy,
      variantId: variant.id,
      price: variant.price ?? null,
      compareAtPrice: variant.compareAtPrice ?? null,
      availableForSale: variant.availableForSale !== false,
      selectedVariant: variant,
    });
  }

  if (!hotspots.length) return null;

  return {
    titleLines,
    description,
    desktopBanner,
    mobileBanner,
    hotspots,
  };
}

/**
 * Shopify's auto "Title / Default Title" option on single-variant products.
 * Ignored for shopper-facing size UI, cart labels, and product URL sync.
 * @param {{name?: string | null, value?: string | null} | null | undefined} option
 */
export function isShopifyDefaultTitleOption(option) {
  return option?.name === 'Title' && option?.value === 'Default Title';
}

/**
 * Drop the ghost Title/Default Title option; keep real options (e.g. Size).
 * @template {{name?: string | null, value?: string | null}} T
 * @param {T[] | null | undefined} selectedOptions
 * @returns {T[]}
 */
export function withoutShopifyDefaultTitleOptions(selectedOptions) {
  return (selectedOptions ?? []).filter(
    (option) => !isShopifyDefaultTitleOption(option),
  );
}

/**
 * Shopify option used for the shopper-facing variant picker (Size or Pack).
 * Prefers Size; falls back to Pack. Ignores Title/Default Title.
 * @returns {{name: string, values: string[]} | null}
 */
export function variantPickerOptionFromProduct(product) {
  const options = product?.options ?? [];
  const byName = (pred) => options.find((option) => pred(option.name ?? ''));
  const option =
    byName((name) => name.toLowerCase() === 'size') ||
    byName((name) => name.toLowerCase().includes('pack'));
  if (!option) return null;

  const values = (option.optionValues ?? [])
    .map((value) => value.name)
    .filter(Boolean)
    .filter(
      (name) =>
        !isShopifyDefaultTitleOption({name: option.name, value: name}),
    );
  if (values.length <= 1) return null;
  return {name: option.name, values};
}

/**
 * Real shopper-facing Size/Pack values. Shopify's auto "Title / Default Title"
 * option (products without configured variants) is ignored.
 */
export function sizesFromProduct(product) {
  return variantPickerOptionFromProduct(product)?.values ?? [];
}

/** Label for the listing/quick-add select (e.g. "Size", "Pack"). */
export function variantPickerLabelFromProduct(product) {
  return variantPickerOptionFromProduct(product)?.name ?? 'Size';
}

/**
 * Size or Pack value on a variant's selectedOptions.
 * @param {Array<{name?: string | null, value?: string | null}> | null | undefined} selectedOptions
 */
export function variantPickerValueFromSelectedOptions(selectedOptions) {
  const opts = selectedOptions ?? [];
  return (
    opts.find((option) => option?.name?.toLowerCase() === 'size')?.value ??
    opts.find((option) =>
      (option?.name?.toLowerCase() ?? '').includes('pack'),
    )?.value
  );
}

/** Show size UI only when sizesFromProduct returned 2+ real Size values. */
export function shouldShowSizeSelect(sizes) {
  return (sizes ?? []).length > 1;
}

export function toListingCard(product, featuredOrder = 0) {
  const money = product?.priceRange?.minVariantPrice;
  const sizes = sizesFromProduct(product);
  const variantOptionLabel = variantPickerLabelFromProduct(product);

  const variantNodes = product?.variants?.nodes ?? [];
  const variants = variantNodes
    .map((v) => {
      const sizeValue = variantPickerValueFromSelectedOptions(v?.selectedOptions);
      return {
        id: v?.id,
        availableForSale: v?.availableForSale !== false,
        sizeValue: sizeValue ? String(sizeValue) : undefined,
        priceAmount: moneyAmount(v?.price),
        priceCurrency: moneySymbol(v?.price?.currencyCode),
        currencyCode: v?.price?.currencyCode,
      };
    })
    .filter((v) => Boolean(v?.id));

  const variantBySize = variants
    .filter((v) => v.sizeValue)
    .reduce((acc, v) => {
      acc[v.sizeValue] = v;
      return acc;
    }, {});

  const defaultVariant = preferredListingVariant(variants);
  const defaultSize = defaultVariant?.sizeValue ?? sizes[0];

  // Fallback: when variants aren't present (legacy queries), use the current
  // static default variant id + min price.
  const variantGid = defaultVariant?.id ?? product.selectedOrFirstAvailableVariant?.id;
  const currency = defaultVariant?.priceCurrency ?? moneySymbol(money?.currencyCode);
  const price = defaultVariant?.priceAmount ?? moneyAmount(money);
  const listingMoney = defaultVariant
    ? {
        amount: String(defaultVariant.priceAmount),
        currencyCode: defaultVariant.currencyCode || money?.currencyCode,
      }
    : money;
  return {
    id: product.id,
    handle: product.handle,
    listId: product.id,
    name: product.title,
    price,
    currency,
    money: listingMoney,
    image: product.featuredImage?.url,
    href: `/products/${product.handle}`,
    sizes,
    defaultSize,
    variantOptionLabel,
    categories: categoryTagsFromProduct(product),
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
 * custom.how_to_use → PdpHowTo shape (normalised to match the overlay schema).
 * media branches on __typename: MediaImage → image/imageAlt string pair,
 * Video → object with sources/poster so the component can render <video>.
 * Each step may include an optional icon URL from file_reference (per-step).
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
    .map((n) => {
      const title = n?.title?.value?.trim() ?? '';
      const body = n?.description?.value?.trim() ?? '';
      const icon = n?.icon?.reference?.image?.url?.trim() || undefined;
      return {title, body, icon};
    })
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
 * custom.product_offers (list.metaobject_reference) → PDP offer cards.
 *
 * Visibility gate: Storefront only returns ACTIVE/published entries for
 * publishable metaobject types. Confirmed against Admin schema — status is
 * NOT a top-level Metaobject field; it lives at
 * `capabilities.publishable.status` with enum values `ACTIVE` | `DRAFT`
 * (Admin API). Storefront Metaobject has no `status` field, so we treat
 * presence in `references.nodes` as the ACTIVE gate (Draft → omitted by
 * Shopify, no Admin discount lookup). Empty list → omit Offers section.
 *
 * @param {{
 *   productOffers?: {
 *     references?: {
 *       nodes?: Array<{
 *         id?: string,
 *         couponCode?: {value?: string | null} | null,
 *         name?: {value?: string | null} | null,
 *         description?: {value?: string | null} | null,
 *       } | null> | null,
 *     } | null,
 *   } | null,
 * }} product
 * @returns {Array<{
 *   id: string,
 *   code: string,
 *   title: string,
 *   headline: string,
 *   benefit: string,
 *   detail: string,
 *   variant: 'solid' | 'dashed',
 * }>}
 */
export function activeOffersFromMetafield(product) {
  const nodes = product?.productOffers?.references?.nodes ?? [];
  /** @type {Array<{
   *   id: string,
   *   code: string,
   *   title: string,
   *   headline: string,
   *   benefit: string,
   *   detail: string,
   *   variant: 'solid' | 'dashed',
   * }>} */
  const offers = [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    // INTENTIONAL: coupon_code is merchandising content only — it is NOT
    // validated against Shopify Discounts (codeDiscountNodeByCode). A typo,
    // expired, or never-created code still renders a normal card. Whoever
    // manages product_offers must keep coupon_code in sync with Discounts.
    const code = String(node.couponCode?.value ?? '').trim();
    const name = String(node.name?.value ?? '').trim();
    const description = String(node.description?.value ?? '').trim();
    if (!code || !name) continue;

    offers.push({
      id: node.id || code,
      code,
      title: name,
      headline: name,
      benefit: '',
      detail: description,
      variant: offers.length % 2 === 0 ? 'solid' : 'dashed',
    });
  }

  return offers;
}

/**
 * custom.product_icons (list.metaobject_reference) → hero chip row.
 * Metaobject `product_icons`: file `icon` + text `title`.
 * Returns [] when the metafield is absent.
 */
export function productIconsFromMetafield(product) {
  const nodes = product?.productIcons?.references?.nodes ?? [];
  return nodes
    .map((node, index) => {
      const label = node?.title?.value?.trim() ?? '';
      const iconUrl = node?.icon?.reference?.image?.url ?? '';
      if (!label || !iconUrl) return null;
      return {
        id: `${label}-${index}`,
        label,
        iconUrl,
        iconAlt: node?.icon?.reference?.image?.altText || label,
      };
    })
    .filter(Boolean);
}

/**
 * custom.product_icons_left (list.metaobject_reference) → Product Details 2×2 grid.
 * Metaobject `product_icons_product_details`: file `icon`, text `title`,
 * and body copy on `description` or Shopify's `descrption` key.
 * Returns [] when the metafield is absent.
 */
export function productIconsLeftFromMetafield(product) {
  const nodes = product?.productIconsLeft?.references?.nodes ?? [];
  return nodes
    .map((node, index) => {
      const label = node?.title?.value?.trim() ?? '';
      const description =
        node?.description?.value?.trim() ||
        node?.descrption?.value?.trim() ||
        '';
      const iconUrl = node?.icon?.reference?.image?.url ?? '';
      if (!label || !iconUrl) return null;
      return {
        id: `${label}-${index}`,
        label,
        description,
        iconUrl,
        iconAlt: node?.icon?.reference?.image?.altText || label,
      };
    })
    .filter(Boolean);
}

/**
 * custom.product_ticker (list.metaobject_reference) → PdpMarquee items array.
 * Pill copy only — the FT divider mark is a static asset in PdpMarquee.
 * Returns undefined when the metafield is absent.
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
 * custom.formulation (list.metaobject_reference) → PdpStats cards.
 * Eyebrow/title/footnote stay hardcoded (DREAMER_STATS_CHROME); only cards
 * come from Shopify. Returns undefined when the metafield is absent.
 */
function statsFromMetafield(product) {
  const nodes = product?.formulation?.references?.nodes ?? [];
  if (!nodes.length || !DREAMER_STATS_CHROME) return undefined;

  const cards = nodes
    .map((n) => {
      const value = n?.title?.value?.trim() ?? '';
      const text = n?.description?.value?.trim() ?? '';
      if (!value || !text) return null;
      return {value, text};
    })
    .filter(Boolean);

  if (!cards.length) return undefined;
  return {...DREAMER_STATS_CHROME, cards};
}

/**
 * Parse a lifestyle banner file_reference (Video | MediaImage) into banner + video.
 * @returns {{ banner: string, video: Array | null } | undefined}
 */
function parseLifestyleMediaReference(mediaRef) {
  if (!mediaRef) return undefined;

  if (mediaRef.__typename === 'Video') {
    const sources = mediaRef.sources ?? [];
    if (!sources.length) return undefined;
    return {
      banner: mediaRef.previewImage?.url ?? '',
      video: sources,
    };
  }

  const bannerImg = mediaRef.image;
  if (!bannerImg?.url) return undefined;

  return {
    banner: bannerImg.url,
    video: null,
  };
}

/**
 * custom.product_lifestyle_banner_content → PdpLifestyle shape.
 * Prefer background_media; fall back to legacy image. Video → sources + poster
 * (bottle overlay skipped at render). MediaImage → banner + product_shot bottle.
 * mobile_media is mapped separately; PdpLifestyle falls back to background_media
 * on mobile when mobile_media is absent.
 * Returns undefined when the metafield or background media is absent.
 */
function lifestyleFromMetafield(product) {
  const mo = product?.lifestyleBanner?.reference;
  if (!mo) return undefined;

  const title = mo.title?.value?.trim() ?? '';
  const blurb = mo.description?.value?.trim() ?? '';
  const desktop = parseLifestyleMediaReference(
    mo.backgroundMedia?.reference ?? mo.image?.reference ?? null,
  );
  const mobile = parseLifestyleMediaReference(mo.mobileMedia?.reference ?? null);
  const bottleImg = mo.productShot?.reference?.image;

  if (!desktop) return undefined;

  return {
    title: title || undefined,
    blurb: blurb || undefined,
    banner: desktop.banner,
    bottle: bottleImg?.url ?? undefined,
    video: desktop.video,
    mobileBanner: mobile?.banner,
    mobileVideo: mobile?.video ?? null,
  };
}

/**
 * Product-level `custom` metafields → PDP accordion.
 * Each item is Shopify-first; overlay fills that slot only when its metafield
 * is empty. Overlay is never an all-or-nothing replacement for the whole list.
 */
export function accordionFromMetafields(product, overlayItems) {
  const overlayById = new Map(
    (overlayItems ?? []).filter((item) => item?.id).map((item) => [item.id, item]),
  );

  const shopifyDetails = parseProductDetailsRichText(product?.productDetails);
  const shopifyIngredients = metafieldText(product?.allIngredients);
  const shopifyWhyLove = metafieldText(product?.whyYoullLoveIt);
  const shopifyBenefits = parseProductDetailsRichText(product?.allBenefits);
  const shopifyHowToUse =
    product?.howToUse?.type === 'rich_text_field'
      ? parseProductDetailsRichText(product.howToUse)
      : {intro: '', bullets: []};
  const shopifySuitable = metafieldText(product?.suitableFor);

  const items = [];

  const details = pickRichAccordionItem({
    shopify: shopifyDetails,
    overlay: overlayById.get('product-details'),
    defaults: {
      id: 'product-details',
      title: 'Product details',
      defaultOpen: true,
    },
  });
  if (details) items.push(details);

  const benefits = pickRichAccordionItem({
    shopify: shopifyBenefits,
    overlay: overlayById.get('all-benefits'),
    defaults: {id: 'all-benefits', title: 'All Benefits'},
  });
  if (benefits) items.push(benefits);

  const whyLove = pickBodyAccordionItem({
    shopify: shopifyWhyLove,
    overlay: overlayById.get('why-love'),
    defaults: {id: 'why-love', title: 'Why You’ll Love It'},
  });
  if (whyLove) items.push(whyLove);

  const howToUse = pickRichAccordionItem({
    shopify: shopifyHowToUse,
    overlay: overlayById.get('how-to-use'),
    defaults: {id: 'how-to-use', title: 'How to use'},
  });
  if (howToUse) items.push(howToUse);

  const ingredients = pickBodyAccordionItem({
    shopify: shopifyIngredients,
    overlay: overlayById.get('all-ingredients'),
    defaults: {id: 'all-ingredients', title: 'All Ingredients'},
  });
  if (ingredients) items.push(ingredients);

  const suitable = pickBodyAccordionItem({
    shopify: shopifySuitable,
    overlay: overlayById.get('suitable-for'),
    defaults: {id: 'suitable-for', title: 'Suitable For'},
  });
  if (suitable) items.push(suitable);

  return items.length ? items : undefined;
}

function hasRichAccordionContent(parsed) {
  return Boolean(parsed?.intro || parsed?.bullets?.length);
}

/** Shopify rich-text item, else overlay {intro, bullets, body} for the same id. */
function pickRichAccordionItem({shopify, overlay, defaults}) {
  if (hasRichAccordionContent(shopify)) {
    return {
      ...defaults,
      intro: shopify.intro || undefined,
      bullets: shopify.bullets.length ? shopify.bullets : undefined,
    };
  }
  if (!overlay) return undefined;
  if (!(overlay.intro || overlay.body || overlay.bullets?.length)) return undefined;
  return {
    ...defaults,
    title: overlay.title ?? defaults.title,
    intro: overlay.intro || undefined,
    body: overlay.body,
    bullets: overlay.bullets?.length ? overlay.bullets : undefined,
    defaultOpen: overlay.defaultOpen ?? defaults.defaultOpen,
  };
}

/** Shopify multi-line / plain body, else overlay.body for the same id. */
function pickBodyAccordionItem({shopify, overlay, defaults}) {
  if (shopify) {
    return {...defaults, body: shopify};
  }
  if (!overlay?.body) return undefined;
  return {
    ...defaults,
    title: overlay.title ?? defaults.title,
    body: overlay.body,
  };
}

export function toPdpViewModel(product) {
  const overlay = getPdpBySlug(product.handle);
  const variant = product.selectedOrFirstAvailableVariant;
  const money = variant?.price ?? product.priceRange?.minVariantPrice;
  const shopifySizes = sizesFromProduct(product);
  const sizes = shopifySizes;
  const variantOptionLabel = variantPickerLabelFromProduct(product);

  // Build variantBySize for ProductFormPopup (same logic as toListingCard)
  const variantNodes = product?.variants?.nodes ?? [];
  const variantBySize = variantNodes.reduce((acc, v) => {
    const sv = variantPickerValueFromSelectedOptions(v?.selectedOptions);
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

  const shelfProduct = getProductById(product.handle);
  return {
    id: product.handle,
    slug: product.handle,
    gid: product.id,
    name: product.title,
    // Short archetype label for non-PDP surfaces (shelf overlays). PDP hero
    // uses `name` (Shopify title) only.
    focusTitle:
      overlay?.focusTitle ?? shelfProduct?.focusTitle ?? product.title,
    breadcrumb: overlay?.breadcrumb ?? ['Home', 'Shop All', product.title],
    // Shopify primary; overlay only when metafield/native field is empty.
    shortDescription:
      metafieldText(product?.shortDescription) ||
      overlay?.shortDescription ||
      '',
    chips: productIconsFromMetafield(product),
    detailFeatures: productIconsLeftFromMetafield(product),
    price: moneyAmount(money),
    currency: moneySymbol(money?.currencyCode),
    money,
    sizes,
    defaultSize: sizes[0],
    variantOptionLabel,
    availableForSale: variant?.availableForSale !== false,
    selectedVariant: variant,
    gallery: galleryFromProduct(product, overlay),
    descriptionTitle: overlay?.descriptionTitle ?? 'Description',
    description:
      String(product?.description ?? '').trim() ||
      overlay?.description ||
      '',
    // Wire “small bottle graphic” + “sticky thumbnail” to native product.media.
    // If Shopify has zero media, omit cleanly by returning undefined.
    detailBottle: mediaPreviewUrl(lastMedia),
    stickyThumb: mediaPreviewUrl(firstMedia),
    accordion: accordionFromMetafields(product, overlay?.accordion),
    marquee: (() => {
      // Flux Figma ticker copy (Detan / Odour defence / …) lives on the overlay.
      // Prefer it over shop metafield when present so PDP matches design.
      const overlayItems = overlay?.marquee?.items;
      if (overlayItems?.length) return {items: overlayItems};
      const shopifyItems = marqueeItemsFromMetafield(product);
      if (shopifyItems) return {items: shopifyItems};
      return undefined;
    })(),
    lifestyle: lifestyleFromMetafield(product) ?? overlay?.lifestyle,
    stats: statsFromMetafield(product) ?? overlay?.stats,
    howTo: howToFromMetafield(product) ?? overlay?.howTo,
    variantGid: variant?.id,
    variantBySize,
    listId: product.id,
  };
}

/** Overlay loader PDP fields with the currently selected (optimistic) variant. */
export function applySelectedVariant(pdp, variant) {
  if (!pdp || !variant) return pdp;
  const sizeValue =
    variant.selectedOptions?.find((option) => {
      const name = option.name?.toLowerCase() ?? '';
      return name === 'size' || name.includes('pack');
    })?.value ??
    variant.selectedOptions?.find((option) =>
      /pack of\s*\d+/i.test(option.value ?? ''),
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

/**
 * The 5 homepage persona cards (ProductV3, "Who Do You Want To Be Today?")
 * — these ids are real Shopify product handles (verified against the store:
 * the-sport/the-lover/the-sage/the-rebel/the-dreamer all exist), in the
 * left-to-right order Figma node 2810-2496 shows.
 */
export const HOME_CARD_HANDLES = [
  'the-sport',
  'the-lover',
  'the-sage',
  'the-rebel',
  'the-dreamer',
];

export const HOME_PRODUCT_CARD_QUERY = `#graphql
  query HomeProductCard(
    $country: CountryCode
    $language: LanguageCode
    $handle: String!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
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
      shortDescription: metafield(namespace: "custom", key: "short_description") {
        value
      }
      selectedOrFirstAvailableVariant {
        id
      }
    }
  }
`;

/**
 * Fetches the 5 ProductV3 cards by handle, in `handles` order — same
 * toListingCard() view-model the PLP grid (ProductCard/ProductFormPopup)
 * consumes, so price/variant/add-to-cart logic stays identical, plus the
 * short_description metafield ProductV3Card shows under the title.
 */
export async function fetchHomeProductCards(storefront, handles = HOME_CARD_HANDLES) {
  const results = await Promise.all(
    handles.map((handle) =>
      storefront.query(HOME_PRODUCT_CARD_QUERY, {variables: {handle}}),
    ),
  );
  return results.map(({product}, index) => {
    if (!product) return null;
    return {
      ...toListingCard(product, index),
      shortDescription: product.shortDescription?.value ?? '',
    };
  });
}

export const CART_UPSELL_QUERY = `#graphql
  query CartUpsell(
    $country: CountryCode
    $language: LanguageCode
    $productId: ID!
  ) @inContext(country: $country, language: $language) {
    related: productRecommendations(productId: $productId) {
      ...CartUpsellProduct
    }
  }
  fragment CartUpsellProduct on Product {
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
    selectedOrFirstAvailableVariant {
      id
    }
  }
`;

export async function fetchCartUpsellProducts(storefront, cart, limit = 6) {
  const inCart = new Set();
  let seedId = null;
  for (const line of cart?.lines?.nodes ?? []) {
    const id = line?.merchandise?.product?.id;
    if (!id) continue;
    inCart.add(id);
    if (!seedId) seedId = id;
  }

  const recs = [];
  if (seedId) {
    try {
      const data = await storefront.query(CART_UPSELL_QUERY, {
        variables: {productId: seedId},
      });
      recs.push(...(data?.related ?? []));
    } catch {
      // Recommendations can 404 on unpublished seeds — fall through to catalog.
    }
  }

  if (recs.length < limit) {
    const {products} = await storefront.query(PRODUCT_SIMILAR_QUERY, {
      variables: {first: 12},
    });
    recs.push(...(products?.nodes ?? []));
  }

  const seen = new Set();
  const cards = [];
  for (const product of recs) {
    if (!product?.id || inCart.has(product.id) || seen.has(product.id)) continue;
    seen.add(product.id);
    cards.push(toListingCard(product));
    if (cards.length >= limit) break;
  }
  return cards;
}

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

function imageFromFileNode(node) {
  if (!node) return null;
  const image = node.image ?? node.previewImage;
  const url = image?.url || node.url;
  if (!url) return null;
  return {
    url,
    altText: image?.altText || node.alt || '',
    width: image?.width ?? null,
    height: image?.height ?? null,
  };
}

/**
 * `custom.main_banner` on a collection — list of files.
 * First image = desktop, second = mobile (falls back to desktop if missing).
 */
export function parseCollectionMainBanner(metafield) {
  const nodes = metafield?.references?.nodes?.length
    ? metafield.references.nodes
    : metafield?.reference
      ? [metafield.reference]
      : [];
  const images = nodes.map(imageFromFileNode).filter(Boolean);
  if (!images.length) return null;
  return {
    desktop: images[0],
    mobile: images[1] ?? images[0],
  };
}

export const COLLECTION_MAIN_BANNER_QUERY = `#graphql
  query CollectionMainBanner(
    $country: CountryCode
    $language: LanguageCode
    $handle: String!
  ) @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      mainBanner: metafield(namespace: "custom", key: "main_banner") {
        reference {
          ... on MediaImage {
            image {
              url
              altText
              width
              height
            }
          }
          ... on GenericFile {
            url
            alt
          }
          ... on Video {
            previewImage {
              url
              altText
              width
              height
            }
          }
        }
        references(first: 4) {
          nodes {
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
            ... on GenericFile {
              url
              alt
            }
            ... on Video {
              previewImage {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchCollectionMainBanner(
  storefront,
  handle = 'shop-all',
) {
  const {collection} = await storefront.query(COLLECTION_MAIN_BANNER_QUERY, {
    variables: {handle},
  });
  return parseCollectionMainBanner(collection?.mainBanner);
}
