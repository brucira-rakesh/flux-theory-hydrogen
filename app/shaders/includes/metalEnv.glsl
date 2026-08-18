// =============================================================================
//  metalEnv.glsl  —  Shared liquid-metal shading for the splash meshes (NEW)
// -----------------------------------------------------------------------------
//  The sea fragment shader keeps its own inline copy of this look (so its
//  visuals are guaranteed untouched). This module is a faithful re-packaging of
//  that same environment + fresnel + metallic-glint model, exposed as a helper
//  the NEW crown / droplet shaders call so the splash inherits the exact same
//  metallic reflections, roughness feel, fresnel and sun glint.
//
//  It declares the environment/light uniforms here; the splash shaders share
//  the very same uniform objects (by reference, from Seawave.jsx) as the sea,
//  so tuning the sea in the GUI retints the splash automatically.
// =============================================================================

uniform vec3  uDepthColor;
uniform vec3  uSurfaceColor;

uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uSunSharpness;

uniform vec3  uSkyColor;
uniform vec3  uHorizonColor;
uniform vec3  uGroundColor;
uniform float uSkyGradient;
uniform float uGroundGradient;

uniform float uFresnelPower;
uniform float uFresnelBias;
uniform float uSpecularStrength;
uniform float uShininess;

uniform vec3  uLightPosition;
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform float uMetalShininess;

// Procedural studio environment sampled by a reflection ray — identical model
// to the sea's environment(): bright-sky / dark-ground gradient with a hot sun.
vec3 metalEnvironment(vec3 dir) {
    vec3 col;
    if (dir.y > 0.0) {
        col = mix(uHorizonColor, uSkyColor, pow(dir.y, uSkyGradient));
    } else {
        col = mix(uHorizonColor, uGroundColor, pow(-dir.y, uGroundGradient));
    }
    float sun = pow(max(dot(dir, normalize(uSunDirection)), 0.0), uSunSharpness);
    col += uSunColor * sun * uSunIntensity;
    return col;
}

// Full metallic shade for a splash surface point. `tint` is the metal albedo
// (crest vs. trough colour) so the caller can bias bright/dark like the sea.
vec3 metalShade(vec3 worldPos, vec3 normal, vec3 tint) {
    vec3 viewDir = normalize(cameraPosition - worldPos);
    vec3 reflectDir = reflect(-viewDir, normal);

    vec3 env = metalEnvironment(reflectDir);
    vec3 reflection = env * tint;

    // Fresnel toward an untinted mirror at grazing angles.
    float fresnel = pow(clamp(1.0 - max(dot(viewDir, normal), 0.0), 0.0, 1.0), uFresnelPower);
    fresnel = clamp(uFresnelBias + (1.0 - uFresnelBias) * fresnel, 0.0, 1.0);
    vec3 color = mix(reflection, env, fresnel);

    // Sharp sun specular.
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfDir = normalize(sunDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), uShininess) * uSpecularStrength;
    color += uSunColor * spec;

    // Travelling glint from the positioned metal light (tinted, like the sea).
    vec3 lightDir = normalize(uLightPosition - worldPos);
    vec3 lightHalf = normalize(lightDir + viewDir);
    float metalSpec = pow(max(dot(normal, lightHalf), 0.0), uMetalShininess);
    color += uLightColor * metalSpec * uLightIntensity * tint;

    return color;
}
