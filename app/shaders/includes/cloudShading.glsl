// Shared "premium dusk sky" cloud colour grading, used by every cloud layer
// in the scene (clouds/fragment.glsl, planeClouds/fragment.glsl) so
// differently-authored assets — each with their own reference-texture
// packing — still read as one consistent sky. Callers reduce their own
// texture data down to a single 0..1 `density` scalar; this turns that into
// the actual soft-cloud alpha (via `alpha`) and the sky-tinted body colour
// (the return value).
vec3 shadeCloud(
  float density,
  vec3 N,
  vec3 L,
  vec3 skyTopColor,
  vec3 skyHorizonColor,
  float heightT,
  vec3 sunColor,
  vec3 accentWarm,
  vec3 accentCool,
  float silverStrength,
  float shadowDepth,
  // Per-layer knobs, both neutral at their default (1.0 / 0.0) so a layer
  // that doesn't pass them renders identically to before. `solidity` scales
  // the base alpha up/down — >1 reads less transparent — before callers
  // multiply in their own coverage/key/instance-fade terms. `coolTint`
  // blends the body toward `accentCool` for a moodier, more blue-violet
  // cast, independent of the existing height-based accentCool wash below.
  float solidity,
  float coolTint,
  out float alpha
) {
  // Wider feather bands than a plain "solid core, thin rim" split — each
  // ramps gradually over a broad density range instead of snapping, so the
  // cloud-to-sky boundary fades out rather than cutting off.
  float core = smoothstep(0.22, 0.8, density);
  float wisp = smoothstep(0.02, 0.42, density) * (1.0 - core);
  float edgeFactor = 1.0 - smoothstep(0.04, 0.78, density);

  // Gentle alpha — long soft tail on wisps, no hard cutoff band. Callers
  // multiply in their own coverage/key/instance-fade terms afterwards.
  alpha = clamp((core * 0.82 + wisp * 0.38 + edgeFactor * 0.14) * solidity, 0.0, 1.0);

  // Internal luminance structure — the reference atlas density drives light
  // grey ↔ bright white variation so the cloud body reads textured rather
  // than a flat white cutout.
  vec3 cloudGrey = vec3(0.66, 0.69, 0.74);
  vec3 cloudWhite = vec3(0.88, 0.90, 0.93);
  float luminanceVar = smoothstep(0.06, 0.88, density);
  float fineDetail = smoothstep(0.18, 0.52, density) * (1.0 - smoothstep(0.52, 0.92, density));
  vec3 texturedBase = mix(cloudGrey, cloudWhite, luminanceVar);
  texturedBase = mix(texturedBase, mix(cloudGrey, texturedBase, 0.72), fineDetail * 0.55);

  // Body tint follows the sky gradient; fringes always lean light (horizon),
  // never the dark zenith — using topColor at edges caused grey/black halos.
  vec3 skyBase = mix(skyHorizonColor, skyTopColor, pow(heightT, 0.82));
  vec3 lightSky = mix(skyHorizonColor, vec3(0.94), 0.42);

  float sunFacing = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);

  vec3 highlight = mix(texturedBase, mix(lightSky, sunColor, 0.38), 0.65) + vec3(0.06);
  vec3 shadow = mix(texturedBase * 0.82, mix(texturedBase, skyBase, 0.35), 0.55);
  float shade = mix(1.0 - shadowDepth * 0.55, 1.0, sunFacing);

  // Core keeps depth; edges are pushed toward bright wispy tones only.
  vec3 body = mix(shadow, highlight, shade * mix(0.88, 1.0, core));
  vec3 softEdge = mix(lightSky, highlight, 0.82) + vec3(0.08);
  softEdge += sunColor * sunFacing * 0.14;
  body = mix(body, softEdge, edgeFactor * 0.88);

  float edgeGlow = (wisp + edgeFactor * 0.65) * mix(0.55, silverStrength + 0.28, sunFacing);
  body += mix(vec3(0.88), sunColor, sunFacing * 0.32) * edgeGlow * 0.35;

  body = mix(body, body * accentWarm, (1.0 - heightT) * 0.08 * sunFacing);
  body = mix(body, body * accentCool, heightT * 0.04);

  // Low-density fringe: stay light but allow grey sky-tone rather than pure white.
  body = mix(mix(lightSky, cloudGrey, 0.35), body, smoothstep(0.0, 0.58, density));
  body = max(body, mix(cloudGrey, lightSky, 0.45) * 0.48);

  body = mix(body, body * accentCool, coolTint);

  return body;
}
