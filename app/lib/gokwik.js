/**
 * GoKwik custom checkout — Scenario 2 (no Shopify Ajax cart APIs).
 *
 * Merchant identifiers stay as explicit placeholders until replaced.
 * Environment is the only runtime switch (sandbox | production).
 * Cart GIDs and customer PII must never be attached here — cart is set
 * client-side at checkout time only; PII is never written to merchantInfo.
 */

export const GOKWIK_SDK_TIMEOUT_MS = 10_000;
export const GOKWIK_SDK_POLL_MS = 150;
export const GOKWIK_SCRIPT_ID = 'gokwik-sdk';

/** Public GoKwik merchant id (safe on the client). Oxygen env can override. */
export const GOKWIK_MERCHANT_ID = '19vy0os7mdkc';

/** Shopify numeric shop id. Oxygen `SHOP_ID` / PUBLIC_GOKWIK_STORE_ID override. */
export const GOKWIK_STORE_ID = '85024014548';

/** Replace with comma-separated Meta pixel ids, or leave the placeholder. */
export const GOKWIK_FB_PIXEL_IDS = '<FB_PIXEL_IDS_COMMA_SEPARATED>';

const CART_GID_PATTERN = /^gid:\/\/shopify\/Cart\/[^\s/]+$/;

/**
 * Origins the GoKwik SDK and checkout iframe load from.
 * `*.gokwik.co` does not cover `sandbox.pdp.gokwik.co` (two subdomain levels).
 */
export const GOKWIK_CSP_ORIGINS = [
  'https://gokwik.co',
  'https://*.gokwik.co',
  'https://gkx.gokwik.co',
  'https://pdp.gokwik.co',
  'https://*.pdp.gokwik.co',
  'https://sandbox.pdp.gokwik.co',
  'https://dev.pdp.gokwik.co',
  'https://qa.pdp.gokwik.co',
  'https://gokwik.io',
  'https://*.gokwik.io',
  'https://*.dev.gokwik.io',
  'https://api-gw-v4.dev.gokwik.io',
  'https://gokwik.in',
  'https://*.gokwik.in',
  'https://*.dev.gokwik.in',
];

/**
 * @param {unknown} value
 * @returns {'production' | 'sandbox'}
 */
export function normalizeGokwikEnv(value) {
  const next = String(value || '').trim().toLowerCase();
  if (next === 'sandbox' || next === 'development' || next === 'dev') {
    return 'sandbox';
  }
  // Live Oxygen often has no PUBLIC_GOKWIK_ENV; this merchant is production.
  return 'production';
}

/**
 * Client-bundle fallback when root loader data is unavailable.
 * Prefer `PUBLIC_GOKWIK_ENV` from the Oxygen/Hydrogen env (via root loader).
 * @returns {'production' | 'sandbox'}
 */
export function readGokwikEnvFromMeta() {
  return normalizeGokwikEnv(
    import.meta.env.PUBLIC_GOKWIK_ENV || import.meta.env.VITE_GOKWIK_ENV,
  );
}

/**
 * @param {'production' | 'sandbox'} environment
 */
export function getGokwikSdkSrc(environment) {
  return environment === 'production'
    ? 'https://pdp.gokwik.co/v4/build/gokwik.js'
    : 'https://sandbox.pdp.gokwik.co/v4/build/gokwik.js';
}

/**
 * Drop angle-bracket placeholders and empty strings so they never go to GoKwik.
 * @param {unknown} value
 * @returns {string}
 */
function cleanGokwikValue(value) {
  const next = String(value ?? '').trim();
  if (!next) return '';
  if (next.includes('<') || next.includes('>')) return '';
  if (next.startsWith('YOUR-') || next.startsWith('SHOPIFY_')) return '';
  return next;
}

/**
 * Public GoKwik config from Oxygen/Hydrogen env. No cart, no customer fields.
 * @param {Partial<Env> | undefined} env
 */
export function getGokwikPublicConfig(env = {}) {
  const environment = normalizeGokwikEnv(
    env.PUBLIC_GOKWIK_ENV ||
      env.VITE_GOKWIK_ENV ||
      import.meta.env.PUBLIC_GOKWIK_ENV ||
      import.meta.env.VITE_GOKWIK_ENV,
  );
  return {
    environment,
    mid:
      cleanGokwikValue(env.PUBLIC_GOKWIK_MERCHANT_ID) ||
      cleanGokwikValue(import.meta.env.PUBLIC_GOKWIK_MERCHANT_ID) ||
      cleanGokwikValue(GOKWIK_MERCHANT_ID),
    storeId:
      cleanGokwikValue(env.PUBLIC_GOKWIK_STORE_ID) ||
      cleanGokwikValue(env.SHOP_ID) ||
      cleanGokwikValue(import.meta.env.PUBLIC_GOKWIK_STORE_ID) ||
      cleanGokwikValue(GOKWIK_STORE_ID),
    fbpixel:
      cleanGokwikValue(env.PUBLIC_GOKWIK_FB_PIXEL_IDS) ||
      cleanGokwikValue(import.meta.env.PUBLIC_GOKWIK_FB_PIXEL_IDS) ||
      cleanGokwikValue(GOKWIK_FB_PIXEL_IDS),
    storefrontToken:
      cleanGokwikValue(env.PUBLIC_STOREFRONT_API_TOKEN) ||
      cleanGokwikValue(import.meta.env.PUBLIC_STOREFRONT_API_TOKEN),
  };
}

/**
 * Base merchantInfo only — no cart, no customer fields.
 * @param {{
 *   environment: 'production' | 'sandbox';
 *   mid?: string;
 *   storeId?: string;
 *   fbpixel?: string;
 * }} config
 */
export function getGokwikMerchantInfo(config) {
  const environment =
    typeof config === 'string'
      ? normalizeGokwikEnv(config)
      : config?.environment || 'production';
  const mid =
    typeof config === 'string'
      ? cleanGokwikValue(GOKWIK_MERCHANT_ID)
      : cleanGokwikValue(config?.mid) || cleanGokwikValue(GOKWIK_MERCHANT_ID);
  const storeId =
    typeof config === 'string'
      ? ''
      : cleanGokwikValue(config?.storeId);
  const fbpixel =
    typeof config === 'string'
      ? ''
      : cleanGokwikValue(config?.fbpixel);
  const storefrontToken =
    typeof config === 'string'
      ? ''
      : cleanGokwikValue(config?.storefrontToken);

  /** @type {GokwikMerchantInfo} */
  const merchantInfo = {
    mid,
    environment,
    type: 'merchantInfo',
    isHydrogen: true,
  };
  if (storeId) merchantInfo.storeId = storeId;
  if (fbpixel) merchantInfo.fbpixel = fbpixel;
  if (storefrontToken) merchantInfo.storefrontToken = storefrontToken;
  return merchantInfo;
}

/**
 * GoKwik guest/initiate sends merchant_checkout_id to Shopify as a checkout
 * token. A Storefront GID (`gid://shopify/Cart/...`) 500s there. Prefer the
 * `/cart/c/<token>` segment from checkoutUrl; otherwise strip the GID prefix.
 *
 * @param {string} cartId
 * @param {string} [checkoutUrl]
 */
export function gokwikMerchantCheckoutId(cartId, checkoutUrl) {
  const decoded = decodeURIComponent(String(cartId || '').trim());
  const rawUrl = String(checkoutUrl || '').trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const cartPermalink = parsed.pathname.match(/\/cart\/c\/([^/]+)/);
      if (cartPermalink?.[1]) {
        const token = decodeURIComponent(cartPermalink[1]);
        const key = parsed.searchParams.get('key');
        return key ? `${token}?key=${key}` : token;
      }
      const checkoutToken = parsed.pathname.match(
        /\/checkouts\/(?:cn\/)?([^/]+)/,
      );
      if (checkoutToken?.[1]) return decodeURIComponent(checkoutToken[1]);
    } catch {
      // Fall through to the GID token.
    }
  }
  return decoded.replace(/^gid:\/\/shopify\/Cart\//, '');
}

/**
 * Checkout payload GoKwik v4's iframe reads as
 * `merchantInfo.merchantParams.merchantCheckoutId`.
 *
 * @param {ReturnType<typeof getGokwikPublicConfig>} config
 * @param {string} cartId
 * @param {string} [checkoutUrl]
 * @returns {GokwikMerchantInfo}
 */
export function getGokwikCheckoutPayload(config, cartId, checkoutUrl) {
  const id = decodeURIComponent(String(cartId || '').trim());
  const checkoutId = gokwikMerchantCheckoutId(id, checkoutUrl);
  const base = getGokwikMerchantInfo(config);
  /** @type {NonNullable<GokwikMerchantInfo['merchantParams']>} */
  const merchantParams = {
    merchantCheckoutId: checkoutId,
    cartId: id,
  };
  if (base.storeId) merchantParams.storeId = base.storeId;
  if (base.storefrontToken) merchantParams.storefrontToken = base.storefrontToken;

  /** @type {GokwikMerchantInfo} */
  const payload = {
    ...base,
    merchantPlatform: 'hydrogen',
    cart: {id},
    merchantParams,
  };
  if (checkoutUrl) payload.checkoutUrl = checkoutUrl;
  return payload;
}

/**
 * @param {unknown} config
 * @returns {boolean}
 */
export function isGokwikMerchantConfigured(config) {
  const mid =
    config && typeof config === 'object'
      ? cleanGokwikValue(config.mid)
      : '';
  return Boolean(mid);
}

/**
 * @param {unknown} cartId
 * @returns {cartId is string}
 */
export function isShopifyCartGid(cartId) {
  return typeof cartId === 'string' && CART_GID_PATTERN.test(cartId);
}

/**
 * True once GoKwik's v4 UI is mounted, or the checkout stub is present.
 * @returns {boolean}
 */
export function isGokwikCheckoutReady() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.gokwikCheckoutApp ||
      (window.gokwikSdk && typeof window.gokwikSdk.initCheckout === 'function'),
  );
}

/**
 * Hydrogen CSP blocks the SDK's nonce-less inline stub. Install the same
 * postMessage API first so v4 skips that injection (`if (!window.gokwikSdk)`).
 */
export function installGokwikSdkStub() {
  if (typeof window === 'undefined') return;
  if (window.gokwikSdk && typeof window.gokwikSdk.initCheckout === 'function') {
    return;
  }

  /** @type {Record<string, Array<(payload?: unknown) => void>>} */
  const listeners = {};

  window.gokwikSdk = {
    initCheckout(payload) {
      window.postMessage(payload, window.location.href);
    },
    on(eventName, handler) {
      if (!eventName || typeof handler !== 'function') return;
      listeners[eventName] = listeners[eventName] || [];
      listeners[eventName].push(handler);
    },
    emit(eventName, payload) {
      (listeners[eventName] || []).forEach((handler) => handler(payload));
    },
    close() {
      window.postMessage('gk-merchant-close', window.location.href);
    },
  };
}

/**
 * Scenario 2 entrypoint expected by GoKwik custom checkout docs.
 */
export function installGokwikCustomCheckoutTrigger() {
  if (typeof window === 'undefined') return;
  if (typeof window.triggerGokwikCustomCheckout === 'function') return;

  window.triggerGokwikCustomCheckout = function triggerGokwikCustomCheckout() {
    if (!window.gokwikSdk || typeof window.gokwikSdk.initCheckout !== 'function') {
      throw new Error(
        'GoKwik SDK is not ready. Cannot call triggerGokwikCustomCheckout().',
      );
    }
    window.gokwikSdk.initCheckout(window.merchantInfo);
  };
}

/**
 * Copy Hydrogen's nonce onto scripts GoKwik injects later (src tags, etc.).
 * @param {string | undefined} nonce
 * @returns {() => void}
 */
export function installGokwikScriptNonceStamp(nonce) {
  if (typeof window === 'undefined' || !nonce) return () => {};

  const proto = Node.prototype;
  const appendChild = proto.appendChild;
  const insertBefore = proto.insertBefore;

  const stamp = (node) => {
    if (!node || node.nodeName !== 'SCRIPT') return;
    const src = typeof node.src === 'string' ? node.src : '';
    const fromGokwik =
      node.id === 'gokwik-sdk-script' || src.includes('gokwik.co');
    if (!fromGokwik) return;
    node.nonce = nonce;
    node.setAttribute('nonce', nonce);
  };

  proto.appendChild = function patchedAppendChild(child) {
    stamp(child);
    return appendChild.call(this, child);
  };
  proto.insertBefore = function patchedInsertBefore(newNode, referenceNode) {
    stamp(newNode);
    return insertBefore.call(this, newNode, referenceNode);
  };

  return () => {
    proto.appendChild = appendChild;
    proto.insertBefore = insertBefore;
  };
}
