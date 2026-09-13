// The Bottle.blend-derived "studio look" — the light rig in
// product/BottleStudioLights.jsx plus the bottle's own materials in
// scenes/BottleRigV2.jsx — was authored and tuned entirely on the standalone
// /bottle-studio page, whose Canvas runs ACES tone mapping at this exposure
// (see BottleStudioPage.jsx's own onCreated).
export const STUDIO_TUNED_EXPOSURE = 0.2;

// Every OTHER canvas in the app runs a different toneMappingExposure (the
// carousel's is 1.8), and exposure multiplies linear radiance BEFORE the ACES
// curve — so the identical rig rendered there comes out 9x hotter and clips to
// a flat white slab.
//
// One scalar fixes it, but it has to be applied to EVERY term feeding that
// radiance, so `exposure * radiance` lands on the number the studio page
// produced:
//   - light intensities            (BottleStudioLights)
//   - envMapIntensity              (BottleRigV2, useBottleStudioModel)
//
// The second one is the easy one to forget, and on this particular model it is
// most of the story: the body (NEW_BASE005 / Silver_Plastic_Logo) is
// metalness 1.0, and a metal has no diffuse response whatsoever — 100% of what
// it shows is its environment reflection (see BottleRigV2's own
// ENV_MAP_INTENSITY comment). Compensating only the lights leaves the metal
// and the label's foil sheen running 9x hot while the lights around them are
// correct: a blown-white bottle with a halo and none of the studio's modelling
// left in it, which is exactly how the home page's bottle differed from
// /bottle-studio's.
export const studioExposureScale = (canvasExposure) =>
  STUDIO_TUNED_EXPOSURE / (canvasExposure || STUDIO_TUNED_EXPOSURE);
