/**
 * Shared Shopify-menu handling for every site header (SiteHeader on PDP/PLP,
 * HeaderV2 on the homepage) — one implementation so both stay in sync
 * instead of drifting as separate copies.
 */

/**
 * Convert a Shopify menu item to the internal nav link shape.
 * Shopify URLs are absolute (https://store.myshopify.com/...) — strip the
 * origin so React Router's <Link to> receives a relative path.
 * Items that resolve to an external domain keep their full URL and use <a>.
 */
export function menuItemToNavLink(item) {
  let to = null;
  let href = null;

  try {
    const parsed = new URL(item.url);
    const host = parsed.hostname;
    const isInternal =
      host.endsWith('.myshopify.com') ||
      host.endsWith('flux-theory.pages.dev') ||
      (typeof window !== 'undefined' && host === window.location.hostname);
    if (isInternal) {
      to = parsed.pathname + parsed.search + parsed.hash;
    } else {
      href = item.url;
    }
  } catch {
    // Relative or hash-only URLs (e.g. "#brand") — use as-is
    if (item.url.startsWith('#') || item.url.startsWith('/')) {
      to = item.url.startsWith('#') ? undefined : item.url;
      href = item.url.startsWith('#') ? item.url : undefined;
    }
  }

  return {
    id: item.id,
    label: item.title,
    ...(to ? {to} : {}),
    ...(href ? {href} : {}),
  };
}

/**
 * Derive nav links from the Shopify menu (root loader's `header.menu.items`,
 * fetched fresh per page — see root.jsx's loader), falling back to a
 * caller-supplied list when the menu hasn't been configured yet or the
 * query failed.
 */
export function useNavLinks(rootData, fallbackLinks) {
  const menuItems = rootData?.header?.menu?.items;
  if (menuItems?.length) return menuItems.map(menuItemToNavLink);
  return fallbackLinks;
}

export function navPath(to) {
  const raw = String(to || '').split('#')[0].split('?')[0];
  if (raw === '/home' || raw === '/') return '/';
  if (raw === '/collections/shop-all' || raw === '/collections/all') return '/shop';
  const collection = raw.match(/^\/collections\/([^/]+)\/?$/);
  if (collection) return `/shop/${collection[1]}`;
  return raw.replace(/\/$/, '') || '/';
}

/** Shopify menu items often share a collection URL — prefer branded paths by label. */
const LABEL_PATHS = [
  [/^home$/i, '/'],
  [/^shop\s*all$/i, '/shop'],
  [/^body$/i, '/shop/body'],
  [/^face$/i, '/shop/face'],
  [/^about\s*us$/i, '/about-us'],
  [/^the\s*brand$/i, '/the-brand'],
  [/^gifting$/i, '/shop'],
];

export function linkPath(link) {
  const label = String(link.label || '').trim();
  const branded = LABEL_PATHS.find(([re]) => re.test(label));
  if (branded) return branded[1];
  if (typeof link.to === 'string' && link.to.length) return navPath(link.to);
  return '';
}

/**
 * Convert a Shopify `Menu`'s items into FooterV3's `{label, href}` link
 * shape, applying the same branded-path rewrites the header nav uses (so
 * "About Us" in a footer menu also lands on `/about-us`, not a raw
 * `/pages/about-us` collection URL). Returns `null` when the menu hasn't
 * been created in Admin yet (or has no items) so callers can fall back to
 * their static column.
 */
export function footerLinksFromMenu(menu) {
  const items = menu?.items;
  if (!items?.length) return null;

  return items.map((item) => {
    const link = menuItemToNavLink(item);
    return {
      label: link.label,
      href: linkPath(link) || link.href || link.to || '#',
    };
  });
}

export function resolveActiveId(pathname, hash, links) {
  const current = navPath(pathname);

  // Match by URL path (longest prefix wins) so Shopify menu GIDs still highlight.
  const pathLinks = links
    .map((link) => ({link, path: linkPath(link)}))
    .filter(({path}) => path && path !== '/')
    .sort((a, b) => b.path.length - a.path.length);

  for (const {link, path} of pathLinks) {
    if (current === path || current.startsWith(`${path}/`)) return link.id;
  }

  // PDP lives under shop — highlight Shop All.
  if (current.startsWith('/products')) {
    const shopAll = pathLinks.find(({path}) => path === '/shop');
    if (shopAll) return shopAll.link.id;
  }

  const hashName = (hash || '').replace(/^#/, '');
  if (hashName) {
    const byHash = links.find(
      (link) =>
        link.id === hashName ||
        link.href === `#${hashName}` ||
        (typeof link.href === 'string' && link.href.endsWith(`#${hashName}`)),
    );
    if (byHash) return byHash.id;
  }

  return null;
}
