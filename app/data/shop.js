/** FACE_FILTER: set true when Clarity/Pulse/Ember/Muse exist in Shopify admin. */
export const FACE_FILTER_ENABLED = false;

export const SHOP_PAGE_SIZE = 8;

export const SORT_OPTIONS = [
  {id: 'featured', label: 'Featured'},
  {id: 'price-asc', label: 'Price: Low to High'},
  {id: 'price-desc', label: 'Price: High to Low'},
  {id: 'name-asc', label: 'Name: A–Z'},
];

export const FILTER_TAGS = [
  {id: 'bold', label: 'Bold'},
  {id: 'calm', label: 'Calm'},
  {id: 'warm', label: 'Warm'},
  {id: 'deep', label: 'Deep'},
  {id: 'fresh', label: 'Fresh'},
];

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
  if (param === 'body') return param;
  if (param === 'face' && FACE_FILTER_ENABLED) return param;
  return 'all';
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

  if (category === 'body' || category === 'face') {
    list = list.filter((item) => item.category === category);
  }

  if (tags.length) {
    list = list.filter((item) => tags.every((tag) => item.tags.includes(tag)));
  }

  if (priceRange) {
    list = list.filter((item) => {
      const price = productMinPrice(item);
      return price >= priceRange.min && price <= priceRange.max;
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
