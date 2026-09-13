// Starting values for the "lights coming on" reveal each scene's video plane
// runs as it swings into view (see scenes/VideoPlaneV2.jsx's
// LIGHT_UP_FRAGMENT for what the shader does with them), and the fallback
// for any one a caller leaves out.
//
// Their own module rather than a constant hanging off VideoPlaneV2, because
// BOTH that component and Scene.v2.jsx's "Light Up" GUI folder need them —
// the folder builds its controls from these exact numbers instead of its own
// copy, and two copies of a tuned look drift the moment one is adjusted.
export const DEFAULT_LIGHT_UP = {
  // How far a scene has to have swung in before its lights start coming up:
  // the reveal runs from here to 1, so the plane holds at its off-state level
  // (see `floor`) for everything before it. At 0 the lights begin the instant
  // the transition does and the room is fully lit long before the scene has
  // even arrived; at 0.5 the swing is half over before anything happens and
  // the reveal lands with the scene.
  //
  // Raising this delays the start AND tightens the reveal, because the same
  // curve is fitted into whatever swing is left — 0.5 runs it over half the
  // travel where 0.1 spread it across nearly all of it, so the lights come up
  // faster as well as later. That's usually what's wanted (a lamp switching
  // on, not a slow dimmer), but it's why the two can't be tuned independently
  // from this one number.
  //
  // Shader path only — the clip path has its own below, because the two want
  // different timing: this is a continuous curve stretched across whatever
  // swing remains, while a clip runs at its own fixed length regardless.
  startAt: 0.5,
  // Same idea for the clip path (REVEAL_MODE.CLIPS): how far in before the
  // intro clip starts playing, with the plane held black until it does. The
  // clip is ~1s (stretched by CLIP_PLAYBACK_RATE) against a committed step of
  // up to 1.5s, so at 0.5 the cut to the loop lands just after the scene
  // settles, with the black hold covering the first half of the swing.
  clipStartAt: 0.5,
  // Width of the threshold's soft edge, in perceptual luma. Small = a hard
  // wavefront sweeping through the tones; large = a gentler, more diffuse
  // bloom-up.
  softness: 0.64,
  // Overshoot applied to whatever is currently igniting. Feeds bloom.
  boost: 0.17,
  // Floor under the whole curve — what the plane shows with the lights fully
  // "off", as a fraction of the video's own brightness. 0 is pure black,
  // which reads as the scene having vanished rather than being unlit; same
  // reason the carousel's baked lights never dim to zero either (see
  // swingCarousel's BAKED_LIGHT_MIN). Because the background behind the
  // plane is solid black, a gain floor and an initial opacity are the same
  // thing on screen. Only ever binds while the reveal is below it: at rest
  // the curve is 1.0 everywhere, so any floor <= 1 leaves the settled frame
  // untouched.
  floor: 0.01,
};
