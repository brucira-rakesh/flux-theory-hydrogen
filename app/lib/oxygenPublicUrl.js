/**
 * Oxygen (and MiniOxygen) only serves file types outside its static-asset
 * allowlist when the path starts with `/assets/`. wasm and ktx2 are not on
 * that list, so `/draco/*.wasm` and `/textures/*.ktx2` 404 in production
 * even though the files exist in `public/` and `dist/client`. Vite's hashed
 * JS/CSS already live under `/assets/`; public 3D files must too.
 *
 * @param {string} publicPath pathname as it exists under `public/` (e.g. `/draco/`)
 */
export function oxygenPublicUrl(publicPath) {
  if (!publicPath) return '/assets/';
  const path = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  if (path.startsWith('/assets/')) return path;
  return `/assets${path}`;
}
