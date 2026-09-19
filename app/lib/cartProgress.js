import {formatMoneyDisplay} from '~/lib/storefrontCatalog';

/**
 * Shop metafield `custom.cart_progress_tiers` → list of `cart_tier` metaobjects.
 *
 * Storefront access: confirmed PUBLIC_READ on the shop metafield definition.
 * Metaobject field keys follow Shopify's name→handle mapping (Label → label).
 */
export const CART_PROGRESS_TIERS_QUERY = `#graphql
  query CartProgressTiers(
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    shop {
      cartProgressTiers: metafield(namespace: "custom", key: "cart_progress_tiers") {
        references(first: 20) {
          nodes {
            ... on Metaobject {
              id
              fields {
                key
                value
                reference {
                  ... on Product {
                    id
                    handle
                    title
                    featuredImage {
                      url
                      altText
                      width
                      height
                    }
                  }
                }
              }
              label: field(key: "label") { value }
              thresholdType: field(key: "threshold_type") { value }
              thresholdValue: field(key: "threshold_value") { value }
              rewardText: field(key: "reward_text") { value }
              rewardProduct: field(key: "reward_product") {
                reference {
                  ... on Product {
                    id
                    handle
                    title
                    featuredImage {
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
      }
    }
  }
`;

function fieldsMap(node) {
  /** @type {Record<string, {value?: string | null, reference?: unknown}>} */
  const map = {};
  for (const field of node?.fields ?? []) {
    if (!field?.key) continue;
    map[field.key] = field;
  }
  return map;
}

function fieldValue(node, aliasedKey, fieldKey) {
  const aliased = String(node?.[aliasedKey]?.value ?? '').trim();
  if (aliased) return aliased;
  const fromFields = String(fieldsMap(node)[fieldKey]?.value ?? '').trim();
  return fromFields;
}

/**
 * Shopify single-choice values may be authored as "Quantity" / "Price"
 * (display) or QUANTITY / PRICE (handle). Anything else is invalid.
 * @param {string} raw
 * @returns {'QUANTITY' | 'PRICE' | ''}
 */
export function normalizeThresholdType(raw) {
  const compact = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (compact === 'QUANTITY' || compact === 'QTY' || compact === 'ITEMS' || compact === 'ITEM') {
    return 'QUANTITY';
  }
  if (compact === 'PRICE' || compact === 'AMOUNT' || compact === 'SUBTOTAL' || compact === 'VALUE') {
    return 'PRICE';
  }
  return '';
}

function parseRewardProduct(field) {
  const product = field?.reference;
  if (!product?.id && !product?.handle) return null;
  return {
    id: product.id ?? product.handle,
    handle: product.handle ?? '',
    title: product.title ?? '',
    imageUrl: product.featuredImage?.url ?? '',
    imageAlt: product.featuredImage?.altText || product.title || '',
  };
}

/**
 * Validate + sort cart_tier entries. Mixed threshold types log and drop
 * mismatches rather than producing a broken bar. Empty/null → [].
 *
 * @param {{
 *   references?: {nodes?: Array<Record<string, unknown> | null> | null} | null,
 *   reference?: Record<string, unknown> | null,
 * } | null | undefined} metafield
 */
export function parseCartProgressTiers(metafield) {
  const nodes = metafield?.references?.nodes?.length
    ? metafield.references.nodes
    : metafield?.reference
      ? [metafield.reference]
      : [];

  const parsed = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const fields = fieldsMap(node);
    const label = fieldValue(node, 'label', 'label');
    const thresholdType = normalizeThresholdType(
      fieldValue(node, 'thresholdType', 'threshold_type'),
    );
    const thresholdValue = Number(
      node.thresholdValue?.value ?? fields.threshold_value?.value,
    );
    if (!label || !thresholdType || !Number.isFinite(thresholdValue)) continue;

    parsed.push({
      id: node.id || `${label}-${thresholdValue}`,
      label,
      thresholdType,
      thresholdValue,
      rewardText: fieldValue(node, 'rewardText', 'reward_text'),
      rewardProduct:
        parseRewardProduct(node.rewardProduct) ||
        parseRewardProduct(fields.reward_product),
    });
  }

  if (!parsed.length) {
    if (nodes.length) {
      console.error(
        '[cart-progress] custom.cart_progress_tiers has entries but none had a valid label, threshold type (Quantity|Price), and threshold value.',
      );
    }
    return [];
  }

  parsed.sort((a, b) => a.thresholdValue - b.thresholdValue);

  const expectedType = parsed[0].thresholdType;
  const mismatched = parsed.filter((tier) => tier.thresholdType !== expectedType);
  if (mismatched.length) {
    console.error(
      '[cart-progress] Mixed threshold types on cart_tier entries. Using the first entry type and dropping mismatches.',
      {
        keptType: expectedType,
        dropped: mismatched.map((tier) => ({
          id: tier.id,
          label: tier.label,
          thresholdType: tier.thresholdType,
          thresholdValue: tier.thresholdValue,
        })),
      },
    );
  }

  return parsed.filter((tier) => tier.thresholdType === expectedType);
}

/**
 * @param {unknown} cart Hydrogen cart (optimistic-safe)
 * @param {Array<{thresholdType: string, thresholdValue: number}>} tiers
 */
export function calculateCartProgress(cart, tiers) {
  if (!tiers?.length) return null;

  const thresholdType = tiers[0].thresholdType;
  const cartValue =
    thresholdType === 'QUANTITY'
      ? Number(cart?.totalQuantity ?? 0) || 0
      : parseFloat(cart?.cost?.subtotalAmount?.amount ?? '0') || 0;

  const nextTier = tiers.find((tier) => cartValue < tier.thresholdValue) ?? null;
  const currentTierIndex = nextTier ? tiers.indexOf(nextTier) : tiers.length;
  const lastThreshold = tiers[tiers.length - 1].thresholdValue;
  // Fill uses the same scale as marker positions (`threshold / lastThreshold`).
  // A next-tier-relative percent would overshoot earlier markers on a
  // multi-tier track (e.g. 50% of the way to ₹300 sitting past the ₹300 tick
  // on a bar that also has ₹999).
  const progressPercent =
    lastThreshold > 0 ? Math.min(100, (cartValue / lastThreshold) * 100) : 100;
  const remaining = nextTier ? nextTier.thresholdValue - cartValue : 0;

  return {
    thresholdType,
    cartValue,
    tiers,
    currentTierIndex,
    nextTier,
    progressPercent,
    remaining,
    lastThreshold,
  };
}

/**
 * "Add X more to unlock Y" / completed copy. Quantity remaining is ceiled
 * so a fractional threshold never reads as "Add 0 items".
 *
 * @param {NonNullable<ReturnType<typeof calculateCartProgress>>} progress
 * @param {string} [currencyCode]
 */
export function cartProgressMessage(progress, currencyCode = 'INR') {
  const {nextTier, remaining, thresholdType, tiers} = progress;
  if (!nextTier) {
    return tiers[tiers.length - 1]?.label || "You've unlocked all rewards";
  }

  if (thresholdType === 'QUANTITY') {
    const count = Math.max(1, Math.ceil(remaining));
    return `Add ${count} more item${count === 1 ? '' : 's'} to unlock ${nextTier.label}`;
  }

  return `Add ${formatMoneyDisplay({
    amount: remaining,
    currencyCode,
  })} more to unlock ${nextTier.label}`;
}

/**
 * @param {{query: Function, CacheShort?: Function}} storefront
 * @returns {Promise<ReturnType<typeof parseCartProgressTiers>>}
 */
export async function loadCartProgressTiers(storefront) {
  try {
    const data = await storefront.query(CART_PROGRESS_TIERS_QUERY, {
      cache: storefront.CacheShort(),
    });
    return parseCartProgressTiers(data?.shop?.cartProgressTiers);
  } catch (error) {
    console.error('[cart-progress] Failed to load custom.cart_progress_tiers', error);
    return [];
  }
}
