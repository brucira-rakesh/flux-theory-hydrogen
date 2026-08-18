uniform vec3 uDepthColor;
uniform vec3 uSurfaceColor;
uniform float uColorOffset;
uniform float uColorMultiplier;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uSunSharpness;

uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform float uSkyGradient;
uniform float uGroundGradient;

uniform float uFresnelPower;
uniform float uFresnelBias;
uniform float uSpecularStrength;
uniform float uShininess;
uniform float uDiffuseStrength;

uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uMetalShininess;

// NEW: two coloured accent directional lights, shared with the bottle's real
// THREE.DirectionalLights (driven each frame from Seawave.jsx). They react in
// the sea EXACTLY like uSun* — a reflected coloured disc in environment() plus
// a sharp travelling specular glint — so the orange/purple lights show up in
// the mercury. Each is gated by its own intensity (0 = off in the sea).
uniform vec3 uOrangeDirection;   // direction TOWARD the light (= its position, target at origin)
uniform vec3 uOrangeColor;
uniform float uOrangeIntensity;
uniform vec3 uPurpleDirection;
uniform vec3 uPurpleColor;
uniform float uPurpleIntensity;

varying float vElevation;
varying vec3 vNormal;
varying vec3 vWorldPosition;

// Cheap procedural "studio" environment sampled by a reflection ray. A metal
// only looks like metal because of what it reflects, and there is no env map
// loaded here — so we fake a bright sky / dark ground gradient with a hot sun
// disk. This is what the mercury surface mirrors, and it reads as chrome.
vec3 environment(vec3 dir) {
    vec3 col;
    if (dir.y > 0.0) {
        col = mix(uHorizonColor, uSkyColor, pow(dir.y, uSkyGradient));
    } else {
        col = mix(uHorizonColor, uGroundColor, pow(-dir.y, uGroundGradient));
    }

    float sun = pow(max(dot(dir, normalize(uSunDirection)), 0.0), uSunSharpness);
    col += uSunColor * sun * uSunIntensity;

    // NEW: coloured accent-light discs reflected in the metal, same treatment
    // as the sun disc above.
    float orange = pow(max(dot(dir, normalize(uOrangeDirection)), 0.0), uSunSharpness);
    col += uOrangeColor * orange * uOrangeIntensity;
    float purple = pow(max(dot(dir, normalize(uPurpleDirection)), 0.0), uSunSharpness);
    col += uPurpleColor * purple * uPurpleIntensity;

    return col;
}

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 reflectDir = reflect(-viewDir, normal);

    // Wave-height driven tint: liquid metal isn't a single flat grey — troughs
    // read darker, crests catch more light. This is the metal's own albedo the
    // reflection gets multiplied by.
    float mixStrength = (vElevation + uColorOffset) * uColorMultiplier;
    mixStrength = smoothstep(0.0, 1.0, mixStrength);
    vec3 tint = mix(uDepthColor, uSurfaceColor, mixStrength);

    vec3 env = environment(reflectDir);
    vec3 reflection = env * tint;

    // Fresnel: at grazing angles the surface becomes a near-perfect (untinted)
    // mirror; face-on it keeps the metal's tint. This is the single biggest
    // cue that sells "polished liquid metal" over "grey plastic".
    float fresnel = pow(clamp(1.0 - max(dot(viewDir, normal), 0.0), 0.0, 1.0), uFresnelPower);
    fresnel = clamp(uFresnelBias + (1.0 - uFresnelBias) * fresnel, 0.0, 1.0);

    vec3 color = mix(reflection, env, fresnel);

    // Sharp specular glint from the sun, plus a faint diffuse so deep troughs
    // never go fully black.
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfDir = normalize(sunDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), uShininess) * uSpecularStrength;
    color += uSunColor * spec;

    float diffuse = max(dot(normal, sunDir), 0.0);
    color += tint * diffuse * uDiffuseStrength;

    // NEW: sharp travelling specular glints from the two accent lights — the
    // same Blinn-Phong the sun uses above, tinted by each light's colour and
    // scaled by its intensity (so intensity 0 removes it from the sea too).
    vec3 orangeDir = normalize(uOrangeDirection);
    vec3 orangeHalf = normalize(orangeDir + viewDir);
    color += uOrangeColor * pow(max(dot(normal, orangeHalf), 0.0), uShininess) * uSpecularStrength * uOrangeIntensity;

    vec3 purpleDir = normalize(uPurpleDirection);
    vec3 purpleHalf = normalize(purpleDir + viewDir);
    color += uPurpleColor * pow(max(dot(normal, purpleHalf), 0.0), uShininess) * uSpecularStrength * uPurpleIntensity;

    // --- Metallic shine from a positioned light source -------------------
    // A real (movable) light whose specular highlight travels across the
    // waves as they roll — the moving glint is what makes it read as living
    // liquid metal. Crucially the highlight is multiplied by `tint`: metals
    // colour their specular by their own albedo, so this stays a silvery
    // metal glint instead of a white plastic hotspot.
    vec3 lightDir = normalize(uLightPosition - vWorldPosition);
    vec3 lightHalf = normalize(lightDir + viewDir);
    float metalSpec = pow(max(dot(normal, lightHalf), 0.0), uMetalShininess);
    color += uLightColor * metalSpec * uLightIntensity * tint;

    // Broad wrapped sheen from the same light — a soft brightness gradient
    // across the metal's form so it isn't lit by pinpoint glints alone.
    float wrap = max(dot(normal, lightDir) * 0.5 + 0.5, 0.0);
    color += uLightColor * pow(wrap, 2.0) * uLightIntensity * 0.06 * tint;

    // NOTE: bottle-splash "foam" is intentionally NOT a fragment-side color
    // effect — it's the calculateFoamElevation() bump baked into the vertex
    // displacement (see bottleInteraction.glsl / vertex.glsl). A flat color
    // patch here read as a dull gray smudge against the reflective metal; the
    // churn now catches light exactly like the rest of the sea because it's
    // real geometry, not paint.

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
