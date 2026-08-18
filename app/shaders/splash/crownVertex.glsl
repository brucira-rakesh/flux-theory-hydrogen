// =============================================================================
//  crownVertex.glsl  —  Splash crown / vertical water sheets (NEW)
// -----------------------------------------------------------------------------
//  A flat annulus mesh (built in Seawave.jsx, lying in the XZ plane and parented
//  to the bottle's waterline) is raised in this shader into a ring of wobbling,
//  asymmetric vertical sheets — the "crown splash" a body makes punching through
//  a liquid surface. The sheet ring expands outward and gravity pulls it back
//  over its short life. No particles, no simulation: one draw call, pure math.
// =============================================================================
uniform float uTime;
uniform float uCrownHeight;   // world-units tall the sheets can reach

varying vec3  vWorldPosition;
varying vec3  vNormal;
varying float vAlpha;         // 0 where there is no sheet (fully faded)
varying float vCrest;         // 0..1 how close to the thin sheet tip (for foam)

// bottle uniforms + noise helpers (biValueNoise, uImpactStrength, uBottleRadius…)
#include ../includes/bottleInteraction.glsl

// Normalised crown height 0..1 at a local XZ (relative to the bottle axis).
// Kept separate so the vertex can finite-difference it for a real normal.
float crownShape(vec2 p, float age) {
    if (age < 0.0) return 0.0;

    float r  = length(p);
    float rn = r / max(uBottleRadius, 1e-3);      // radius in bottle-radii
    float ang = atan(p.y, p.x);

    // The sheet wall sits just outside the hull and races outward with age.
    float wallR = 1.05 + age * 1.5;
    float ridge = exp(-pow((rn - wallR) * 1.4, 2.0));

    // Life: build up, then gravity drags it back down (~1.7s total). The rise
    // window was widened (0.12s → 0.22s) so the sheets visibly grow instead
    // of appearing at full height in a single "bombard" pop.
    float rise = smoothstep(0.0, 0.22, age);
    float fall = 1.0 - smoothstep(0.55, 1.7, age);
    float life = rise * fall;

    // Break the ring into discrete sheets of varying height + wobble so it
    // never reads as a perfect CG cylinder — this is where "elegant, heavy"
    // rather than "uniform explosion" comes from.
    float sheets = 0.5 + 0.5 * sin(ang * 9.0 + biValueNoise(vec2(ang * 3.0, age * 1.2)) * 6.2831);
    float wob    = 0.55 + 0.7 * biValueNoise(vec2(ang * 4.0, age * 1.6));

    // No opacity floor here (was mix(0.35, 1.0, sheets)) — the gaps between
    // sheets now genuinely reach 0 instead of a translucent 35% haze.
    return ridge * life * sheets * wob;
}

void main() {
    float age = (uImpactTime >= 0.0) ? (uTime - uImpactTime) : -1.0;
    float amp = uCrownHeight * uImpactStrength;

    vec2 p = position.xz;                 // geometry is centred on the bottle axis
    float s = crownShape(p, age);
    float h = amp * s;

    // The lip curls outward as it rises.
    float r = length(p);
    vec2 dir = r > 1e-4 ? p / r : vec2(0.0);
    vec2 spread = dir * h * 0.35;

    vec3 displaced = vec3(position.x + spread.x, position.y + h, position.z + spread.y);

    // Rebuild the normal from finite differences of the raised sheet.
    float e = 0.03;
    float hx = amp * crownShape(p + vec2(e, 0.0), age);
    float hz = amp * crownShape(p + vec2(0.0, e), age);
    vec3 tX = vec3(e, hx - h, 0.0);
    vec3 tZ = vec3(0.0, hz - h, e);
    vec3 n = normalize(cross(tZ, tX));

    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);

    // Fade at the geometry's inner/outer edges so the annulus never shows a hard
    // rim, and drop to zero where there's no sheet.
    float rn = r / max(uBottleRadius, 1e-3);
    float edge = smoothstep(0.0, 0.5, rn) * (1.0 - smoothstep(4.5, 6.0, rn));
    vAlpha = clamp(s, 0.0, 1.0) * edge * uInteractionEnabled;
    vCrest = clamp(h * 2.5, 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * world;
}
