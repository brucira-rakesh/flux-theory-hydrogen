// Reusable lil-gui folder builders — the same controls Scene.jsx built once
// per scene (four times, nearly identically) for its Sea/Fog/Droplet/Neon/
// Background/Glass materials. Parameterized here so every scenes-v2 scene
// component calls the same builder instead of re-authoring the sliders.

const addPositionFolder = (parent, mesh, range) => {
  const pos = parent.addFolder("Position");
  const step = range / 1000;
  const p = mesh.position;
  pos.add(p, "x", p.x - range, p.x + range, step).name("Position X");
  pos.add(p, "y", p.y - range, p.y + range, step).name("Position Y");
  pos.add(p, "z", p.z - range, p.z + range, step).name("Position Z");
  return pos;
};

export const addSeaGui = (parent, { material, mesh, range, label = "Sea" }) => {
  if (!material) return;
  const u = material.uniforms;
  const params = {
    depth: `#${u.uDepthColor.value.getHexString()}`,
    surface: `#${u.uSurfaceColor.value.getHexString()}`,
    flowAngle:
      (Math.atan2(u.uFlowDirection.value.y, u.uFlowDirection.value.x) * 180) /
      Math.PI,
  };
  const sea = parent.addFolder(label);

  const ripples = sea.addFolder("Ripples");
  ripples
    .add(params, "flowAngle", 0, 360, 1)
    .name("Flow direction")
    .onChange((deg) => {
      const rad = (deg * Math.PI) / 180;
      u.uFlowDirection.value.set(Math.cos(rad), Math.sin(rad));
    });
  ripples.add(u.uFlowSpeed, "value", 0, 1, 0.001).name("Flow speed");
  ripples.add(u.uNormalStrength, "value", 0, 3, 0.01).name("Normal strength");
  ripples.add(u.uTiling.value, "x", 1, 20, 1).name("Tiling X");
  ripples.add(u.uTiling.value, "y", 1, 20, 1).name("Tiling Y");
  ripples
    .add(u.uDisplacementStrength, "value", 0, 10, 0.01)
    .name("Displacement strength");
  ripples.add(u.uAOStrength, "value", 0, 1, 0.01).name("AO strength");

  const col = sea.addFolder("Color");
  col
    .addColor(params, "depth")
    .name("Depth color")
    .onChange((v) => u.uDepthColor.value.set(v));
  col
    .addColor(params, "surface")
    .name("Surface color")
    .onChange((v) => u.uSurfaceColor.value.set(v));
  col.add(u.uColorOffset, "value", 0, 1, 0.001).name("Color offset");
  col.add(u.uColorMultiplier, "value", 0, 10, 0.01).name("Color multiplier");
  col.add(u.uOpacity, "value", 0, 1, 0.01).name("Opacity");

  const refl = sea.addFolder("Reflection");
  refl.add(u.uReflectivity, "value", 0, 1, 0.01).name("Reflectivity");
  refl.add(u.uReflectionDistortion, "value", 0, 0.2, 0.001).name("Distortion");
  refl.add(u.uReflectionBlur, "value", 0, 0.01, 0.0001).name("Blur (softness)");
  refl.add(u.uSpecularStrength, "value", 0, 2, 0.01).name("Specular strength");
  refl.add(u.uShininess, "value", 1, 256, 1).name("Shininess");

  if (mesh?.geometry?.boundingBox) {
    const localBox = mesh.geometry.boundingBox;
    const fade = sea.addFolder("Edge fade");
    const stepZ = (localBox.max.z - localBox.min.z) / 1000 || 0.001;
    fade.add(u.uEdgeFadeStart, "value", localBox.min.z, localBox.max.z, stepZ).name("Fade start Z");
    fade.add(u.uEdgeFadeEnd, "value", localBox.min.z, localBox.max.z, stepZ).name("Fade end Z");
    const stepX = (localBox.max.x - localBox.min.x) / 1000 || 0.001;
    fade.add(u.uEdgeFadeStartX, "value", localBox.min.x, localBox.max.x, stepX).name("Fade start X");
    fade.add(u.uEdgeFadeEndX, "value", localBox.min.x, localBox.max.x, stepX).name("Fade end X");
  }

  if (mesh) addPositionFolder(sea, mesh, range);
  return sea;
};

export const addFogGui = (parent, { material, mesh, range, label = "Fog" }) => {
  if (!material) return;
  const u = material.uniforms;
  const folder = parent.addFolder(label);
  const params = {
    color: `#${u.uColor.value.getHexString()}`,
    driftAngle:
      (Math.atan2(u.uFlowDirection.value.y, u.uFlowDirection.value.x) * 180) /
      Math.PI,
  };
  folder
    .addColor(params, "color")
    .name("Color")
    .onChange((v) => u.uColor.value.set(v));
  folder.add(u.uOpacity, "value", 0, 1, 0.01).name("Opacity");
  folder.add(u.uDensity, "value", 0, 10, 0.01).name("Density");
  folder.add(u.uTiling.value, "x", 0.5, 10, 0.1).name("Tiling X");
  folder.add(u.uTiling.value, "y", 0.5, 10, 0.1).name("Tiling Y");
  folder
    .add(params, "driftAngle", 0, 360, 1)
    .name("Drift direction")
    .onChange((deg) => {
      const rad = (deg * Math.PI) / 180;
      u.uFlowDirection.value.set(Math.cos(rad), Math.sin(rad));
    });
  folder.add(u.uFlowSpeed, "value", 0, 0.3, 0.001).name("Drift speed");
  folder.add(u.uWindVariation, "value", 0, Math.PI, 0.01).name("Wind variation");
  folder.add(u.uWindVariationSpeed, "value", 0, 1, 0.001).name("Wind variation speed");
  folder.add(u.uEdgeSoftness, "value", 0, 0.5, 0.01).name("Edge softness");
  folder.add(u.uGrazingBoost, "value", 0, 3, 0.01).name("Grazing boost");
  folder.add(u.uWobbleAmount, "value", 0, 1, 0.01).name("Wobble amount");
  folder.add(u.uWobbleSpeed, "value", 0, 2, 0.01).name("Wobble speed");
  folder.add(u.uPulseAmount, "value", 0, 1, 0.01).name("Pulse amount");
  folder.add(u.uPulseSpeed, "value", 0, 2, 0.01).name("Pulse speed");
  folder.add(u.uBobAmount, "value", 0, 1, 0.01).name("Rise/fall amount");
  folder.add(u.uBobSpeed, "value", 0, 2, 0.01).name("Rise/fall speed");

  if (mesh) {
    addPositionFolder(folder, mesh, range);
    const scale = folder.addFolder("Scale");
    const s = mesh.scale;
    const scaleRange = (base) => [Math.abs(base) * 0.1, Math.abs(base) * 5, Math.abs(base) / 1000];
    scale.add(s, "x", ...scaleRange(s.x || 1)).name("Scale X");
    scale.add(s, "y", ...scaleRange(s.y || 1)).name("Scale Y");
    scale.add(s, "z", ...scaleRange(s.z || 1)).name("Scale Z");
  }
  return folder;
};

export const addDropletGui = (parent, { material, mesh, range, label = "Water droplets" }) => {
  if (!material) return;
  const u = material.uniforms;
  const params = { color: `#${u.uColor.value.getHexString()}` };
  const f = parent.addFolder(label);
  f.addColor(params, "color")
    .name("Color")
    .onChange((v) => u.uColor.value.set(v));
  f.add(u.uOpacity, "value", 0, 1, 0.01).name("Opacity");
  f.add(u.uBaseAlpha, "value", 0, 1, 0.01).name("Transparency");
  f.add(u.uSpeed, "value", 0, 20, 0.01).name("Speed");
  f.add(u.uDensity, "value", 0.3, 3, 0.05).name("Density");

  if (mesh) {
    const p = mesh.position;
    const s = mesh.scale;
    const scaleRange = (base) => [Math.abs(base) * 0.05, Math.abs(base) * 4, Math.abs(base) / 1000];
    f.add(p, "x", p.x - range, p.x + range, range / 1000).name("Position X");
    f.add(p, "y", p.y - range, p.y + range, range / 1000).name("Position Y");
    f.add(p, "z", p.z - range, p.z + range, range / 1000).name("Position Z");
    f.add(s, "x", ...scaleRange(s.x || 1)).name("Scale X");
    f.add(s, "y", ...scaleRange(s.y || 1)).name("Scale Y");
    f.add(s, "z", ...scaleRange(s.z || 1)).name("Scale Z");
  }
  return f;
};

// Neon fixtures + background walls both use the same overbright-color trick
// (color pushed past white so UnrealBloomPass reads it as emissive) — one
// "Emissive intensity" slider on material.color's scalar.
export const addEmissiveGui = (parent, { material, mesh, range, label }) => {
  if (!material) return;
  const folder = parent.addFolder(label);
  const params = { intensity: material.color.r };
  folder
    .add(params, "intensity", 0, 4, 0.01)
    .name("Emissive intensity")
    .onChange((v) => material.color.setScalar(v));
  if (mesh) addPositionFolder(folder, mesh, range);
  return folder;
};

export const addGlassGui = (parent, { material, glassParams, label = "Glass" }) => {
  if (!material) return;
  const folder = parent.addFolder(label);
  const params = { ...glassParams };
  folder.add(material, "opacity", 0, 1, 0.01).name("Opacity");
  folder.add(material, "roughness", 0, 1, 0.01).name("Roughness");
  folder
    .add(params, "reflectivity", 0, 1, 0.01)
    .name("Reflectivity")
    .onChange((v) => {
      if (material.userData.shader) material.userData.shader.uniforms.uGlassReflectivity.value = v;
    });
  folder
    .add(params, "fresnelPower", 0.5, 8, 0.1)
    .name("Fresnel power")
    .onChange((v) => {
      if (material.userData.shader) material.userData.shader.uniforms.uGlassFresnelPower.value = v;
    });
  folder
    .addColor(params, "envLow")
    .name("Env color (low)")
    .onChange((v) => {
      if (material.userData.shader) material.userData.shader.uniforms.uGlassEnvLow.value.set(v);
    });
  folder
    .addColor(params, "envHigh")
    .name("Env color (high)")
    .onChange((v) => {
      if (material.userData.shader) material.userData.shader.uniforms.uGlassEnvHigh.value.set(v);
    });
  return folder;
};

export const addTransformGui = (parent, { object, range, label = "Transform" }) => {
  if (!object) return;
  const folder = parent.addFolder(label);
  addPositionFolder(folder, object, range);
  const baseScale = object.scale.x || 1;
  const scaleParams = { scale: baseScale };
  folder
    .add(scaleParams, "scale", baseScale * 0.1, baseScale * 5, baseScale / 1000)
    .name("Scale")
    .onChange((v) => object.scale.setScalar(v));
  return folder;
};
