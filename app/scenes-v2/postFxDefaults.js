// Shared default values for PostFX.jsx's AO + grade passes — split out from
// PostFX.jsx itself (a component file) so Scene.v2.jsx's GUI setup can reuse
// the same numbers without tripping react-refresh/only-export-components
// (that rule wants component files to export components only).
//
// N8AO (github.com/N8python/n8ao, the AO most award-winning three.js/r3f
// sites actually ship) replaces a hand-rolled three.js SSAOPass tried here
// first — that one read as blotchy dark banding on this scene's large
// curved unlit surfaces (single-sample kernel, no denoise). N8AO's
// screen-space radius + temporal denoise is built for exactly that case.
// Kept light on purpose — this is a premium bottle site, not a moody one:
// enough AO to seat geometry into itself, not enough to read as "dark."
export const DEFAULT_AO = {
  enabled: true,
  aoRadius: 1.5,
  distanceFalloff: 1,
  intensity: 1.5,
  aoSamples: 16,
  denoiseSamples: 8,
  halfRes: true,
  screenSpaceRadius: true,
};

// Bloom alone reads as clean CG glow with nothing grounding it, so a gentle
// contrast lift stays — but the vignette is kept soft and pushed to the
// far edge: a premium-bottle site wants a bright, luminous frame, not
// crushed corners. Hue/saturation untouched on purpose (neutral direction).
export const DEFAULT_GRADE = {
  contrast: 0.05,
  vignetteOffset: 0.45,
  vignetteDarkness: 0.25,
};
