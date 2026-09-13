// FooterWaterGlass main pass — procedural water on the footer's background
// photo, entirely GPU-resident (no geometry or particles per droplet).
//
// Two techniques, one surface. Every source of water — the condensation
// beaded on the glass, the drops running down it, and the water the pointer
// gathers — is written into a single HEIGHT FIELD, and that one field is
// shaded once. Merging in the field rather than compositing sprites is what
// makes the sources behave like the same liquid: heights combine with a
// polynomial smooth max, so two beads that touch bulge into one connected
// surface (metaballs), and a running drop rolling through the mist swallows
// the beads it passes over instead of drawing on top of them.
//
// The photo (footer-bg.webp) already has its own baked-in fine condensation
// texture — this pass is not replicating that grain, it is adding water that
// moves and answers the pointer on top of it.
//
// Sources, in the order main() merges them:
//   condensation() — two voronoi layers of static beads, shrunk to nothing
//                    under the pointer's swept channel, regrowing behind it
//   rain()         — one accelerating drop per lane plus the beaded wet track
//                    it leaves, evaporating from the top down
//   pointer water  — the gathered channel of the trail buffer read as a
//                    density field and beaded by a third, coarser voronoi
//                    layer: the metaball half of the effect
uniform sampler2D uBackground;
uniform sampler2D uTrail;
uniform float uTime;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform float uAspect;
uniform vec2 uTrailTexel;

varying vec2 vUv;

// Heights and radii below are in FOOTER HEIGHTS: the aspect-corrected uv
// this pass works in spans 0..1 vertically over the band, so 0.02 is ~10px
// on a 500px-tall footer. Merge softness, refraction and the mask feather
// are all expressed in those units, so the look holds at any size.
const float MERGE_K = 0.008;
const float NORMAL_K = 0.006;
// Coverage feather, in height. It has to sit well under the SMALLEST
// source's peak height — the fine condensation layer tops out around
// 0.0034 — or those beads never reach full coverage and the layer washes
// out into haze.
const float MASK_FEATHER = 0.0012;
// Sized to the gather bead field below: a bead ~0.02 wide wants to be no
// more than about that tall, or its sides turn vertical and it shades as a
// ring rather than as a drop.
const float POINTER_HEIGHT = 0.018;
const float LANE_W = 0.075;

// background-size:cover, background-position:center top: uCoverScale/Offset
// (computed in FooterWaterGlass.jsx from the footer box vs. the photo's own
// aspect ratio) remap screen-space UVs to the cropped-and-scaled window of
// the photo actually visible, instead of stretching the whole image across
// whatever aspect ratio the footer happens to be.
vec2 toTexUv(vec2 uv) {
  return uv * uCoverScale + uCoverOffset;
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

// Polynomial smooth max — the metaball union. Where two heights are within
// `k` of each other the result bulges above both, which is the neck that
// forms between merging drops; outside that band it degrades to a plain max.
float smax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(a, b, h) + k * h * (1.0 - h);
}

// Merge one source into the accumulated surface.
//
// The height is the real metaball union. The normal is an exp-weighted blend
// by height instead of the true gradient of the merged field: getting that
// exactly would mean evaluating every source three times per pixel, and the
// difference only shows in the neck between two merging beads, where a blend
// of the two sphere normals is already the right shape.
void addWater(inout float height, inout vec3 normalSum, float h, vec3 n) {
  // Dry sources take the early exit rather than being merged as a zero.
  // smax bulges by k/4 wherever its two arguments are equal — including
  // 0 and 0 — so merging every miss would lay a k-sized pedestal of "water"
  // under the entire footer, and worse, one whose thickness depends on how
  // many sources happened to miss that pixel.
  if (h <= 0.0) return;
  normalSum += n * exp(h / NORMAL_K);
  height = smax(height, h, MERGE_K);
}

// A bead of radius r centred at c, shaded as a spherical cap: its height at
// p, plus the unit-sphere normal there for refraction and specular.
float bead(vec2 p, vec2 c, float r, out vec3 n) {
  n = vec3(0.0, 0.0, 1.0);
  if (r <= 0.0) return 0.0;
  vec2 d = (p - c) / r;
  float q = dot(d, d);
  if (q >= 1.0) return 0.0;
  float z = sqrt(1.0 - q);
  n = vec3(d, z);
  return z * r;
}

// One voronoi layer of condensation: a jittered bead per grid cell, only a
// `presence` fraction of cells kept, each sized from its own cell hash so a
// layer is not uniform blob-stamping.
//
// Cell scale is "cells per footer height", so the 30 and 70 main() passes in
// are ~20px and ~9px cells on a 600px band, carrying beads of roughly 7-13px
// and 3-6px. That is the size range the photo's own condensation sits in;
// anything much larger stops reading as condensation and starts reading as
// blobs stuck on the glass.
//
// Cells compete on distance normalised by their own radius, not raw distance:
// inside a big bead the big bead should win even when a smaller one's centre
// happens to sit nearer.
float condensation(
  vec2 p, float scale, float presence, float rMin, float rMax, vec2 seed,
  float wipe, out vec3 n, out float cap01
) {
  vec2 sp = p * scale + seed;
  vec2 ip = floor(sp);
  vec2 fp = fract(sp);

  float bestD = 8.0;
  vec2 bestOffset = vec2(0.0);
  float bestR = 0.0;
  vec2 bestCell = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 cellId = ip + offset;
      float alive = step(1.0 - presence, hash2(cellId + seed + 3.0).x);
      float r = mix(rMin, rMax, hash2(cellId + seed + 7.0).y) * alive;
      if (r <= 0.0) continue;
      vec2 toPoint = offset + hash2(cellId + seed) - fp;
      float d = length(toPoint) / r;
      if (d < bestD) {
        bestD = d;
        bestOffset = toPoint;
        bestR = r;
        bestCell = cellId;
      }
    }
  }

  n = vec3(0.0, 0.0, 1.0);
  cap01 = 0.0;
  if (bestR <= 0.0) return 0.0;

  // Wiping shrinks the bead rather than fading it out — water pushed off the
  // glass leaves less water, not translucent water — and a little per-cell
  // variance keeps a cluster from wiping and regrowing in lockstep.
  float variance = mix(0.85, 1.15, hash2(bestCell).y);
  float r = bestR * (1.0 - clamp(wipe * variance, 0.0, 1.0));
  if (r <= 0.0) return 0.0;

  vec2 d = -bestOffset / r;
  float q = dot(d, d);
  if (q >= 1.0) return 0.0;

  float z = sqrt(1.0 - q);
  n = vec3(d, z);
  cap01 = z;
  // Cell-space height back into footer heights.
  return z * r / scale;
}

// The pointer field's own falloff is soft all the way to its centre, which
// shades as a wide, shallow mound — legible as a smudge, not as water. This
// turns it into a body with a rounded top and steep sides, which is both
// what surface tension actually produces and what catches the light.
float pointerProfile(float gathered) {
  return sqrt(smoothstep(0.30, 0.78, gathered));
}

// Running drops — the motion the still photo cannot have. Each lane runs one
// drop at a time down the glass, accelerating as it falls, and leaves a
// beaded wet track behind it that evaporates from the top down.
//
// The track's beads are pinned to fixed slots down the lane and revealed as
// the head passes them, rather than being spawned behind the head: that way a
// trail of any length costs three bead evaluations instead of one per bead,
// and it stays put on the glass the way a real wet track does.
void rain(vec2 p, float time, float wipe, inout float height, inout vec3 normalSum) {
  float lane = floor(p.x / LANE_W);
  vec2 laneSeed = hash2(vec2(lane, 4.0));

  float speed = mix(0.10, 0.22, laneSeed.x);
  float t = time * speed + laneSeed.y * 20.0;
  float pass = floor(t);
  float f = fract(t);

  vec2 passSeed = hash2(vec2(lane, pass));
  // Only some passes carry a drop, so the rain has gaps in time as well as
  // across lanes — otherwise every lane drips on its own fixed metronome.
  float alive = step(0.42, hash2(vec2(lane + 91.7, pass)).x);
  float r = mix(0.008, 0.020, passSeed.x * passSeed.x) * alive;
  if (r <= 0.0) return;

  float cx = (lane + 0.5) * LANE_W + (passSeed.y - 0.5) * (LANE_W - 2.0 * r);
  // Gravity: the drop covers the band on an accelerating curve, entering
  // fully above the top edge and leaving fully below the bottom one.
  float headY = (1.0 + r) - f * f * (1.0 + 2.0 * r);

  // Two statements, not one: bead() writes headNormal through an out
  // parameter, and GLSL leaves the evaluation order of a call's arguments
  // undefined.
  vec3 headNormal;
  float headH = bead(p, vec2(cx, headY), r, headNormal);
  addWater(height, normalSum, headH, headNormal);

  float spacing = r * 2.6;
  float slot = floor(p.y / spacing + 0.5);
  for (int i = -1; i <= 1; i++) {
    float idx = slot + float(i);
    vec2 beadSeed = hash2(vec2(lane * 7.31 + idx, pass));
    float by = (idx + (beadSeed.x - 0.5) * 0.5) * spacing;
    // How far the head has travelled past this slot doubles as the bead's
    // age: nothing until the drop arrives, then evaporating behind it.
    float age = by - headY;
    if (age <= 0.0) continue;
    float life = (1.0 - smoothstep(0.12, 0.55, age)) * (1.0 - wipe);
    vec3 beadNormal;
    float h = bead(
      p,
      vec2(cx + (beadSeed.y - 0.5) * r * 0.6, by),
      r * mix(0.18, 0.42, beadSeed.y) * life,
      beadNormal
    );
    addWater(height, normalSum, h, beadNormal);
  }
}

void main() {
  vec2 texUv = toTexUv(vUv);
  vec3 baseColor = texture2D(uBackground, texUv).rgb;

  // Placement works in aspect-corrected uv so cells and beads come out round
  // in screen space instead of stretched into ellipses by the footer's very
  // wide, flat box.
  vec2 sq = vec2(vUv.x * uAspect, vUv.y);

  vec4 trail = texture2D(uTrail, vUv);
  float wipe = smoothstep(0.0, 1.0, trail.r);
  float gather = trail.g;

  float height = 0.0;
  // Seeded with a flat normal at low weight: dry glass, outvoted the moment
  // any real source contributes height.
  vec3 normalSum = vec3(0.0, 0.0, 0.35);

  vec3 bigNormal, smallNormal;
  float bigCap, smallCap;
  // Sparse coarse beads over a dense fine layer, rather than two layers of
  // similar density: real condensation is mostly fine grain with the
  // occasional larger bead where a few have run together, and two even
  // layers read as bubble wrap.
  float bigH = condensation(sq, 30.0, 0.22, 0.16, 0.32, vec2(0.0), wipe, bigNormal, bigCap);
  float smallH = condensation(sq, 70.0, 0.55, 0.18, 0.36, vec2(31.7, 5.2), wipe, smallNormal, smallCap);
  addWater(height, normalSum, bigH, bigNormal);
  addWater(height, normalSum, smallH, smallNormal);

  rain(sq, uTime, wipe, height, normalSum);

  // Pointer water — the metaball half. The gathered channel is already a
  // smooth density field, so running it through the same smooth max gives a
  // body of water that merges with whatever it rolls over.
  //
  // Shaped by a bead field of its own — coarser than either condensation
  // layer, so the water the pointer gathers pulls into drops the size real
  // coalesced water makes, not the size of the mist it was gathered from.
  // Without this the field's own radial falloff shades as a smooth capsule
  // down the whole swipe, which reads as a glass tube rather than as water.
  // The floor under the bead field keeps enough of a connecting film for
  // neighbouring drops to merge through, and it thins as the water
  // evaporates, so the chain breaks into separate beads before it dries.
  vec3 gatherNormal;
  float gatherCap;
  condensation(sq, 30.0, 0.85, 0.26, 0.46, vec2(5.1, 12.3), 0.0, gatherNormal, gatherCap);
  float shape = mix(gatherCap, 1.0, gather * 0.3) * POINTER_HEIGHT;
  float pointerH = pointerProfile(gather) * shape;
  // Normal from the field's own gradient — four taps of a small buffer, far
  // cheaper than differencing the procedural sources would be. The taps go
  // through the same profile as the centre, so the steep sides the profile
  // creates are what the normal sees.
  float gx =
    pointerProfile(texture2D(uTrail, vUv + vec2(uTrailTexel.x, 0.0)).g) -
    pointerProfile(texture2D(uTrail, vUv - vec2(uTrailTexel.x, 0.0)).g);
  float gy =
    pointerProfile(texture2D(uTrail, vUv + vec2(0.0, uTrailTexel.y)).g) -
    pointerProfile(texture2D(uTrail, vUv - vec2(0.0, uTrailTexel.y)).g);
  vec2 slope = vec2(
    gx / (2.0 * uTrailTexel.x * uAspect),
    gy / (2.0 * uTrailTexel.y)
  ) * shape;
  // The bead field shapes the height, so it has to tilt the surface too:
  // the field's own slope carries the body of water, and each bead adds its
  // own curvature on top. Without this second term the trail is a chain of
  // flat-topped lumps rather than drops.
  vec3 pointerNormal =
    normalize(vec3(-slope + gatherNormal.xy * gatherCap * 1.2, 1.0));
  addWater(height, normalSum, pointerH, pointerNormal);

  vec3 normal = normalize(normalSum);
  float mask = smoothstep(0.0, MASK_FEATHER, height);

  // A bead is a LENS, not a bump map. The sample is pulled toward the bead's
  // centre in proportion to the surface slope, which magnifies and inverts
  // what sits behind it — that distortion is most of what makes water read
  // as water. It is also why the displacement has to scale with thickness
  // and be this large: the plate behind is itself a photo of condensation,
  // so a physically dainty one-pixel offset leaves a drop indistinguishable
  // from the beads already baked into the picture. Clamped so the pointer's
  // much taller body of water bends the plate hard without smearing in
  // colour from the far side of the footer.
  vec2 normalUv = vec2(normal.x / uAspect, normal.y);
  vec2 refractedUv = texUv - normalUv * min(0.8 * height, 0.02) * uCoverScale;
  vec3 refracted = texture2D(uBackground, refractedUv).rgb;

  vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.75));
  float lambert = max(dot(normal, lightDir), 0.0);
  // Two lobes: the tight glint off the top of a bead, and a much broader
  // sheen over the whole lit side. Water on a dark plate is nearly all
  // highlight — the tight lobe alone is a single sparkling pixel that reads
  // as noise rather than as a wet surface.
  float spec = pow(lambert, 40.0) * 0.40 + pow(lambert, 6.0) * 0.05;
  // Grazing angles at a bead's edge catch the cool light the plate is lit
  // by, which is what draws the bright hairline around a real drop.
  float fresnel = pow(1.0 - normal.z, 4.0);
  vec3 rimLight = vec3(0.50, 0.68, 0.82) * fresnel * 0.16;

  vec3 water = refracted * (0.92 + 0.14 * normal.z) + spec + rimLight;
  // Body light. Refraction alone is nearly invisible here: the plate behind
  // is a large, evenly lit dark surface, so bending it a few pixels changes
  // almost nothing, and a bead ends up as a bare outline. Thicker water gets
  // a little of the plate's own cool light through it, which is what fills
  // that outline in.
  water += vec3(0.16, 0.22, 0.27) * smoothstep(0.004, 0.05, height) * 0.06;
  // Contact shading just inside that hairline so beads sit on the glass
  // instead of floating above it. Kept light: any heavier and every bead
  // reads as a dark ring instead of as water.
  water -= smoothstep(0.6, 0.95, length(normal.xy)) * mask * 0.025;

  gl_FragColor = vec4(mix(baseColor, water, mask), 1.0);
  // uBackground is an sRGB texture, so texture2D() hands back *linear* values
  // and everything above is linear-light. The renderer's output colour space
  // is sRGB and it does not encode custom ShaderMaterial output for us —
  // without this the plate is written gamma-crushed: markedly darker and
  // bluer than footer-bg.webp, with the photo's mid-dark right half falling
  // to near-black.
  #include <colorspace_fragment>
}
