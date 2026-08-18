// =============================================================================
//  bottleInteraction.glsl  —  Bottle → ocean coupling (NEW MODULE)
// -----------------------------------------------------------------------------
//  This file is the single source of truth for the "bottle emerging from the
//  sea" interaction. It is #included by BOTH the sea vertex shader (to bend the
//  water height) and the sea fragment shader (to paint foam), and also by the
//  splash-crown / droplet shaders so every system reads the exact same fields.
//
//  Design rules that keep it safe to drop into the existing pipeline:
//   * It declares the NEW bottle uniforms here and ONLY here, so the main
//     shaders don't duplicate declarations.
//   * It never declares `uTime` (the host shaders already own that) — anything
//     time-dependent takes an explicit `t` argument instead. This avoids a
//     duplicate-uniform compile error.
//   * Every function is pure (reads its args + the bottle uniforms), so the
//     finite-difference normal reconstruction in vertex.glsl stays correct: the
//     same height is produced for a point and its neighbours.
//   * Its noise helpers use a `bi` prefix so they never collide with the
//     existing perlinClassic3D symbols.
// =============================================================================

// --- New uniforms, driven from Seawave.jsx (shared by reference across all
//     materials so one JS update feeds sea + crown + droplets at once) --------
uniform vec3  uBottlePosition;      // world-space contact point (x, waterlineY, z)
uniform float uBottleRadius;        // approx. bottle radius at the waterline
uniform float uBottleVelocityY;     // world units / second (+ = rising)
uniform float uContact;             // 0..1 — bottle is currently straddling the surface
uniform float uImpactTime;          // uTime of the last surface break-through (<0 = none yet)
uniform float uImpactStrength;      // 0..1 — splash energy captured at break-through
// NEW: mirror of uImpactTime/uImpactStrength for the OPPOSITE crossing — the
// bottle going back UNDER the surface on a reverse scroll. Kept as its own
// pair of uniforms (only read by the sea's bottleDisplacement below, NOT by
// the crown/droplet shaders) so scrolling back down earns a gentle re-entry
// ripple on the water itself without spawning a spray of splash droplets.
uniform float uReentryTime;         // uTime of the last downward re-submersion (<0 = none yet)
uniform float uReentryStrength;     // 0..1 — gentler ripple energy for that re-entry
uniform float uInfluenceRadius;     // outer radius of the water reaction
uniform float uInteractionEnabled;  // master on/off (1/0)
uniform float uFoamElevation;       // 0..2 — intensity of the churned-water bump (see calculateFoamElevation)
uniform float uSplashAmplitude;     // 0..1 — global height scale for the collar/ring/ripple bulge (keeps it a bump, not a spike)
uniform float uRippleStrength;      // amplitude scale for the lingering aftermath ripples
uniform float uRippleDuration;      // seconds the aftermath ripples keep radiating before fading out

// -----------------------------------------------------------------------------
//  Cheap self-contained noise (hash / value / voronoi). Kept local so this
//  module works in the fragment stage too, where perlinClassic3D isn't present.
// -----------------------------------------------------------------------------
float biHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float biValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = biHash21(i);
    float b = biHash21(i + vec2(1.0, 0.0));
    float c = biHash21(i + vec2(0.0, 1.0));
    float d = biHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Distance to nearest feature point — the classic foam / cellular pattern.
float biVoronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = vec2(biHash21(i + g), biHash21(i + g + 17.1));
            vec2 r = g + o - f;
            minDist = min(minDist, dot(r, r));
        }
    }
    return sqrt(minDist);
}

// -----------------------------------------------------------------------------
//  calculateBottleInfluence — smooth 0..1 mask around the bottle.
//  1 right at the bottle, feathering to 0 at uInfluenceRadius. Everything the
//  bottle does to the water is multiplied by this, so far-away water is
//  untouched (and the extra math early-outs to ~zero cost).
// -----------------------------------------------------------------------------
float calculateBottleInfluence(vec2 pos) {
    float d = distance(pos, uBottlePosition.xz);
    return 1.0 - smoothstep(uBottleRadius, uInfluenceRadius, d);
}

// -----------------------------------------------------------------------------
//  calculateBottleCollar — the water "wraps" the bottle. As the bottle pierces
//  the surface it laps against its sides in small, continuously travelling
//  ripple rings (surface tension look), rather than one static raised mound —
//  a fixed-height Gaussian bump sitting for the whole (slow, physics-driven)
//  straddle reads as a frozen blob, not living water. Returns a vec3: a small
//  inward XZ suction (water clinging to the hull) + a Y ripple.
// -----------------------------------------------------------------------------
vec3 calculateBottleCollar(vec2 pos, float t) {
    vec2 toC = pos - uBottlePosition.xz;
    float d = length(toC);
    vec2 dir = d > 1e-4 ? toC / d : vec2(0.0);

    // Radial distance normalised to the bottle radius, measured outward from
    // the hull (0 at the hull, growing beyond it).
    float r = d / max(uBottleRadius, 1e-3);
    float rn = max(r - 1.0, 0.0);

    // Tight envelope hugging the hull — the ripples themselves live within
    // roughly one radius of it, not a wide static dome.
    float envelope = exp(-rn * 2.2);

    // Two travelling ring frequencies (phase advances with time), so the
    // bulge actually MOVES outward instead of sitting still — this is what
    // reads as "lapping" water rather than a solid mound.
    float ring1 = sin(rn * 10.0 - t * 4.0);
    float ring2 = sin(rn * 18.0 - t * 6.5) * 0.5;
    float ripple = (ring1 + ring2) * envelope;

    // Break the ring's symmetry with a little angular noise so it never reads
    // as a perfect CG cylinder of water.
    float ang = atan(dir.y, dir.x);
    float wobble = 0.8 + 0.2 * biValueNoise(vec2(ang * 2.5, t * 0.8));

    // Deliberately gentle (0.16, was an unscaled ~1.0-peak dome) — a lapping
    // ripple, not a mound tall enough to swallow the hull.
    float height = ripple * wobble * uContact * 0.16;

    // Water clings inward toward the hull (negative = toward centre).
    vec2 suction = -dir * envelope * 0.06 * uContact;

    return vec3(suction.x, height, suction.y);
}

// -----------------------------------------------------------------------------
//  calculateSplashRing — the expanding "crown" foot printed on the water at the
//  moment of break-through. A thin ridge of water that races outward from the
//  contact point and fades, driven by seconds-since-impact (`age`).
// -----------------------------------------------------------------------------
float calculateSplashRing(vec2 pos, float age, float strength) {
    if (age < 0.0) return 0.0;
    float d = distance(pos, uBottlePosition.xz);

    // The ring's radius grows quickly then eases (sqrt = decelerating front).
    float ringR = uBottleRadius + sqrt(max(age, 0.0)) * 2.6;
    // A ridge centred on the travelling radius — widened from the original
    // hard 3.2 spike so it crosses enough sea vertices to interpolate
    // smoothly instead of faceting.
    float ridge = exp(-pow((d - ringR) * 2.0, 2.0));

    // Global life envelope: rise, then decay over ~1.6s. The rise window was
    // widened from 0.06s to 0.16s — the ring used to reach full height almost
    // instantly, which read as a sudden "bombard" pop rather than a building
    // splash; the softer onset lets it visibly grow instead of appearing.
    float life = exp(-age * 1.8) * smoothstep(0.0, 0.16, age);

    return ridge * life * strength;
}

// -----------------------------------------------------------------------------
//  calculateRipples — several concentric wave trains expanding from the impact.
//  Outer rings travel farther (higher phase speed) and every train's amplitude
//  decays with both distance and time. This is the calm aftermath after the
//  crown collapses — deliberately long-lived (uRippleDuration) and wide-
//  reaching so the sea keeps rippling for a while, reading far more realistic
//  than a splash that vanishes instantly.
// -----------------------------------------------------------------------------
float calculateRipples(vec2 pos, float age, float strength) {
    if (age < 0.0 || age > uRippleDuration) return 0.0;
    float d = distance(pos, uBottlePosition.xz);

    float total = 0.0;
    // Four trains at different frequencies / speeds — one extra low-frequency
    // swell over the original three so the aftermath has a broad, slow ring
    // travelling under the finer ripples.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float speed = 1.8 + fi * 0.9;
        // Ring only exists behind the expanding front (d < front); band
        // (below) already multiplies a train's wave to exactly 0 once
        // d > front + 0.6, so skipping the sin()/band work entirely once we
        // know that's the case changes nothing about the result. This matters
        // a lot right after breach: for most of uRippleDuration the slower
        // trains' fronts lag well behind the outer influence radius (the
        // caller gates on the FASTEST train's reach), so most vertices in
        // range would otherwise pay for a sin() call whose answer is thrown
        // away — across the ~1M-vertex sea plane (evaluated 3x per vertex for
        // finite-difference normals), that wasted work is the main driver of
        // the frame-rate dip during the splash.
        float front = age * speed;
        if (d > front + 0.6) continue;
        float freq = 5.0 + fi * 4.0;
        float phase = d * freq - age * speed * freq * 0.25;
        float band = smoothstep(front + 0.6, front, d);
        float wave = sin(phase) * band;
        total += wave / (1.0 + fi);
    }

    // Amplitude falls off gently with distance (rings reach far across the sea)
    // and fades smoothly to zero over the whole uRippleDuration window so there
    // is no hard cut-off when the effect ends.
    float spatial = exp(-d * 0.32);
    float norm = age / max(uRippleDuration, 1e-3);   // 0..1 across the lifetime
    float life = (1.0 - norm) * smoothstep(0.0, 0.1, age);
    return total * spatial * life * strength * uRippleStrength * 0.3;
}

// -----------------------------------------------------------------------------
//  calculateContactRipple — NEW: small concentric ripples that continuously
//  radiate from the hull for as long as it's touching the surface (uContact),
//  scaled by how fast it's currently moving through the water. This is the
//  physically-motivated "bow wave" a real object pushes ahead of itself —
//  distinct from calculateSplashRing/calculateRipples above, which are a
//  ONE-TIME burst fired only at the moment of break-through. Keeping this
//  separate is what lets the animation have a single splash event while
//  still reading as alive/reactive the rest of the time.
// -----------------------------------------------------------------------------
float calculateContactRipple(vec2 pos, float t) {
    if (uContact <= 0.001) return 0.0;
    float d = distance(pos, uBottlePosition.xz);
    float rn = d / max(uBottleRadius, 1e-3);

    // Concentric rings drifting outward from the hull, continuously animated.
    // Lower frequency (was 7.0) — fewer, wider rings read as a soft bow wave
    // rather than tight corrugation close to the hull.
    float wave = sin(rn * 3.5 - t * 2.6);
    // Fades out a few radii from the hull so it never reaches the open sea.
    float falloff = exp(-rn * 0.85) * smoothstep(0.0, 0.3, rn);

    // Faster vertical motion pushes a more visible ripple ahead of the hull.
    float speedFactor = clamp(abs(uBottleVelocityY) * 0.5, 0.0, 1.0);

    return wave * falloff * uContact * speedFactor * 0.035;
}

// -----------------------------------------------------------------------------
//  calculateFoamElevation — REPLACES the old fragment-only foam color patch.
//  Rather than painting a flat gray/white blob over the metal (which read as
//  a dull unlit smudge against the reflective sea), churn is expressed as
//  actual small-scale VERTEX HEIGHT: gentle bumps riding on top of the collar
//  crest and the travelling ring. Because this feeds bottleDisplacement below
//  (i.e. it's inside getDisplacement()), it inherits the sea's existing
//  crest/trough tint ramp and gets proper normals for the metallic specular —
//  so the churn sparkles and shades exactly like the rest of the liquid metal
//  instead of looking like a separate, flat texture.
//
//  Deliberately NOT voronoi (biVoronoi): a cellular distance field has a
//  discontinuous GRADIENT at every cell boundary, which reads as sharp,
//  crystalline facets once lit — this is what made the collar mound look
//  spiky/jagged instead of a smooth rounded liquid blob like a real splash.
//  Two octaves of smooth value noise instead — continuous everywhere, so the
//  bulge stays rounded and the specular highlights stay broad and soft.
// -----------------------------------------------------------------------------
float calculateFoamElevation(vec2 pos, float t) {
    float age = (uImpactTime >= 0.0) ? (t - uImpactTime) : -1.0;
    float d = distance(pos, uBottlePosition.xz);

    // Same bands as the collar / splash ring: chop only where the water is
    // actually churning (hugging the hull, or riding the outgoing ring).
    float collarBand = exp(-pow((d / max(uBottleRadius, 1e-3) - 1.1) * 1.4, 2.0)) * uContact;
    float ringR = uBottleRadius + sqrt(max(age, 0.0)) * 2.6;
    float ringBand = (age >= 0.0) ? exp(-pow((d - ringR) * 2.4, 2.0)) * exp(-age * 1.5) : 0.0;
    float mask = clamp(collarBand + ringBand, 0.0, 1.0);
    if (mask <= 0.001) return 0.0;

    // Smooth, continuous churn — a broad slow swell plus a finer smooth
    // ripple on top, both plain value noise (no hard cell edges anywhere).
    float swell = biValueNoise(pos * 3.0 + vec2(t * 0.4, -t * 0.3));
    float fine = biValueNoise(pos * 7.0 - vec2(t * 0.7, t * 0.5));
    float churn = swell * 0.65 + fine * 0.35;

    const float amplitude = 0.07; // world units of bump at uFoamElevation = 1 (gentler than before)
    return churn * mask * uFoamElevation * amplitude;
}

// -----------------------------------------------------------------------------
//  bottleDisplacement — the single value the sea VERTEX shader adds on top of
//  the existing Gerstner + perlin ocean. Kept as one call so the neighbour
//  samples used to rebuild the normal stay consistent.
// -----------------------------------------------------------------------------
vec3 bottleDisplacement(vec2 pos, float t) {
    if (uInteractionEnabled < 0.5) return vec3(0.0);

    float d   = distance(pos, uBottlePosition.xz);
    float age = (uImpactTime >= 0.0) ? (t - uImpactTime) : -1.0;
    // Mirror of `age`, but for the reverse (going back UNDER) crossing.
    float reentryAge = (uReentryTime >= 0.0) ? (t - uReentryTime) : -1.0;

    // The aftermath ripples travel FAR from the bottle, so they can't be gated
    // by the tight collar influence mask (which fades out after a few radii).
    // Give them their own, wider reach for the early-out: how far the fastest
    // ring front could have travelled, while the ripples are still alive.
    float rippleActive = (age >= 0.0 && age <= uRippleDuration) ? 1.0 : 0.0;
    float rippleReach = min(uBottleRadius + max(age, 0.0) * 4.5 + 1.5, 13.0) * rippleActive;
    float reentryActive = (reentryAge >= 0.0 && reentryAge <= uRippleDuration) ? 1.0 : 0.0;
    float reentryReach = min(uBottleRadius + max(reentryAge, 0.0) * 4.5 + 1.5, 13.0) * reentryActive;

    float infl = calculateBottleInfluence(pos);
    // Early-out only where the local reaction AND both ripple trains are absent.
    if (infl <= 0.001 && d > rippleReach && d > reentryReach) return vec3(0.0);

    // --- Local, influence-confined terms (collar bulge, foam chop, bow wave,
    //     one-time splash ring) ------------------------------------------------
    vec3 collar = calculateBottleCollar(pos, t);
    float ring  = calculateSplashRing(pos, age, uImpactStrength);
    float bow   = calculateContactRipple(pos, t);
    float chop  = calculateFoamElevation(pos, t);

    // uSplashAmplitude reins the collar ripple + splash ring in further —
    // the collar is already gentle by design (see calculateBottleCollar), the
    // ring is the one-time breach ridge (still peaks near 1.0 world unit).
    // The contact ripple and foam chop are already small.
    vec3 disp = vec3(collar.x, (collar.y + ring) * uSplashAmplitude, collar.z);
    disp.y += bow + chop;
    disp *= infl;                       // confine the LOCAL reaction to the zone

    // --- Wide, long-lived aftermath ripples --------------------------------
    // Added AFTER the tight influence clip so they radiate out across the open
    // sea and linger for uRippleDuration, self-fading via their own falloff.
    float rip = calculateRipples(pos, age, uImpactStrength);
    disp.y += rip * uSplashAmplitude;

    // --- Reverse-scroll re-entry ripple -------------------------------------
    // Reuses the exact same ring/ripple math as the forward breach above —
    // just keyed off uReentryTime/uReentryStrength instead — so scrolling
    // back down and taking the bottle back under the surface reads as a
    // soft re-entry ripple instead of doing nothing (previously ONLY the
    // forward breach fired any one-time reaction). uReentryStrength is set
    // from JS already scaled down from the matching breach strength, so no
    // extra damping is needed here — this is meant to read as "slight".
    float reentryRing = calculateSplashRing(pos, reentryAge, uReentryStrength) * infl;
    disp.y += reentryRing * uSplashAmplitude;
    float reentryRip = calculateRipples(pos, reentryAge, uReentryStrength);
    disp.y += reentryRip * uSplashAmplitude;

    return disp;
}
