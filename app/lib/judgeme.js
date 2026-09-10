/**
 * Judge.me reviews — server-only.
 *
 * Auth: JUDGEME_PRIVATE_TOKEN + JUDGEME_SHOP_DOMAIN (no PUBLIC_ prefix).
 * Never import this module from client components.
 *
 * Product filter findings (live against this store):
 * - `/reviews?product_id=` expects Judge.me's *internal* id, NOT Shopify's.
 * - Shopify numeric id as product_id → 422 "number … too big".
 * - Internal ids above INT32_MAX (e.g. 2157447329) also 422 on `/reviews`.
 * - Working product-scoped path: `/widgets/product_review?external_id={Shopify
 *   numeric id}` (HTML summary attrs) + `json_request=true` (review list).
 */

const JUDGEME_API = 'https://judge.me/api/v1';
const INT32_MAX = 2147483647;

/**
 * @param {string | null | undefined} gid
 * @returns {string | null}
 */
export function shopifyNumericProductId(gid) {
  if (!gid || typeof gid !== 'string') return null;
  const match = gid.match(/Product\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value !== 'string') return '';
  // Judge.me may return unsanitized content — strip tags for storefront text.
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a published review photo URL from Judge.me payload shapes.
 *
 * Private `/reviews` API:
 *   pictures: [{ hidden, urls: { original, small, compact, huge } }]
 *
 * Widget `json_request=true` (what the PDP loader uses):
 *   pictures_urls: [{ original, small, compact, huge }]   ← flat size map, no nested `urls`
 */
function publishedPictureUrl(review) {
  if (!review || typeof review !== 'object') return null;

  /** @param {unknown} urls */
  function urlFromSizeMap(urls) {
    if (!urls || typeof urls !== 'object') return null;
    const map = /** @type {Record<string, unknown>} */ (urls);
    for (const key of ['huge', 'original', 'compact', 'small']) {
      if (typeof map[key] === 'string' && map[key].length > 0) return map[key];
    }
    return null;
  }

  // Widget path — primary for this storefront.
  if (Array.isArray(review.pictures_urls)) {
    for (const entry of review.pictures_urls) {
      if (!entry || typeof entry !== 'object') continue;
      // Flat size map: { original, small, … }
      const fromFlat = urlFromSizeMap(entry);
      if (fromFlat) return fromFlat;
      // Defensive: nested { urls: { … } } if Judge.me ever aligns shapes.
      const nested = /** @type {{urls?: unknown, hidden?: boolean}} */ (entry);
      if (nested.hidden === true) continue;
      const fromNested = urlFromSizeMap(nested.urls);
      if (fromNested) return fromNested;
      if (typeof nested.url === 'string' && nested.url) return nested.url;
    }
  }

  const pictures = Array.isArray(review.pictures)
    ? review.pictures
    : Array.isArray(review.media)
      ? review.media
      : [];

  if (review.has_published_pictures === false && pictures.length === 0) {
    // Widget may omit has_published_pictures; empty pictures_urls already handled.
    if (!Array.isArray(review.pictures_urls) || review.pictures_urls.length === 0) {
      return null;
    }
  }

  for (const picture of pictures) {
    if (!picture || typeof picture !== 'object') continue;
    if (picture.hidden === true) continue;
    const fromUrls = urlFromSizeMap(picture.urls);
    if (fromUrls) return fromUrls;
    if (typeof picture.url === 'string' && picture.url.length > 0) {
      return picture.url;
    }
    if (typeof picture.src === 'string' && picture.src.length > 0) {
      return picture.src;
    }
  }

  if (typeof review.picture_url === 'string' && review.picture_url) {
    return review.picture_url;
  }
  return null;
}

/**
 * @param {Env | undefined} env
 * @returns {{token: string, shopDomain: string} | null}
 */
function credentialsFromEnv(env) {
  const token = env?.JUDGEME_PRIVATE_TOKEN?.trim();
  const shopDomain = (
    env?.JUDGEME_SHOP_DOMAIN ||
    env?.PUBLIC_STORE_DOMAIN ||
    ''
  ).trim();
  if (!token || !shopDomain) return null;
  return {token, shopDomain};
}

/**
 * @param {string} path
 * @param {{token: string, shopDomain: string}} creds
 * @param {Record<string, string | number | undefined>} [params]
 */
async function judgemeGet(path, creds, params = {}) {
  const url = new URL(`${JUDGEME_API}${path}`);
  url.searchParams.set('api_token', creds.token);
  url.searchParams.set('shop_domain', creds.shopDomain);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {Accept: 'application/json'},
  });

  if (!response.ok) {
    throw new Error(`Judge.me ${path} failed: ${response.status}`);
  }

  return response.json();
}

/**
 * @param {string} html
 * @returns {{average: number, count: number}}
 */
function parseWidgetSummary(html) {
  if (typeof html !== 'string' || !html) {
    return {average: 0, count: 0};
  }
  const averageMatch = html.match(/data-average-rating=['"]([\d.]+)['"]/i);
  const countMatch = html.match(/data-number-of-reviews=['"](\d+)['"]/i);
  return {
    average: averageMatch ? Number(averageMatch[1]) : 0,
    count: countMatch ? Number(countMatch[1]) : 0,
  };
}

/**
 * @param {unknown[]} reviews
 * @returns {number}
 */
function averageRating(reviews) {
  if (!reviews.length) return 0;
  const sum = reviews.reduce((acc, review) => {
    const rating = Number(review?.rating);
    return acc + (Number.isFinite(rating) ? rating : 0);
  }, 0);
  return sum / reviews.length;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatRating(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * @param {number} count
 * @returns {string}
 */
function formatPeopleCount(count) {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    const label =
      millions >= 10 ? `${Math.round(millions)}M` : `${millions.toFixed(1)}M`;
    return `${label.replace(/\.0$/, '')}+`;
  }
  if (count >= 1_000) {
    const thousands = count / 1_000;
    const label =
      thousands >= 10
        ? `${Math.round(thousands)}K`
        : `${thousands.toFixed(1)}K`;
    return `${label.replace(/\.0$/, '')}+`;
  }
  return String(Math.round(count));
}

/**
 * @param {object} args
 * @param {unknown[]} args.reviews
 * @param {number} args.count
 * @param {number} args.average
 */
function toReviewWallData({reviews, count, average}) {
  const published = reviews.filter((review) => {
    if (!review || typeof review !== 'object') return false;
    if (review.hidden === true) return false;
    if (review.curated && review.curated !== 'ok') return false;
    return true;
  });

  const cards = published.slice(0, 10).map((review, index) => {
    const name =
      asText(review.reviewer?.name) ||
      asText(review.reviewer_name) ||
      asText(review.author) ||
      'Flux customer';
    const rating = Math.min(
      5,
      Math.max(1, Math.round(Number(review.rating) || 5)),
    );
    const body = asText(review.body) || asText(review.content);
    const photo = publishedPictureUrl(review);
    const quote = body
      ? body.startsWith('“') || body.startsWith('"')
        ? body
        : `“${body}”`
      : null;

    const avatar =
      (typeof review.avatar_image_url === 'string' &&
      review.avatar_image_url.trim()
        ? review.avatar_image_url.trim()
        : null) ||
      (typeof review.reviewer?.avatar === 'string' && review.reviewer.avatar
        ? review.reviewer.avatar
        : null);

    // Figma masonry (3108:3066): separate white tiles, 8px gap.
    // Photo columns → photo on top, reviewer under.
    // Quote columns → reviewer on top, tall quote tile under.
    /** @type {Array<'reviewer' | 'photo' | 'quote'>} */
    let order;
    if (photo) {
      order = ['photo', 'reviewer'];
    } else if (quote) {
      order = ['reviewer', 'quote'];
    } else {
      order = ['reviewer'];
    }

    return {
      id: String(review.id ?? review.uuid ?? `review-${index}`),
      order,
      reviewer: {
        name,
        rating,
        avatar,
      },
      quote: order.includes('quote') ? quote : null,
      photo: order.includes('photo') ? photo : null,
    };
  });

  const ratingLabel = formatRating(average);
  const people = formatPeopleCount(count);

  return {
    hasReviews: cards.length > 0,
    summary: {
      rating: ratingLabel,
      body: 'Loved by Flux users across India. Made for better everyday routines.',
      trust: `${ratingLabel} (${people} People)`,
      avatars: cards
        .map((card) => card.photo)
        .filter(Boolean)
        .slice(0, 5),
    },
    cards,
  };
}

const EMPTY_WALL = {
  hasReviews: false,
  summary: {
    rating: '0',
    body: 'Loved by Flux users across India. Made for better everyday routines.',
    trust: '0 (0 People)',
    avatars: [],
  },
  cards: [],
};

/**
 * Preferred path: widget API accepts Shopify external_id and avoids the
 * `/reviews?product_id=` INT32 overflow on large Judge.me internal ids.
 *
 * @param {{token: string, shopDomain: string}} creds
 * @param {string} externalId
 */
async function fetchViaWidget(creds, externalId) {
  const [widgetPayload, jsonPayload] = await Promise.all([
    judgemeGet('/widgets/product_review', creds, {
      external_id: externalId,
    }),
    judgemeGet('/widgets/product_review', creds, {
      external_id: externalId,
      json_request: 'true',
      per_page: 10,
      page: 1,
    }),
  ]);

  const summary = parseWidgetSummary(widgetPayload?.widget ?? '');
  const reviews = Array.isArray(jsonPayload?.reviews) ? jsonPayload.reviews : [];
  const average =
    summary.average > 0 ? summary.average : averageRating(reviews);
  const count = summary.count > 0 ? summary.count : reviews.length;

  return toReviewWallData({reviews, count, average});
}

/**
 * Legacy `/reviews` path — only safe when internal id fits signed INT32.
 *
 * @param {{token: string, shopDomain: string}} creds
 * @param {string} externalId
 */
async function fetchViaReviewsApi(creds, externalId) {
  const productPayload = await judgemeGet('/products/-1', creds, {
    external_id: externalId,
  });
  const internalId = Number(productPayload?.product?.id);
  if (!Number.isFinite(internalId) || internalId <= 0) {
    return EMPTY_WALL;
  }
  if (internalId > INT32_MAX) {
    // Known Judge.me bug — fall through to widget path in caller.
    throw new Error('Judge.me internal product_id exceeds INT32_MAX');
  }

  const [reviewsPayload, countPayload] = await Promise.all([
    judgemeGet('/reviews', creds, {
      product_id: internalId,
      per_page: 10,
      page: 1,
    }),
    judgemeGet('/reviews/count', creds, {
      product_id: internalId,
    }).catch(() => null),
  ]);

  const reviews = Array.isArray(reviewsPayload?.reviews)
    ? reviewsPayload.reviews
    : [];
  const countFromApi = Number(
    countPayload?.count ??
      countPayload?.reviews_count ??
      countPayload?.number_of_reviews,
  );
  const count = Number.isFinite(countFromApi) ? countFromApi : reviews.length;
  const average = averageRating(
    reviews.filter((review) => review && review.hidden !== true),
  );

  return toReviewWallData({reviews, count, average});
}

/**
 * Fetch Judge.me reviews for a Shopify product (server-only).
 * Returns null on hard failure so the PDP can fall back to State 1.
 *
 * @param {object} args
 * @param {Env | undefined} args.env
 * @param {string | null | undefined} args.productGid
 */
export async function loadJudgeMeProductReviews({env, productGid}) {
  try {
    const creds = credentialsFromEnv(env);
    if (!creds) return null;

    const externalId = shopifyNumericProductId(productGid);
    if (!externalId) return null;

    // Widget + external_id is the reliable product-scoped path for this shop.
    return await fetchViaWidget(creds, externalId);
  } catch {
    // Network / auth / rate-limit → State 1, never crash the PDP.
    return null;
  }
}

/**
 * Shop domain for web-review create (no private token required by Judge.me).
 * @param {Env | undefined} env
 * @returns {string | null}
 */
function shopDomainFromEnv(env) {
  const shopDomain = (
    env?.JUDGEME_SHOP_DOMAIN ||
    env?.PUBLIC_STORE_DOMAIN ||
    ''
  ).trim();
  return shopDomain || null;
}

/**
 * Client IP for Judge.me `ip_addr` (location display). Prefer edge headers.
 * @param {Request | undefined} request
 * @returns {string | null}
 */
export function clientIpFromRequest(request) {
  if (!request?.headers) return null;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    null
  );
}

/**
 * Create a web review via Judge.me POST /reviews (server-only).
 * No private token on this endpoint; shop_domain + product id stay server-controlled.
 *
 * @param {object} args
 * @param {Env | undefined} args.env
 * @param {string | null | undefined} args.productGid
 * @param {string} args.name
 * @param {string} args.email
 * @param {number} args.rating
 * @param {string} [args.title]
 * @param {string} args.body
 * @param {string | null} [args.ipAddr]
 * @param {string[]} [args.pictureUrls] Public CDN URLs (e.g. Shopify Files)
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function submitJudgeMeReview({
  env,
  productGid,
  name,
  email,
  rating,
  title,
  body,
  ipAddr = null,
  pictureUrls = [],
}) {
  const shopDomain = shopDomainFromEnv(env);
  if (!shopDomain) {
    return {ok: false, error: 'Reviews are temporarily unavailable.'};
  }

  const externalId = shopifyNumericProductId(productGid);
  if (!externalId) {
    return {ok: false, error: 'Could not identify this product for review.'};
  }

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return {ok: false, error: 'Please select a rating from 1 to 5 stars.'};
  }

  const trimmedName = String(name ?? '').trim();
  const trimmedEmail = String(email ?? '').trim();
  const trimmedBody = String(body ?? '').trim();
  const trimmedTitle = String(title ?? '').trim();

  if (!trimmedName) {
    return {ok: false, error: 'Please enter your name.'};
  }
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return {ok: false, error: 'Please enter a valid email address.'};
  }
  if (!trimmedBody) {
    return {ok: false, error: 'Please write your review.'};
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    shop_domain: shopDomain,
    platform: 'shopify',
    id: Number(externalId),
    name: trimmedName,
    email: trimmedEmail,
    rating: ratingNum,
    body: trimmedBody,
  };
  if (trimmedTitle) payload.title = trimmedTitle;
  if (ipAddr) payload.ip_addr = ipAddr;

  const urls = (Array.isArray(pictureUrls) ? pictureUrls : [])
    .map((url) => String(url ?? '').trim())
    .filter((url) => /^https?:\/\//i.test(url));
  if (urls.length) payload.picture_urls = urls;

  // Server-only breadcrumb — never log full URLs in production noise? count is enough.
  console.info('[judgeme-review] submit', {
    productId: externalId,
    pictureUrlCount: urls.length,
  });

  try {
    const response = await fetch(`${JUDGEME_API}/reviews`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      const message =
        (typeof json?.error === 'string' && json.error) ||
        (typeof json?.message === 'string' && json.message) ||
        (Array.isArray(json?.errors) && json.errors[0]
          ? String(json.errors[0])
          : null) ||
        'Could not submit your review. Please try again.';
      return {ok: false, error: message};
    }

    // Some Judge.me failures still return 200 with an error payload.
    if (
      json &&
      typeof json === 'object' &&
      (json.error || json.errors || json.success === false)
    ) {
      const message =
        (typeof json.error === 'string' && json.error) ||
        (typeof json.message === 'string' && json.message) ||
        'Could not submit your review. Please try again.';
      return {ok: false, error: message};
    }

    return {ok: true};
  } catch {
    return {
      ok: false,
      error: 'Could not reach the review service. Please try again.',
    };
  }
}
