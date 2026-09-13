import gsap from "gsap";

// Fades every mesh material under `object` between two opacities. Traverses
// once at call time (these are static GLTF scenes that never change
// hierarchy), flips `transparent=true` for the duration so the blend actually
// shows, and reverts to `transparent=false` once fully faded IN — geometry
// that's about to sit on screen for the whole (long, scrubbed) flythrough
// goes back through the cheap opaque path instead of paying transparent-sort
// cost indefinitely. Fading OUT leaves `transparent=true` (nothing to revert
// to: the object is invisible at opacity 0 regardless).
export function fadeObjectOpacity(
  object,
  { from, to = 1, duration = 0.9, ease = "power1.inOut" } = {},
) {
  const materials = [];
  object?.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => materials.push(m));
  });

  materials.forEach((m) => {
    m.transparent = true;
    m.depthWrite = true; // three does not auto-disable this for transparent materials
    if (from !== undefined) m.opacity = from;
  });

  return gsap.to(materials, {
    opacity: to,
    duration,
    ease,
    onComplete: () => {
      if (to >= 1) {
        materials.forEach((m) => {
          m.transparent = false;
          m.opacity = 1;
        });
      }
    },
  });
}
