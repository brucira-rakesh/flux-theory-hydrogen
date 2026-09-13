import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

// One physical bottle model now, shared by every carousel scene — its two
// label meshes (see BottleRigV2's findLabelMeshes, matched by node name
// "Label"/"Label.001") get re-textured per scene instead of swapping in a
// whole separate GLB per flavor, the way BOTTLE_URLS (below, now unused by
// BottleRigV2) used to.
export const BOTTLE_MODEL_URL = oxygenPublicUrl("/models/bottles/flux-bottle-v2.glb");

// Only ever used for ONE thing now: the dreamer scene's own cap assembly —
// node "NEW_BASE.003" (a leftover full-body-shaped mesh from the same
// Blender export, kept only as the correctly-rotated parent transform, its
// own geometry hidden) parenting "Sphere" then "Circle", which sits at
// exactly the same resting Y as the shared model's own cap (see
// BottleRigV2's findCapAssembly / CAP_SINK_DISTANCE). The dreamer bottle's
// body and labels are NOT used from this file any more — the shared model's
// body stays on screen the whole time, re-textured with BOTTLE_TEXTURE_URLS
// .dreamer like every other persona, while this cap assembly swaps places
// with the shared model's own cap (NEW_BASE.008) by sliding into/out of the
// body on Y.
export const DREAMER_BOTTLE_MODEL_URL = oxygenPublicUrl(
  "/models/bottles/bottle-dreamer-v1.glb",
);

// Front/back label art per persona — file names match
// public/textures/bottle-texture/<persona>_<front|back>_asset.webp exactly.
const PERSONAS = ["dreamer", "lover", "rebel", "sage", "sport"];
export const BOTTLE_TEXTURE_URLS = Object.fromEntries(
  PERSONAS.map((persona) => [
    persona,
    {
      front: oxygenPublicUrl(`/textures/bottle-texture/${persona}_front_asset.webp`),
      back: oxygenPublicUrl(`/textures/bottle-texture/${persona}_back_asset.webp`),
    },
  ]),
);
