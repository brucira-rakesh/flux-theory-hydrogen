// Pointer state for FooterWaterGlass — a ping-ponged low-res buffer that
// stands in for per-droplet CPU/JS bookkeeping. Each frame it decays the
// previous value and stamps the current pointer position on top of it, in
// two independent channels that the droplet pass reads as two different
// physical things:
//
//   R — SWEPT. How recently the pointer cleared this patch of condensation.
//       Fast decay, so beads vanish under the cursor and reform behind it.
//   G — GATHERED. The water that sweep pushes into a body around the
//       pointer. This is the density field the droplet pass turns into
//       metaballs, so it wants to be smooth and to linger: narrower than
//       the swept area (the mist off a wide swipe beads up into a thinner
//       tail) and decaying far slower, which is what makes the water lag
//       behind the cursor as a liquid trail before it evaporates.
//
// Keeping both in one buffer means one ping-pong and one texture fetch in
// the main pass, and the two fields stay in lockstep by construction.
uniform sampler2D uPrevTrail;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uDecay;
uniform float uGatherDecay;
uniform float uRadius;
uniform float uAspect;

varying vec2 vUv;

void main() {
  vec2 d = vUv - uMouse;
  d.x *= uAspect;
  float dist = length(d);

  float wipe = uMouseActive * (1.0 - smoothstep(0.0, uRadius, dist));
  // Squared falloff rather than the linear one the wipe uses: the metaball
  // surface is a threshold on this field, and a rounder field gives the
  // rounder, more liquid silhouette.
  float gatherFalloff = 1.0 - smoothstep(0.0, uRadius * 0.75, dist);
  float gather = uMouseActive * gatherFalloff * gatherFalloff;

  vec4 prev = texture2D(uPrevTrail, vUv);

  gl_FragColor = vec4(
    max(prev.r * uDecay, wipe),
    max(prev.g * uGatherDecay, gather),
    0.0,
    1.0
  );
}
