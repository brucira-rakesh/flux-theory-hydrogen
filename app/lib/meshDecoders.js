/**
 * Mesh-compression decoder URLs for DRACOLoader / KTX2Loader.
 *
 * Shopify Oxygen does not serve `.wasm` from `public/` or Vite `/assets/`
 * (both 404 as HTML). Bottle + scene GLBs are Draco/Basis compressed, so
 * without these CDNs the models fetch fine but never decode — empty scenes.
 *
 * Keep the version in sync with the `three` package in package.json.
 */
export const THREE_DECODER_VERSION = '0.185.1';

export const DRACO_DECODER_PATH = `https://cdn.jsdelivr.net/npm/three@${THREE_DECODER_VERSION}/examples/jsm/libs/draco/gltf/`;

export const BASIS_TRANSCODER_PATH = `https://cdn.jsdelivr.net/npm/three@${THREE_DECODER_VERSION}/examples/jsm/libs/basis/`;
