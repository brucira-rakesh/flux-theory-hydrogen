// One flavor per scene, same pairing as Scene.jsx's BOTTLE_MODEL_URLS
// comments (dreamer/Scene One, sage/Scene Two, rebel/Scene Three,
// sport/Scene Four) — just without the carousel-driven visibility swap.
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

export const BOTTLE_URLS = {
  one: oxygenPublicUrl('/models/bottles/fluxtheory_dreamer_compressed.glb'),
  two: oxygenPublicUrl('/models/bottles/fluxtheory_sage_compressed.glb'),
  three: oxygenPublicUrl('/models/bottles/fluxtheory_rebel_compressed.glb'),
  four: oxygenPublicUrl('/models/bottles/fluxtheory_sport_compressed.glb'),
  five: oxygenPublicUrl('/models/bottles/fluxtheory_baked_compressed.glb'),
};
