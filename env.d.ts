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
  }
}

export { };
