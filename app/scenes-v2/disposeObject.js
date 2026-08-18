// Frees GPU resources for everything under `object` — geometries, materials
// (and any textures hanging off them) — mirrors the cleanup Scene.jsx did in
// its effect's return function, just scoped to one scene's own subtree so
// unmounting/toggling a single scenes-v2 component doesn't touch the others.
export const disposeObject = (object) => {
  if (!object) return;
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const key of Object.keys(mat)) {
        const value = mat[key];
        if (value?.isTexture) value.dispose();
      }
      if (mat.uniforms) {
        for (const uniform of Object.values(mat.uniforms)) {
          if (uniform?.value?.isTexture) uniform.value.dispose();
        }
      }
      mat.dispose();
    }
  });
};
