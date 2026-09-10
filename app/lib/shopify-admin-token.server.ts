/**
 * Shopify Admin API — client-credentials access token (server-only).
 *
 * Dev Dashboard apps no longer expose a static `shpat_` token. Exchange
 * `SHOPIFY_APP_CLIENT_ID` + `SHOPIFY_APP_CLIENT_SECRET` for a short-lived
 * token (~24h) via the client credentials grant, cache it in module scope,
 * and refresh slightly before expiry.
 *
 * Never import this module from client components. Never log the secret or
 * the resolved access token.
 */

const REFRESH_BUFFER_MS = 60_000;

export type AdminTokenEnv = {
  SHOPIFY_APP_CLIENT_ID?: string;
  SHOPIFY_APP_CLIENT_SECRET?: string;
  PUBLIC_STORE_DOMAIN?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cached: CachedToken | null = null;
/** In-flight exchange so concurrent callers share one OAuth request. */
let inFlight: Promise<string> | null = null;
let loggedResponseShapeOnce = false;

/**
 * Build `https://{shop}` from `PUBLIC_STORE_DOMAIN` without double-prefixing
 * if the env value already includes a scheme.
 */
export function adminShopOrigin(storeDomain: string): string {
  const trimmed = storeDomain.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('PUBLIC_STORE_DOMAIN is missing or empty.');
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function requireCredentials(env: AdminTokenEnv): {
  clientId: string;
  clientSecret: string;
  storeDomain: string;
} {
  const clientId = env?.SHOPIFY_APP_CLIENT_ID?.trim() ?? '';
  const clientSecret = env?.SHOPIFY_APP_CLIENT_SECRET?.trim() ?? '';
  const storeDomain = env?.PUBLIC_STORE_DOMAIN?.trim() ?? '';

  if (!clientId || !clientSecret || !storeDomain) {
    throw new Error(
      'Admin API credentials incomplete: set SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET, and PUBLIC_STORE_DOMAIN on context.env.',
    );
  }

  return {clientId, clientSecret, storeDomain};
}

function cacheIsFresh(now = Date.now()): boolean {
  return Boolean(
    cached?.accessToken && now < cached.expiresAtMs - REFRESH_BUFFER_MS,
  );
}

async function exchangeClientCredentials(
  env: AdminTokenEnv,
): Promise<string> {
  const {clientId, clientSecret, storeDomain} = requireCredentials(env);
  const url = `${adminShopOrigin(storeDomain)}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    // Never include response body — it can echo credentials or tokens.
    throw new Error(
      `Shopify Admin token exchange failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;

  // Dev-only: confirm OAuth field names once (expires_in expected in seconds).
  if (import.meta.env.DEV && !loggedResponseShapeOnce) {
    loggedResponseShapeOnce = true;
    console.info('[shopify-admin-token] oauth response shape', {
      keys: Object.keys(payload),
      expires_in: payload.expires_in,
      has_access_token: typeof payload.access_token === 'string',
      scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    });
  }

  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : '';
  const expiresInSec =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : typeof payload.expires_in === 'string' && payload.expires_in.trim()
        ? Number(payload.expires_in)
        : NaN;

  if (!accessToken) {
    throw new Error(
      'Shopify Admin token exchange returned no access_token field.',
    );
  }
  if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
    throw new Error(
      'Shopify Admin token exchange returned an invalid expires_in value.',
    );
  }

  cached = {
    accessToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };

  return accessToken;
}

/**
 * Resolve a short-lived Admin API access token for `context.env`.
 * Uses module-scope cache + single-flight dedupe across concurrent callers.
 */
export async function getAdminAccessToken(env: AdminTokenEnv): Promise<string> {
  if (cacheIsFresh() && cached) {
    return cached.accessToken;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = exchangeClientCredentials(env).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Test helper — clears module cache (not for production call sites). */
export function __resetAdminTokenCacheForTests() {
  cached = null;
  inFlight = null;
}
