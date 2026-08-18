// Scene Two's own copy of seawave.frag — kept separate so tuning it never
// touches Scene One's water. Only change from the original: the edge fade
// now also softens the plane's +X edge (in addition to the existing +Z
// edge), using the same smoothstep pattern duplicated onto the X axis and
// combined by multiplication — fully opaque only where neither has kicked
// in yet, fading out approaching either the +X or +Z side.
uniform float uTime;

// Three.js auto-injects `modelMatrix` into the VERTEX shader prefix only —
// unlike `cameraPosition` below (injected into both), fragment shaders don't
// get it for free. Explicitly declaring it here (same pattern three.js's own
// transmission_pars_fragment chunk uses) is required to rotate the
// tangent-space normal into world space, below.
uniform mat4 modelMatrix;

// Texture maps (from /public/textures/waterwavetex).
uniform sampler2D uNormalMap;
uniform sampler2D uDisplacementMap;
uniform sampler2D uAOMap;
uniform sampler2D uORMMap;
uniform sampler2D uBaseColorMap;
uniform sampler2D uTransmissionMap;

uniform vec2 uTiling; // texture repeats across the plane
// Local-space (X, Z) footprint size of the mesh (max - min of its own
// geometry bounds), set once from the loaded mesh in Scene.jsx. Normalizes
// vLocalPos.xz below into the same "one full traverse of the plane" range a
// clean 0-1 UV unwrap would give, so uTiling keeps its original meaning
// (repeats across the WHOLE plane) regardless of this mesh's own footprint
// size or how — or how badly — it happens to be UV-unwrapped.
uniform vec2 uLocalSize;
uniform vec2 uFlowDirection; // normalized UV-space direction the water drifts toward
uniform float uFlowSpeed; // scroll speed along uFlowDirection
uniform float uNormalStrength; // how strongly the normal map tilts the surface normal
uniform float uDisplacementStrength; // amplifies the (low-contrast) displacement map for the color mix
uniform float uAOStrength; // 0 = ignore AO/ORM maps, 1 = full darkening

uniform vec3 uDepthColor;
uniform vec3 uSurfaceColor;
uniform float uColorOffset;
uniform float uColorMultiplier;

// Reflection (fed from an invisible Reflector's render target). uTextureMatrix
// projects a world-space position into the reflection camera's clip space —
// computed fresh every frame in Scene.jsx from the same reflection camera
// Reflector uses internally — so the lookup is correct for this exact
// fragment's world position, regardless of camera angle, viewport size, or
// any drift between the water mesh's and the Reflector plane's own transforms.
uniform sampler2D uReflectionMap;
uniform mat4 uTextureMatrix;
uniform float uReflectivity;
uniform float uReflectionDistortion;
uniform float uReflectionBlur; // UV-space softening radius; 0 = razor-sharp mirror

// Shiny specular highlight.
uniform float uSpecularStrength;
uniform float uShininess;

// Overall surface transparency.
uniform float uOpacity;

// Edge fade: smoothstep opacity falloff toward the plane's local +Z edge AND
// its local +X edge, so the water blends out on both sides instead of
// ending in a hard cut. All four are local (pre-transform) coordinates,
// independent of the mesh's Position tweak.
uniform float uEdgeFadeStart; // +Z
uniform float uEdgeFadeEnd;
uniform float uEdgeFadeStartX; // +X
uniform float uEdgeFadeEndX;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vLocalPos;

void main() {
  // Tiled from LOCAL XZ position rather than the mesh's own authored UVs.
  // Mainbase.005 (Scene One) was purpose-built with a clean planar 0-1 UV
  // layout, but this mesh (Cylinder012, scenetwov4.glb) is a leftover cap
  // face off a default-primitive cylinder — its UVs are squashed into a
  // small, near-constant corner of UV space (Blender's default cylinder
  // unwrap crams caps into a tiny circle instead of spanning 0-1). Sampling
  // a tiling normal map through that lands on nearly the same texel
  // everywhere, so no ripple perturbation ever showed up — just the flat
  // planar reflection, reading as a plain mirror. Local XZ is guaranteed to
  // vary smoothly and fully across the whole flat disc, with no seam (unlike
  // a radial/cylindrical UV), so it tiles correctly regardless of how the
  // mesh happens to be unwrapped. Dividing by uLocalSize first turns it into
  // a "0 = one edge, 1 = the opposite edge" range, exactly like a clean 0-1
  // UV unwrap would give — so uTiling produces the same ripple density/scale
  // as Scene One's Mainbase.005, independent of this plane's own footprint.
  vec2 uv = (vLocalPos.xz / uLocalSize) * uTiling;
  vec2 flow = uFlowDirection * uTime * uFlowSpeed;

  // Two scrolling samples of the same normal map, both biased along
  // uFlowDirection (so ripples visibly drift that way) but offset in
  // scale/phase from each other so the tiling never reads as a single
  // repeating pattern.
  vec2 uv1 = uv + flow;
  vec2 uv2 = uv * 1.7 + flow * 1.6 + vec2(-uFlowDirection.y, uFlowDirection.x) * 0.35;

  vec3 t1 = texture2D(uNormalMap, uv1).rgb * 2.0 - 1.0;
  vec3 t2 = texture2D(uNormalMap, uv2).rgb * 2.0 - 1.0;
  vec2 tN = (t1.xy + t2.xy) * 0.5;

  // Tangent space -> LOCAL space: the flat plane's own basis is T=+X, B=+Z,
  // N=+Y, so the map's tangent/bitangent components tilt the local normal
  // off vertical by uNormalStrength.
  vec3 N = normalize(vec3(tN.x * uNormalStrength, 1.0, tN.y * uNormalStrength));

  // Local -> world space: this mesh can now spin (the carousel rotates its
  // holder Group during scroll-snap transitions), so its local +X/+Z axes no
  // longer always line up with world +X/+Z the way they do at rest (rotation
  // 0). Without this, N kept using its rest-pose direction regardless of the
  // mesh's actual current rotation — every dot(N, ...)/N.xz use below was
  // then wrong mid-spin (reflection distortion, fresnel, specular), which is
  // what read as the reflection/specular glitching only during the carousel
  // animation and looking correct again once a scene settled back to rest.
  N = normalize(mat3(modelMatrix) * N);

  // The whole surface pattern (not just the ripple normal) drifts along
  // uFlowDirection too, at half the ripple speed, so the color/AO detail
  // visibly travels with the water instead of staying pinned in place.
  vec2 flowUv = uv + flow * 0.5;

  // Displacement map re-purposed as a "wave field" pattern driving the
  // depth/surface color mix, since real geometric elevation is intentionally
  // disabled. The source map is low-contrast (values cluster near mid-gray),
  // so uDisplacementStrength amplifies it back up to a usable range.
  float waveField = (texture2D(uDisplacementMap, flowUv).r - 0.5) * uDisplacementStrength;
  float mixStrength = clamp((waveField + uColorOffset) * uColorMultiplier, 0.0, 1.0);
  vec3 waterColor = mix(uDepthColor, uSurfaceColor, mixStrength);

  // Base color map tints the water color. The supplied texture is a flat,
  // near-white map with almost no data, so its visible effect is subtle
  // until a higher-contrast base color texture replaces it.
  waterColor *= texture2D(uBaseColorMap, flowUv).rgb;

  // Ambient occlusion darkens the crevice pattern. uORMMap only carries
  // usable data in its red channel here — its green/blue (roughness/
  // metalness) come from a mismatched packing with no reliable signal — so
  // both AO sources are combined through their red channels only.
  float ao = texture2D(uAOMap, flowUv).r * texture2D(uORMMap, flowUv).r;
  waterColor *= mix(1.0, ao, uAOStrength);

  // True planar reflection: project this fragment's actual world position
  // through the reflection camera (uTextureMatrix), then perspective-divide
  // by .w — the standard projective-texture-mapping technique, correct for
  // any camera angle/position. Rippled by the normal-map perturbation, and
  // clamped so the distortion never samples past the render target's edge
  // (which would smear the last column/row of pixels across the water
  // instead of just softly blurring).
  vec4 reflectClip = uTextureMatrix * vec4(vWorldPos, 1.0);
  vec2 screenUv = clamp(reflectClip.xy / reflectClip.w + N.xz * uReflectionDistortion, 0.001, 0.999);

  // Real water is never a perfectly sharp mirror — a small 4-tap box blur
  // (offset by uReflectionBlur, in UV space) softens it into a more premium,
  // slightly-diffuse reflection instead of a razor-sharp one.
  vec3 reflectionColor = texture2D(uReflectionMap, screenUv).rgb;
  reflectionColor += texture2D(uReflectionMap, screenUv + vec2(uReflectionBlur, uReflectionBlur)).rgb;
  reflectionColor += texture2D(uReflectionMap, screenUv + vec2(-uReflectionBlur, uReflectionBlur)).rgb;
  reflectionColor += texture2D(uReflectionMap, screenUv + vec2(uReflectionBlur, -uReflectionBlur)).rgb;
  reflectionColor += texture2D(uReflectionMap, screenUv + vec2(-uReflectionBlur, -uReflectionBlur)).rgb;
  reflectionColor *= 0.2;
  // Reflection target is linear; approximate sRGB so it matches the water colors.
  reflectionColor = pow(clamp(reflectionColor, 0.0, 1.0), vec3(1.0 / 2.2));

  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N; // keep the normal facing the camera

  // Fresnel: more reflection at grazing angles.
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float reflAmount = clamp(uReflectivity * (0.15 + 0.85 * fres), 0.0, 1.0);

  vec3 color = mix(waterColor, reflectionColor, reflAmount);

  // Shiny sun glint (Blinn-Phong specular) off the texture-perturbed normal.
  vec3 L = normalize(vec3(0.5, 0.8, 0.3));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecularStrength;
  color += spec;

  // Transmission map modulates opacity (also near-blank in the supplied
  // texture, so this currently stays close to uOpacity everywhere).
  float transmission = texture2D(uTransmissionMap, flowUv).r;

  // Smoothstep fade to fully transparent as the surface approaches its own
  // +Z edge, and independently as it approaches its own +X edge — combined
  // by multiplication so it's fully opaque only where neither has started.
  float edgeFadeZ = 1.0 - smoothstep(uEdgeFadeStart, uEdgeFadeEnd, vLocalPos.z);
  float edgeFadeX = 1.0 - smoothstep(uEdgeFadeStartX, uEdgeFadeEndX, vLocalPos.x);
  float edgeFade = edgeFadeZ * edgeFadeX;

  gl_FragColor = vec4(color, uOpacity * transmission * edgeFade);
}
