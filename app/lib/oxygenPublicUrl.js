/**
 * Oxygen (and MiniOxygen) only serves file types outside its static-asset
 * allowlist when the path starts with `/assets/` — and on real Oxygen that
 * prefix is not a generic bypass. GLB/PNG/JS are allowlisted and can stay
 * as public/ URLs. `.wasm` is NOT served from public/ or Vite `/assets/`
 * (404) — Draco/Basis decoders must load from a CDN (see meshDecoders.js).
 * ktx2 texture *payloads* can use `/assets/...` via oxygenPublicUrl.
 *
 * @param {string} publicPath pathname as it exists under `public/` (e.g. `/models/`)
 */
export function oxygenPublicUrl(publicPath) {
  if (!publicPath) return '/assets/';
  const path = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  if (path.startsWith('/assets/')) return path;
  return `/assets${path}`;
}
