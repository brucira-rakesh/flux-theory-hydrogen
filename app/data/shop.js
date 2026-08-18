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

export const PRICE_FILTERS = [
  {id: 'any', label: 'Any price'},
  {id: 'under-320', label: 'Under ₹320', max: 320},
  {id: '320-360', label: '₹320 – ₹360', min: 320, max: 360},
  {id: 'over-360', label: 'Over ₹360', min: 360},
];

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
 * @param {{ items?: object[], category?: string, tags?: string[], priceId?: string, sort?: string }} opts
 */
export function filterAndSortCatalog(opts = {}) {
  const {
    items = [],
    category = 'all',
    tags = [],
    priceId = 'any',
    sort = 'featured',
  } = opts;

  const priceRule = PRICE_FILTERS.find((p) => p.id === priceId) ?? PRICE_FILTERS[0];
  let list = Array.isArray(items) ? [...items] : [];

  if (category === 'body' || category === 'face') {
    list = list.filter((item) => item.category === category);
  }

  if (tags.length) {
    list = list.filter((item) => tags.every((tag) => item.tags.includes(tag)));
  }

  if (priceRule.min != null) {
    list = list.filter((item) => item.price >= priceRule.min);
  }
  if (priceRule.max != null) {
    list = list.filter((item) => item.price <= priceRule.max);
  }

  const sorted = [...list];
  switch (sort) {
    case 'price-asc':
      sorted.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
      break;
    case 'price-desc':
      sorted.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort((a, b) => a.featuredOrder - b.featuredOrder);
  }

  return sorted;
}
