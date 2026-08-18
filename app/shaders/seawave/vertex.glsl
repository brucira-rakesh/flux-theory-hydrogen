uniform float uTime;
uniform float uBigWavesElevation;
uniform vec2 uBigWavesFrequency;
uniform float uBigWavesSpeed;
uniform float uBigWavesSteepness;

uniform float uSmallWavesElevation;
uniform float uSmallWavesFrequency;
uniform float uSmallWavesSpeed;
uniform float uSmallIterations;

varying float vElevation;
varying vec3 vNormal;
varying vec3 vWorldPosition;

#include ../includes/perlinClassic3D.glsl
// NEW: bottle→ocean coupling (influence mask, collar bulge, splash ring,
// ripples). Declares the bottle uniforms and adds nothing unless a bottle is
// interacting, so the base ocean is unchanged.
#include ../includes/bottleInteraction.glsl

// A single Gerstner (trochoidal) wave. Unlike a plain height wave — which only
// moves a vertex up and down — a Gerstner wave also pushes the vertex
// HORIZONTALLY along its own direction, so each surface point traces a small
// circle over time. That circular orbit is the physics that makes the surface
// read as flowing liquid rather than a plane bobbing in place. Returns the full
// (x, y, z) displacement so the caller can move the vertex in all three axes.
//
//   uBigWavesSteepness (Q) controls how much of that horizontal X/Z motion
//   there is: 0 = pure vertical height field, ~1 = fully rounded, fluid orbits
//   (push past 1 and crests loop over themselves, so it's clamped in the GUI).
vec3 gerstnerWave(vec2 dir, float frequency, float speed, float amplitude, vec2 pos) {
    vec2 d = normalize(dir);
    float phase = dot(d, pos) * frequency + uTime * speed;
    float c = cos(phase);
    float s = sin(phase);
    return vec3(
        uBigWavesSteepness * amplitude * d.x * c, // x flow
        amplitude * s,                            // y elevation
        uBigWavesSteepness * amplitude * d.y * c  // z flow
    );
}

// Total surface displacement: several crossing Gerstner waves whose
// interference gives a smooth, non-repeating, fluid roll (the "mixing ripple"),
// plus a very gentle perlin shimmer on top to break the reflections into a
// soft metallic sparkle. Deliberately smooth and slow — this is molten/mercury
// flow, not a choppy sea, so the perlin term is smooth (no |abs| ridges) and
// small.
vec3 getDisplacement(vec2 pos) {
    vec3 displacement = vec3(0.0);

    // A small spectrum: each successive wave crosses at a wider angle, runs a
    // little faster and higher-frequency, and contributes less amplitude.
    displacement += gerstnerWave(vec2( 1.0,  0.3), uBigWavesFrequency.x,       uBigWavesSpeed,        uBigWavesElevation,        pos);
    displacement += gerstnerWave(vec2(-0.4,  1.0), uBigWavesFrequency.y,       uBigWavesSpeed * 0.9,  uBigWavesElevation * 0.7,  pos);
    displacement += gerstnerWave(vec2( 0.7, -0.8), uBigWavesFrequency.x * 1.7, uBigWavesSpeed * 1.15, uBigWavesElevation * 0.45, pos);
    displacement += gerstnerWave(vec2(-1.0, -0.2), uBigWavesFrequency.y * 2.3, uBigWavesSpeed * 0.8,  uBigWavesElevation * 0.30, pos);

    // Gentle smooth ripple — just enough surface micro-relief to shimmer.
    float ripple = 0.0;
    for (float i = 1.0; i <= uSmallIterations; i++) {
        ripple += perlinClassic3D(vec3(pos * uSmallWavesFrequency * i, uTime * uSmallWavesSpeed))
                * (uSmallWavesElevation / i);
    }
    displacement.y += ripple;

    // NEW: layer the bottle's water reaction on top of the existing ocean.
    // Adding it INSIDE getDisplacement is deliberate — the normal below is
    // rebuilt from finite differences of getDisplacement(), so the collar,
    // splash ring and ripples all get correct metallic normals for free.
    displacement += bottleDisplacement(pos, uTime);

    return displacement;
}

void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec2 gridPos = modelPosition.xz;

    // Displace in all three axes (x/z flow + y elevation).
    vec3 displacement = getDisplacement(gridPos);
    modelPosition.xyz += displacement;

    // Rebuild the normal from finite differences of the FULL displaced surface.
    // Because the Gerstner term slides the surface horizontally, an
    // elevation-only normal would be wrong — so we evaluate the complete (x,y,z)
    // displaced position at two neighbouring grid points and cross the
    // resulting world-space tangents.
    float shift = 0.01;
    vec3 pA = vec3(gridPos.x, 0.0, gridPos.y) + displacement;
    vec3 pB = vec3(gridPos.x + shift, 0.0, gridPos.y) + getDisplacement(gridPos + vec2(shift, 0.0));
    vec3 pC = vec3(gridPos.x, 0.0, gridPos.y + shift) + getDisplacement(gridPos + vec2(0.0, shift));
    vec3 normal = normalize(cross(pC - pA, pB - pA));

    vElevation = displacement.y;
    vNormal = normal;
    vWorldPosition = modelPosition.xyz;

    gl_Position = projectionMatrix * viewMatrix * modelPosition;
}
