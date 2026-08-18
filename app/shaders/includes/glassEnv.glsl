// =============================================================================
//  glassEnv.glsl — cheap procedural reflection for thin glass panels
// -----------------------------------------------------------------------------
//  Spliced onto a MeshPhysicalMaterial via onBeforeCompile (see the glassMaterial
//  factory in Scene.jsx, used for Scene Four's LeftGlass/RightSmallGlass/
//  RightBigGlass shower panels). This scene has no scene.environment, so the
//  material's own PBR specular/reflection would render flat and dark with
//  nothing to reflect (the same trap the bottle's chrome coating avoids — see
//  coatingChunk.glsl/chromeEnv.glsl). This fakes a bright, fresnel-driven sky
//  reflection with NO extra render target, texture, or PMREM — just a mix() of
//  two colours by view angle plus a sun-glint term, composited on top of the
//  already-lit, already-transparent glass colour right before tonemapping.
//  Real transmission (MeshPhysicalMaterial.transmission) was deliberately
//  avoided: it forces a full scene re-render into a transmission buffer every
//  frame per unique roughness, which this scene (already paying for four live
//  planar water reflections + bloom) can't afford for three static panels.
// =============================================================================
uniform vec3  uGlassEnvLow;         // reflection colour looking down/away from the light
uniform vec3  uGlassEnvHigh;        // reflection colour looking up/toward the light
uniform vec3  uGlassSunDir;         // world-space direction toward the key highlight
uniform vec3  uGlassSunColor;
uniform float uGlassReflectivity;   // base reflectivity at normal incidence (0..1)
uniform float uGlassFresnelPower;   // how sharply reflectivity ramps up at grazing angles

varying vec3 vGlassWorldPos;
varying vec3 vGlassWorldNormal;

vec3 glassEnvironment(vec3 dir) {
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uGlassEnvLow, uGlassEnvHigh, up);
    float sun = pow(max(dot(dir, normalize(uGlassSunDir)), 0.0), 80.0);
    col += uGlassSunColor * sun;
    return col;
}

// Composite the fresnel-driven reflection over the already-lit, already-
// transparent base colour. More reflective at grazing angles, more see-through
// straight-on — the single visual cue that reads as glass rather than tinted
// plastic film.
vec3 glassShade(vec3 baseColor) {
    vec3 n = normalize(vGlassWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vGlassWorldPos);
    vec3 refl = reflect(-viewDir, n);
    vec3 env = glassEnvironment(refl);
    float fres = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), uGlassFresnelPower);
    float amount = clamp(uGlassReflectivity + fres * (1.0 - uGlassReflectivity), 0.0, 1.0);
    return mix(baseColor, env, amount);
}
