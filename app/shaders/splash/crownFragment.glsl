// =============================================================================
//  crownFragment.glsl  —  Splash crown shading (NEW)
// -----------------------------------------------------------------------------
//  Shades the raised sheets with the SAME liquid-metal model as the sea (via the
//  shared metalEnv module) so the splash reads as the same mercury, not a
//  separate transparent-water pass. Alpha handles only the spawn/despawn
//  lifecycle — the visible sheet stays fully metallic.
// =============================================================================
varying vec3  vWorldPosition;
varying vec3  vNormal;
varying float vAlpha;
varying float vCrest;

#include ../includes/metalEnv.glsl

void main() {
    if (vAlpha <= 0.002) discard;   // nothing to draw where the sheet has faded

    // Thin double-sided sheets: make the normal always face the camera so both
    // faces catch reflections.
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;

    // Slightly brighter metal albedo than the deep sea — a lifted crest.
    vec3 tint = mix(uDepthColor, uSurfaceColor, 0.8);
    vec3 color = metalShade(vWorldPosition, n, tint);

    // Foamy white catches on the thin tearing tips of the sheets.
    color = mix(color, uSurfaceColor * 1.9 + 0.12, vCrest * 0.5);

    gl_FragColor = vec4(color, vAlpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
