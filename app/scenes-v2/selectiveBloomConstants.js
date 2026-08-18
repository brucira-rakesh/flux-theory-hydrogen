// Layer reserved for Scene Three's own selective bloom (see
// SelectiveBloomV2.jsx) — distinct from PostFX's scene-wide UnrealBloomPass,
// which reacts to any overbright pixel anywhere in the app. SelectiveBloomV2
// darkens every mesh in the whole app scene that ISN'T on this layer before
// extracting bloom, so only meshes explicitly placed on it (regardless of
// which scene they belong to) ever contribute a glow.
export const SCENE_THREE_BLOOM_LAYER = 2;

export const defaultSceneThreeBloomParams = () => ({
  strength: 1.2,
  radius: 0.4,
  threshold: 0.1,
});
