/** FACE_FILTER: set true when Clarity/Pulse/Ember/Muse exist in Shopify admin. */
export const FACE_FILTER_ENABLED = false;

export const SHOP_PAGE_SIZE = 8;

export const SORT_OPTIONS = [
  {id: 'featured', label: 'Featured'},
  {id: 'price-asc', label: 'Price: Low to High'},
  {id: 'price-desc', label: 'Price: High to Low'},
  {id: 'name-asc', label: 'Name: A–Z'},
];

/** Build filter drawer options from parsed listing-card facet arrays. */
export function buildFilterOptions(catalog, field) {
  const seen = new Set();
  const opts = [];
  const toLabel = (id) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : String(id));

  for (const product of catalog) {
    for (const value of product?.[field] ?? []) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      opts.push({id: value, label: toLabel(value)});
    }
  }

  return opts.sort((a, b) => a.label.localeCompare(b.label));
}

/** All variant prices on a listing card. */
export function productVariantPrices(item) {
  return (item?.variants ?? [])
    .map((variant) => Number(variant?.priceAmount))
    .filter((amount) => Number.isFinite(amount));
}

/** Lowest variant price — "starting from" convention for PLP filtering. */
export function productMinPrice(item) {
  const variantPrices = productVariantPrices(item);
  if (variantPrices.length) return Math.min(...variantPrices);
  const fallback = Number(item?.price);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function formatShopPrice(amount, currency = '₹') {
  return `${currency}${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** @param {object[]} items */
export function computePriceBounds(items = []) {
  const prices = items.flatMap(productVariantPrices);
  if (!prices.length) {
    const mins = items.map(productMinPrice).filter((p) => Number.isFinite(p));
    if (!mins.length) return {min: 0, max: 0};
    return {min: Math.min(...mins), max: Math.max(...mins)};
  }
  return {min: Math.min(...prices), max: Math.max(...prices)};
}

export function isFullPriceRange(range, bounds) {
  if (!range || !bounds) return true;
  return range.min <= bounds.min && range.max >= bounds.max;
}

export function categoryFromParam(param) {
  if (!param || param === 'all') return 'all';
  return param;
}

export function shopTitle(category) {
  if (category === 'body') return 'Body';
  if (category === 'face') return 'Face';
  return 'Shop All';
}

/**
 * @param {{
 *   items?: object[],
 *   category?: string,
 *   tags?: string[],
 *   priceRange?: { min: number, max: number } | null,
 *   sort?: string,
 * }} opts
 */
export function filterAndSortCatalog(opts = {}) {
  const {
    items = [],
    category = 'all',
    tags = [],
    priceRange = null,
    sort = 'featured',
  } = opts;

  let list = Array.isArray(items) ? [...items] : [];

  if (category !== 'all') {
    list = list.filter((item) => (item.categories ?? []).includes(category));
  }

  if (tags.length) {
    // Faceted behavior: multiple selected values within the same filter type
    // use OR logic (e.g. mood=warm OR mood=calm).
    list = list.filter((item) => tags.some((tag) => item.tags.includes(tag)));
  }

  if (priceRange) {
    list = list.filter((item) => {
      // Price match uses "any variant in range" convention:
      // a product passes if at least one variant price falls within [min, max].
      const matches = productVariantPrices(item).some(
        (price) => price >= priceRange.min && price <= priceRange.max,
      );
      return matches;
    });
  }

  const sorted = [...list];
  switch (sort) {
    case 'price-asc':
      sorted.sort(
        (a, b) =>
          productMinPrice(a) - productMinPrice(b) || a.name.localeCompare(b.name),
      );
      break;
    case 'price-desc':
      sorted.sort(
        (a, b) =>
          productMinPrice(b) - productMinPrice(a) || a.name.localeCompare(b.name),
      );
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort((a, b) => a.featuredOrder - b.featuredOrder);
  }

  return sorted;
}
