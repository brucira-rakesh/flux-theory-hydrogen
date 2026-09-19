/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  /**
   * Server-only credentials (no PUBLIC_ prefix — never client-bundled).
   * Add to `.env` for local Oxygen / Hydrogen:
   *   JUDGEME_PRIVATE_TOKEN=
   *   JUDGEME_SHOP_DOMAIN=
   *   SHOPIFY_APP_CLIENT_ID=      # Dev Dashboard app client id
   *   SHOPIFY_APP_CLIENT_SECRET=  # Dev Dashboard app client secret
   *
   * Admin scopes on the app version: `write_files` (review photo upload),
   * plus `read_discounts` (currently unused by storefront code — left on the
   * app for possible future use). Tokens via client_credentials —
   * see shopify-admin-token.server.ts.
   */
  interface Env {
    JUDGEME_PRIVATE_TOKEN?: string;
    JUDGEME_SHOP_DOMAIN?: string;
    /** Dev Dashboard app client id (server-only). */
    SHOPIFY_APP_CLIENT_ID?: string;
    /** Dev Dashboard app client secret (server-only). */
    SHOPIFY_APP_CLIENT_SECRET?: string;
    /** GoKwik checkout environment: `production` or `sandbox` (default). */
    PUBLIC_GOKWIK_ENV?: string;
    /** Alias for PUBLIC_GOKWIK_ENV (Vite-style). */
    VITE_GOKWIK_ENV?: string;
    /** GoKwik merchant id (public, used only on the client as merchantInfo.mid). */
    PUBLIC_GOKWIK_MERCHANT_ID?: string;
    /** Optional override for Shopify numeric store id. Falls back to SHOP_ID. */
    PUBLIC_GOKWIK_STORE_ID?: string;
    /** Optional comma-separated Meta pixel ids. */
    PUBLIC_GOKWIK_FB_PIXEL_IDS?: string;
    SHOP_ID?: string;
  }

  interface ImportMetaEnv {
    readonly PUBLIC_GOKWIK_ENV?: string;
    readonly VITE_GOKWIK_ENV?: string;
    readonly PUBLIC_GOKWIK_MERCHANT_ID?: string;
    readonly PUBLIC_GOKWIK_STORE_ID?: string;
    readonly PUBLIC_GOKWIK_FB_PIXEL_IDS?: string;
  }

  interface GokwikMerchantInfo {
    mid: string;
    environment: 'production' | 'sandbox';
    type: 'merchantInfo';
    storeId?: string;
    fbpixel?: string;
    cart?: {id: string};
  }

  interface Window {
    merchantInfo?: GokwikMerchantInfo;
    gokwikCheckoutApp?: unknown;
    gokwikSdk?: {
      initCheckout?: (payload: unknown) => void;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      emit?: (event: string, payload?: unknown) => void;
      close?: () => void;
      getCheckoutState?: () => unknown;
    };
    triggerGokwikCustomCheckout?: () => void;
  }
}

export { };
