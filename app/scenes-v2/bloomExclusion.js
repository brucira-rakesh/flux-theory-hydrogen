// Registry of meshes that must NOT contribute to the scene-wide bloom pass
// (see PostFXV2), independent of how bright they are.
//
// The video planes are the case this exists for. They're full-bleed renders
// that already have their glow baked in by the renderer that produced them —
// the light strip along the ceiling is a blown-out white line in the file
// itself. Running the app's own bloom over that blooms an already-bloomed
// image, which is what reads as the strip smearing far past where the render
// intended. The bottle and any real 3D scene meshes still need the pass, so
// switching bloom off wholesale isn't the answer; only these planes have to
// sit it out.
//
// A registry rather than a layer flag because postprocessing's
// SelectiveBloomEffect skips its mask pass entirely while the selection is
// empty (`if (ignoreBackground || !inverted || selection.size > 0)`), so it
// needs the actual object references, not just objects with its layer
// enabled. Kept as a module rather than context so a plane can register from
// inside the R3F tree without PostFXV2 having to be its ancestor or re-render
// when the set changes.
const excluded = new Set();
// Bumped on every change so PostFXV2 can re-sync only when something actually
// mounted or unmounted, instead of rebuilding the selection every frame.
let version = 0;

// Registers `object` and returns its own unregister function, so callers can
// return it straight from a useEffect.
export function excludeFromBloom(object) {
  if (!object) return () => {};
  excluded.add(object);
  version += 1;
  return () => {
    excluded.delete(object);
    version += 1;
  };
}

export const getBloomExclusions = () => excluded;
export const getBloomExclusionVersion = () => version;
