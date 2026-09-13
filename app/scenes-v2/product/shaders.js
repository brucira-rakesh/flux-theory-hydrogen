// Selective-blur render pipeline shaders, ported verbatim from
// src/pages/Product.jsx (see that file for the full pass-by-pass
// pipeline explanation: mask -> feather -> background blur -> composite).

export const maskVertexShader = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const maskFragmentShader = /* glsl */ `
  void main() {
    gl_FragColor = vec4(1.0);
  }
`;
export const selectiveBlurVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
// A true analytic Gaussian (not the fixed-weight/offset "optimized 5-tap"
// approximation, which only looks right at the one radius it was tuned
// for — scale its offsets up for a bigger blur and the same 5 samples just
// spread further apart, reading as banding/ghosting instead of a smooth
// blur). Here SAMPLES taps per side are spread evenly across the FULL
// requested radius and weighted by the actual Gaussian falloff (sigma tied
// to that same radius), so the kernel stays well-sampled and smooth no
// matter how large uRadius gets. uRadius === 0 collapses every offset to 0,
// so every tap samples the same texel and the pass is a lossless copy of
// its input — this is what makes amount = 0 read as perfectly sharp.
export const blurFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  uniform float uRadius;
  const int SAMPLES = 8;
  void main() {
    float sigma = max(uRadius * 0.5, 0.0001);
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    for (int i = -SAMPLES; i <= SAMPLES; i++) {
      float offset = (float(i) / float(SAMPLES)) * uRadius;
      float weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
      color += texture2D(tDiffuse, vUv + uDirection * offset) * weight;
      totalWeight += weight;
    }
    gl_FragColor = color / totalWeight;
  }
`;

// linearToOutputTexel() needs no declaration/import: three.js's WebGLProgram
// auto-injects it into every ShaderMaterial's fragment shader, matched to
// the CURRENT render target (identity when rendering into an RT, real
// linear->sRGB when rendering to the canvas) — the same mechanism built-in
// materials rely on. This is the only pass that ever renders straight to
// the canvas, so it's the only one that needs the call. `tMask` here is
// already the FEATHERED mask, so the mix itself softens gradually across
// the boundary rather than snapping. uTintColor/uTintStrength wash the
// BLURRED region only — applied before the sharp/blur mix, so the clicked
// bottle itself is never tinted.
//
// HDR resolve pass: HDR sceneRT -> LDR sceneLdrRT, run once right after the
// scene render and BEFORE the mask/blur passes.
//
// Deliberately a CLAMP, not a tone map. three.js applies the renderer's tone
// mapping ONLY when a material renders straight to the canvas — see
// WebGLPrograms.js, which pins the compiled shader's toneMapping to
// NoToneMapping whenever `currentRenderTarget !== null` — so anything
// rendered into sceneRT comes out raw, untonemapped linear HDR. The question
// is what to resolve it WITH, and the answer has to match the OTHER renderer
// sharing this canvas, not some standalone ideal.
//
// That other renderer is PostFXV2, which owns the frame whenever no bottle
// is revealed (see its own `productActiveRef && productRevealed` bail-out).
// Its postprocessing EffectComposer also renders the scene into a render
// target — so its materials skip tone mapping too — and its chain carries NO
// ToneMappingEffect, so what it finally puts on screen is simply clamped
// linear converted to sRGB. Applying ACES here instead meant the exact same
// room rendered through two different curves depending only on whether a
// bottle happened to be revealed: ACES lifts blacks and rolls off
// highlights, so the whole background visibly washed out and lost contrast
// the instant a bottle was clicked and PostFXV2 handed the frame over. The
// room is already excluded from bloom (see useProductAssets), so tone
// mapping was the ONLY thing separating the two paths' background — and
// matching it here is what makes a reveal look like the shelf view with the
// background blurred, and nothing else changed.
//
// Clamping still has to happen HERE rather than in the composite at the end,
// because the blur sits between the two. The bottle light runs at intensity
// 10, so untonemapped highlights reach ~5-10, and convolving THOSE into
// neighbouring darks dumps enormous energy into them — a contact shadow next
// to the lit counter lifts from roughly 0.48 to 0.93 and washes out to pale
// grey. Clamping to display range first is what stops the blur bleeding
// energy that will never be displayed anyway; it is also exactly the range
// PostFXV2's own 8-bit canvas write clamps to, so the two agree.
export const toneMapResolveFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  void main() {
    gl_FragColor = clamp(texture2D(tDiffuse, vUv), 0.0, 1.0);
  }
`;
// Deliberately does NOT tone map: tScene/tBlur are both fed from
// sceneLdrRT, which toneMapResolveFragmentShader above already resolved, so
// doing it again here would apply the curve twice. `tMask` is the FEATHERED
// mask, so the mix softens gradually across the boundary rather than
// snapping. uTintColor/uTintStrength wash the BLURRED region only — applied
// before the sharp/blur mix, so the clicked bottle itself is never tinted.
export const compositeFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBlur;
  uniform sampler2D tMask;
  uniform vec3 uTintColor;
  uniform float uTintStrength;
  void main() {
    vec4 sharpColor = texture2D(tScene, vUv);
    vec4 blurredColor = texture2D(tBlur, vUv);
    blurredColor.rgb = mix(blurredColor.rgb, uTintColor, uTintStrength);
    float keepSharp = texture2D(tMask, vUv).r;
    gl_FragColor = mix(blurredColor, sharpColor, keepSharp);
    gl_FragColor = linearToOutputTexel(gl_FragColor);
  }
`;
