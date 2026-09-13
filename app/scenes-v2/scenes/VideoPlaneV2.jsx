import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useVideoPlaneTexture } from "../useVideoPlaneTexture";
import { DEFAULT_LIGHT_UP } from "../lightUpDefaults";
import { excludeFromBloom } from "../bloomExclusion";
import { isBuffered } from "../videoBlobCache";
import { useOneShotVideoTexture } from "../useOneShotVideoTexture";
import { mediaOf } from "../videoPlayFallback";

// How much bigger than the exact "cover" size to draw the plane — a hair of
// overscan so cursor parallax / transition FOV widening (see Scene.v2.jsx's
// CameraRig and swingCarousel's applyTransitionFov) never reveals a sliver
// of background past the plane's edge. Combined with the cover-fit sizing
// below, this is the only thing that ever crops the video.
//
// Every percent here is a percent of the source's linear resolution spent on
// pixels that are off screen by definition: at 1.1 the footage was being
// magnified an extra 10% on both axes (~21% of the source area discarded)
// before it ever reached the frustum. The margin only has to cover the
// largest excursion parallax + transition FOV can actually produce, which is
// a couple of percent, not ten — so this is now sized to that rather than
// left at a round guess. Raise it if a background sliver ever shows at the
// edge of a swing.
const OVERSCAN = 1.01;

// --- "lights coming on" reveal -------------------------------------------
//
// Derived from the loop footage ITSELF, in the shader — not from a separate
// intro/outro clip. A second render can never cut seamlessly into the loop
// (different bake, different cylinder highlights, different everything), and
// this sidesteps the problem entirely: there is no cut. The plane always
// shows the one video, with a gain curve swept over it, and that curve is
// exactly 1.0 when a scene is resting at FRONT — so the settled frame is
// bit-identical to the raw video, with nothing to match up.
//
// The curve is NOT a plain fade from black, which reads as a dissolve rather
// than as light. Instead a brightness threshold sweeps down through the
// frame: the brightest pixels (the light strip, the lit cylinders, the sky)
// cross it first and pop on alone against a black room, then the ambient
// floor comes up underneath them and fills the rest in. Whatever is in the
// act of igniting gets a short overshoot, which PostFXV2's bloom pass then
// picks up as a flare — that overshoot is most of what sells it as a lamp
// switching on rather than an opacity ramp.
const LIGHT_UP_UNIFORMS = `
uniform float uLightUp;
uniform float uLightSoftness;
uniform float uLightBoost;
uniform float uLightFloor;
`;

// Injected AFTER <map_fragment>, so diffuseColor already holds the video
// texel, sRGB-decoded to linear by three's own DECODE_VIDEO_TEXTURE path.
// Luma is square-rooted into roughly perceptual space first: swept in linear
// space the threshold spends most of its travel in a range almost nothing
// occupies, then dumps the whole image on at the end.
const LIGHT_UP_FRAGMENT = `
float ftLum = sqrt( clamp( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 ) );
float ftEdge = mix( 1.0 + uLightSoftness, 0.0, uLightUp );
float ftReveal = smoothstep( ftEdge, ftEdge + uLightSoftness, ftLum );
float ftAmbient = smoothstep( 0.4, 1.0, uLightUp ) * uLightUp;
float ftGain = max( ftReveal, ftAmbient );
ftGain *= 1.0 + uLightBoost * ftReveal * ( 1.0 - uLightUp );
ftGain = max( ftGain, uLightFloor );
diffuseColor.rgb *= ftGain;
`;

// Every plane compiles the identical modified shader, so they can all share
// one program — but it must not collide with an unmodified MeshBasicMaterial
// elsewhere in the scene, which is what a custom cache key prevents.
const PROGRAM_CACHE_KEY = "video-plane-light-up";

// Seconds for the one-shot entrance ramp — see useLightUp. Only ever seen on
// the scene already resting at FRONT when the section scrolls into view,
// since that one has no swing of its own to drive the reveal.
const ENTRANCE_SECONDS = 1.65;
// Below this, a change in presence is scroll jitter rather than a real change
// of direction. Both reveals read it: the shader curve keeps whichever way its
// gate was already going, and the clip sequence keeps running the clip it was
// already on, instead of either flipping on a shaky trackpad.
const PRESENCE_EPS = 0.0005;
// Shortest the reveal may take to travel its full range, in seconds — the
// duration control for the swing-driven case, where the ramp would otherwise
// be however long the carousel's own step happened to last. The gate spans
// 1 - startAt of presence, so at the full 1.5s commit it ran in ~0.45s and at
// the 0.5s minimum commit in ~0.15s (see swingCarousel's COMMIT_DURATION_*);
// this puts a floor under both, so the lights come up at the same rate no
// matter how hard the scroll gesture was.
//
// It doubles as the guard on the one discontinuity in the gate below:
// reversing mid-ramp swaps which curve applies, and the two don't meet at the
// same value, so without a bound on the step that swap is a visible pop.
const LIGHT_MIN_SECONDS = 0.68;
// The section's frameloop is parked while it's far from the viewport (see
// Scene.v2.jsx's nearViewport gate), and the first frame after it resumes
// can report a huge delta — clamped so the entrance ramp can't skip to its
// end on that one frame.
const MAX_FRAME_DELTA = 0.1;

const scratchWorldPos = new THREE.Vector3();

// Resizes `meshRef` every frame to "cover" the camera's view frustum at the
// plane's own depth — same idea as CSS `object-fit: cover`: the video's own
// aspect ratio is preserved (never stretched/distorted), sized up just
// enough that it fully covers the frustum on both axes, letting whichever
// axis overshoots spill past the edges rather than letterboxing. Full-bleed
// regardless of window aspect ratio, live FOV changes, or how far this
// scene slot currently is from the (fixed) camera. Per-frame because camera
// FOV and this mesh's world position (via the swing carousel's own
// per-frame group transform) can change continuously.
function useFillFrustum(meshRef, texture, visible) {
  useFrame(({ camera, size }) => {
    // Only a visible plane's fit can ever be seen — the other 4 scenes'
    // planes were still paying this every frame regardless (mesh.visible
    // alone doesn't stop the useFrame body from running), pure wasted work
    // for whichever isn't resting at FRONT or mid-swing.
    if (!visible) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.getWorldPosition(scratchWorldPos);
    const distance = camera.position.distanceTo(scratchWorldPos) || 0.001;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const frustumHeight = 2 * Math.tan(verticalFov / 2) * distance;
    const frustumWidth = frustumHeight * (size.width / size.height);
    const frustumAspect = frustumWidth / frustumHeight;

    // Video dimensions aren't known until its metadata has loaded — until
    // then, fall back to the frustum's own aspect (a plain, undistorted
    // fill) rather than reading videoWidth/videoHeight as 0.
    const video = mediaOf(texture);
    const videoAspect =
      video?.videoWidth && video?.videoHeight
        ? video.videoWidth / video.videoHeight
        : frustumAspect;

    let width;
    let height;
    if (videoAspect > frustumAspect) {
      // Video is relatively wider than the frustum — match heights, let
      // width spill past the left/right edges.
      height = frustumHeight;
      width = height * videoAspect;
    } else {
      // Video is relatively taller/narrower — match widths, let height
      // spill past the top/bottom edges.
      width = frustumWidth;
      height = width / videoAspect;
    }

    mesh.scale.set(width * OVERSCAN, height * OVERSCAN, 1);
  });
}

// Drives uLightUp: 0 = room dark, 1 = the video exactly as authored.
//
// It's a pure function of ONE number — `presence`, how close this scene is
// to resting at FRONT, from the carousel's own continuous index-space
// position (progressRef.current.step, written every frame by the same math
// that moves the scene groups, see swingCarousel.js). 1 = resting at FRONT,
// 0 = parked at BACK, in between = mid-swing.
//
// Being a pure function rather than a triggered animation is the whole
// point: the lights come up as a scene swings in and go back down as it
// swings out, with no phases, no direction tracking and no playhead to get
// out of sync. A gesture abandoned halfway just leaves them halfway; scrub
// the scroll back and forth and they follow it exactly, because there is no
// state to disagree with the scroll.
//
// The one thing presence can't drive is the first scene, which is already
// resting at FRONT (presence pinned at 1) when the section scrolls into
// view — it never swings, so it would simply be lit from the first frame.
// That case gets a one-shot clock ramp instead, applied as a ceiling so it
// binds only while it's the lower of the two.
function useLightUp({
  enabled,
  uniformsRef,
  progressRef,
  sceneIndex,
  lightUp,
}) {
  const entranceRef = useRef(0);
  const directionRef = useRef(1); // +1 swinging in, -1 swinging out
  const lastPresenceRef = useRef(null);
  const appliedRef = useRef(0); // rate-limited value actually on the uniform
  // Debug-only ramp, driven by the GUI's own on/off toggle instead of by the
  // scroll — see the "Light Up" folder in Scene.v2.jsx. Runs at the same rate
  // as a real reveal so what's being judged is the actual curve, not a
  // different one that happens to share its shape.
  const previewRef = useRef(0);

  useFrame((_, rawDelta) => {
    if (!enabled) return;
    const uniforms = uniformsRef.current;
    // Shape controls come straight off the latest props each frame (R3F
    // always invokes the newest callback), so dragging a GUI slider retunes
    // the curve live without recompiling the material or re-rendering React.
    uniforms.uLightSoftness.value =
      lightUp?.softness ?? DEFAULT_LIGHT_UP.softness;
    uniforms.uLightBoost.value = lightUp?.boost ?? DEFAULT_LIGHT_UP.boost;
    uniforms.uLightFloor.value = lightUp?.floor ?? DEFAULT_LIGHT_UP.floor;
    const startAt = lightUp?.startAt ?? DEFAULT_LIGHT_UP.startAt;
    const step = progressRef?.current?.step;
    // No carousel progress to read (e.g. this plane used standalone) — treat
    // the scene as resting in view, leaving the entrance ramp to run it.
    const presence =
      typeof step === "number"
        ? THREE.MathUtils.clamp(1 - Math.abs(step - sceneIndex), 0, 1)
        : 1;

    const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
    const rampStep = delta / ENTRANCE_SECONDS;
    entranceRef.current = Math.min(1, entranceRef.current + rampStep);

    // Preview always tracks the toggle, whether or not it currently owns the
    // plane, so flipping the override on picks up a ramp that's already in a
    // known state rather than one frozen wherever it was last used.
    const previewTarget = lightUp?.previewOn ? 1 : 0;
    const previewGap = previewTarget - previewRef.current;
    previewRef.current +=
      Math.sign(previewGap) * Math.min(Math.abs(previewGap), rampStep);

    const previous = lastPresenceRef.current ?? presence;
    lastPresenceRef.current = presence;
    const dPresence = presence - previous;
    if (dPresence > PRESENCE_EPS) directionRef.current = 1;
    else if (dPresence < -PRESENCE_EPS) directionRef.current = -1;

    // The gate has to mirror, or `startAt` only delays one end of the
    // journey. Read as a pure function of presence it does the wrong thing on
    // the way out: the same threshold that holds the lights back until a
    // scene is 70% of the way IN also drops them the moment it starts
    // leaving, so the outgoing scene snaps dark over the first 30% of its
    // exit and swings the rest of the way as a black plane.
    //
    // So the ramp is placed relative to the direction of travel instead.
    // Both are the same length — whatever is left after `startAt` — just
    // measured from opposite ends: coming in, dark until `startAt` then up
    // over the rest; going out, lit until only `1 - startAt` of presence
    // remains, then down over that.
    const rampLength = Math.max(1 - startAt, 0.001);
    const swept = THREE.MathUtils.clamp(
      directionRef.current === 1
        ? (presence - startAt) / rampLength
        : presence / rampLength,
      0,
      1,
    );

    // Only the scene actually resting at FRONT answers to the preview toggle
    // — the point is to judge the reveal on what's on screen. Without a
    // carousel to ask (this plane used standalone) there's only one scene, so
    // it's always the active one.
    const frontIndex = progressRef?.current?.frontIndex ?? sceneIndex;
    const previewing = Boolean(lightUp?.preview) && frontIndex === sceneIndex;

    // smoothstep — eases in and out, so the lights neither snap on at the
    // threshold nor arrive at full brightness with a visible corner.
    const value = previewing
      ? previewRef.current
      : Math.min(swept, entranceRef.current);
    const eased = value * value * (3 - 2 * value);

    // Rate-limited rather than written straight through, so reversing
    // mid-ramp (which swaps between the two gate curves above) eases across
    // the gap instead of jumping. Converges exactly — once the remaining gap
    // is under one step it takes the whole gap — so a settled scene still
    // lands on precisely 1.0, which is what keeps the plane identical to the
    // untouched video at rest.
    const gap = eased - appliedRef.current;
    const maxStep = delta / LIGHT_MIN_SECONDS;
    appliedRef.current += Math.sign(gap) * Math.min(Math.abs(gap), maxStep);
    uniforms.uLightUp.value = appliedRef.current;
  });
}

// --- clip reveal (the other half of REVEAL_MODE, see Scene.v2.jsx) --------
//
// The alternative to the shader curve above: real rendered clips, cut to
// HARD — no cross-fade anywhere. A scene plays its intro as it swings in,
// cuts to the loop the instant that clip ends, and cuts to its outro (the
// intro reversed, see scripts/make-outros.mjs) as it swings back out. Only
// one texture is ever on the plane, swapped on the single material, so there
// is no second plane, no transparency, no depth ordering, and nothing to
// blend — a cut is exactly a cut.
//
// This only reads as seamless if the clips are rendered from the same setup
// as the loop, since the join is a straight jump between two frames from two
// different files. Where that holds it beats the shader curve (real light
// physics: shadows, caustics, reflections all resolve properly); where it
// doesn't, the join pops and the shader path is the safer option.

// How close to its duration a clip counts as finished. `ended` is the real
// signal — the spec puts currentTime exactly at duration once playback ends,
// so this is only a fallback for a missed event — and it has to stay well
// under one frame (33ms at 30fps). At 0.05 it fired up to 1.5 frames EARLY,
// which cut away the intro's final frames: precisely the ones rendered to
// match the loop's first, so the join skipped content and showed as a jump.
const CLIP_END_EPS = 0.012;

const durationOf = (video) =>
  video && Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : 0;

const playedThrough = (video) => {
  if (!video) return true; // nothing to wait on — don't stall the sequence
  const duration = durationOf(video);
  return (
    video.ended ||
    (duration > 0 && video.currentTime >= duration - CLIP_END_EPS)
  );
};

// Rate the intro/outro clips are played back at — the clip equivalent of the
// shader path's own duration control (see LIGHT_MIN_SECONDS on the light
// branch). 1/1.5 stretches the ~1s render to ~1.5s, so the reveal takes half
// again as long without touching the file.
//
// Note this is a slowdown of an existing 30fps render, not a re-time: the
// same 30 frames are simply held longer, so new content arrives at an
// effective 20fps. Smooth enough at this length; if it reads steppy, the
// higher-quality fix is a genuinely retimed clip (ffmpeg minterpolate)
// rather than a lower rate here.
const CLIP_PLAYBACK_RATE = 1 / 1.5;

// play() can reject (autoplay policy) — these elements are muted, so it
// normally resolves; if it doesn't, the clip holds on its current frame
// rather than the plane going black.
const play = (video) => {
  if (!video) return;
  video.playbackRate = CLIP_PLAYBACK_RATE;
  if (video.paused) video.play().catch(() => {});
};

const startClip = (video, fromTime) => {
  if (!video) return;
  video.playbackRate = CLIP_PLAYBACK_RATE;
  if (video.readyState >= 1) video.currentTime = fromTime;
  video.play().catch(() => {});
};

// How far PAST its own first frame the loop may be at the cut and still count
// as in sync — a few frames in is nearly as good a match (34dB at frame 0,
// ~33.5dB a frame or two later) and costs nothing.
const LOOP_SYNC_WINDOW = 0.15;

// The loop is cued to wrap this long BEFORE the cut rather than exactly on
// it. Landing early is safe (a frame or two into the loop); landing late is
// not, because the frames immediately before the wrap are the loop's LAST
// ones, which are the furthest of all from the intro's closing frame — 27.6dB
// against 34dB, i.e. the single worst frame to cut to. A couple of frames of
// bias buys immunity from every source of timing slop at once.
const LOOP_CUE_LEAD = 0.07;

// The intro's last frame is rendered as the loop's FIRST frame, so the cut
// between them is only the join it was authored to be if the loop is actually
// at frame 0 when it happens. Incoming loops stay parked on frame 0 until
// presence clears PLAY_ABOVE (~0.3; see useVideoPlaneTexture), then play —
// still an arbitrary point in the cycle by the time the intro starts at
// clipStartAt, so the cue below is what actually lands the cut.
//
// Seeking at the cut itself would fix the frame but show one or two stale
// ones first, while the decoder catches up, at the exact moment it's most
// visible. So the loop is cued the moment the intro STARTS instead: parked
// far enough back that it wraps around to 0 on its own, at 1x, precisely as
// the intro ends. The seek then has the intro's whole duration to settle.
//
// Safe despite the element being shared between scenes: a scene only reaches
// its intro while swinging IN, which means the one other scene on screen is
// swinging out and showing its outro, not the loop.
const cueLoopForCut = (loopVideo, secondsUntilCut) => {
  const duration = durationOf(loopVideo);
  if (!duration || loopVideo.readyState < 1) return;
  const target =
    (duration - (secondsUntilCut % duration) + duration) % duration;
  // Only seek somewhere already buffered. Should always hold now that the
  // file is played from memory (see videoBlobCache), but on the fallback
  // streaming path an unbuffered seek stalls the element and parks a stale
  // frame on the plane — worse than simply not cueing, which costs a poorer
  // frame match but keeps the motion continuous.
  if (!isBuffered(loopVideo, target)) return;
  loopVideo.currentTime = target;
};

// Safety net for the cue above, applied at the cut: if playback drifted far
// enough to matter (a late autoplay start, a stalled decode), snap. That
// costs the stale-frame hiccup the cue exists to avoid, but only in the case
// where the alternative is a visibly wrong join.
const syncLoopToStart = (loopVideo) => {
  const duration = durationOf(loopVideo);
  if (!duration) return;
  // Anything outside the window just after the wrap is real drift, INCLUDING
  // the pre-wrap tail: that used to be treated as "about to wrap, leave it",
  // which is how the cut ended up landing on the loop's final frame.
  const at = loopVideo.currentTime;
  if (at > LOOP_SYNC_WINDOW && isBuffered(loopVideo, 0)) {
    loopVideo.currentTime = 0;
  }
};

const rewind = (video) => {
  if (!video) return;
  if (!video.paused) video.pause();
  if (video.currentTime !== 0) video.currentTime = 0;
};

// Same `presence` signal the shader path uses (see useLightUp), driving a
// four-phase sequence instead of a continuous curve:
//
//   "wait"  — swinging in, not far enough yet (see startAt). The intro sits
//             paused on its own first frame, which the render opens on black.
//   "intro" — intro playing forward.
//   "loop"  — intro finished; cut to the endless loop.
//   "outro" — scene swinging out; cut to the outro, which plays back to black.
//
// A scene that turns around MID-intro hands over at the mirrored timestamp:
// the outro is the intro reversed, so `outroDuration - introTime` is the very
// same frame, and that particular cut is exact rather than merely close.
function useClipReveal({
  enabled,
  introRef,
  outroRef,
  materialRef,
  loopTexture,
  introTexture,
  outroTexture,
  progressRef,
  sceneIndex,
  startAt,
}) {
  const phaseRef = useRef("wait");
  const directionRef = useRef(1);
  const lastPresenceRef = useRef(null);

  useFrame(() => {
    if (!enabled) return;
    const intro = introRef.current;
    const outro = outroRef.current;
    // The <video> behind the loop texture — the shared, always-playing one
    // from useVideoPlaneTexture. On Safari this is a CanvasTexture whose
    // source element lives on userData.video (see mediaOf).
    const loopVideo = mediaOf(loopTexture);

    const step = progressRef?.current?.step;
    const presence =
      typeof step === "number"
        ? THREE.MathUtils.clamp(1 - Math.abs(step - sceneIndex), 0, 1)
        : 1;
    const previous = lastPresenceRef.current ?? presence;
    lastPresenceRef.current = presence;
    const dPresence = presence - previous;
    if (dPresence > PRESENCE_EPS) directionRef.current = 1;
    else if (dPresence < -PRESENCE_EPS) directionRef.current = -1;

    if (presence <= 0) {
      // Parked and off screen: rewind both clips and re-arm, where no one can
      // see it happen.
      phaseRef.current = "wait";
      directionRef.current = 1;
      rewind(intro);
      rewind(outro);
    } else {
      switch (phaseRef.current) {
        case "wait":
          if (directionRef.current === 1 && presence >= startAt) {
            phaseRef.current = "intro";
            // Cue now, while there's a whole intro's worth of time for the
            // seek to land, so the loop reaches its first frame exactly as
            // the intro hands over.
            // In WALL-CLOCK seconds, not media seconds: the intro runs at
            // CLIP_PLAYBACK_RATE while the loop being cued runs at 1x, so
            // the remaining clip time has to be divided by the rate or the
            // loop wraps early and is already past its first frame when the
            // cut lands.
            cueLoopForCut(
              loopVideo,
              Math.max(
                0,
                Math.max(0, durationOf(intro) - (intro?.currentTime ?? 0)) /
                  CLIP_PLAYBACK_RATE -
                  LOOP_CUE_LEAD,
              ),
            );
          }
          break;
        case "intro":
          if (directionRef.current === -1) {
            startClip(
              outro,
              Math.max(0, durationOf(outro) - (intro?.currentTime ?? 0)),
            );
            intro?.pause();
            phaseRef.current = "outro";
          } else if (playedThrough(intro)) {
            // Checked BEFORE play(): calling play() on an already-ended,
            // non-looping video restarts it from time 0 per spec (paused
            // and ended both read true at that point, which looks
            // identical to "just paused, needs a nudge" to play() below).
            // Playing first and checking after raced this exact frame —
            // the restart lands before the finished-check sees it, so the
            // intro replays from the top instead of handing off to the loop.
            intro?.pause();
            syncLoopToStart(loopVideo);
            phaseRef.current = "loop";
          } else {
            play(intro);
          }
          break;
        case "loop":
          if (directionRef.current === -1) {
            startClip(outro, 0);
            phaseRef.current = "outro";
          }
          break;
        case "outro":
          if (directionRef.current === 1) {
            // Gesture cancelled — back to the loop. The intro is not replayed:
            // this visit already had it.
            outro?.pause();
            phaseRef.current = "loop";
          } else if (!playedThrough(outro)) {
            // Same play()-before-check race as the intro branch above: check
            // finished first so an already-ended outro isn't resurrected and
            // replayed instead of holding its last (black) frame.
            play(outro);
          }
          break;
        default:
          break;
      }
    }

    // The cut itself: one material, one map, swapped outright.
    const phase = phaseRef.current;
    const next =
      phase === "loop"
        ? loopTexture
        : phase === "outro"
          ? (outroTexture ?? introTexture)
          : introTexture;
    const material = materialRef.current;
    if (material && next && material.map !== next) {
      // null -> texture flips three's own USE_MAP define, which needs a
      // recompile; texture -> texture is just a different binding.
      const needsRecompile = !material.map;
      material.map = next;
      if (needsRecompile) material.needsUpdate = true;
    }

    // Force the plane black for the whole wait, instead of trusting whatever
    // texture happens to be bound to be showing black. The intro's own first
    // frame IS black, but it isn't necessarily what's on the plane yet: the
    // material starts out bound to the LOOP texture (the intro's doesn't
    // exist until its effect has run), and a VideoTexture whose element
    // hasn't decoded a frame yet has no defined content either. basic
    // material multiplies map by color, so this is an opaque black wall
    // regardless of both.
    if (material) {
      const tint = phase === "wait" ? 0 : 1;
      if (material.color.r !== tint) material.color.setScalar(tint);
    }
  });
}

// Drop-in placeholder for a scene's real `Component` (see SCENES in
// Scene.v2.jsx) — a full-bleed plane playing this scene's looping video
// instead of the authored 3D scene, revealed one of two ways as the scene
// swings in and out:
//
//   introUrl absent  -> the shader curve (see LIGHT_UP_FRAGMENT), derived
//                       from the loop footage itself
//   introUrl present -> that scene's rendered intro/outro clips, hard cut
//                       (see useClipReveal)
//
// Which one arrives is Scene.v2.jsx's REVEAL_MODE flag: it either passes the
// clip URLs down or it doesn't. A scene with no intro authored therefore
// falls back to the shader path on its own, even in clip mode, rather than
// having no reveal at all.
export default function VideoPlaneV2({
  visible,
  videoUrl,
  introUrl,
  outroUrl,
  sceneIndex = 0,
  progressRef,
  lightUp,
  // True only for the one scene resting at FRONT on first paint (see
  // Scene.v2.jsx's SCENES.map, index 0) — this is the ONE video the user
  // actually sees the instant the section reveals, so it alone gets fetch
  // priority over the other four scenes' files (see videoBlobCache.js's own
  // comment on that bandwidth contention). It does NOT hold PreloaderV2:
  // the boot overlay is the intro hero, and this clip has that whole reel
  // plus a scroll to finish fetching.
  isInitialScene = false,
  // Scene-to-product handoff (see useSceneToProductHandoff) — only wired up
  // for the last scene's plane, so its own gsap timeline can fade this
  // material's opacity to 0. `transparent` is a render-state flag, not a
  // shader #define, so flipping it later doesn't force a recompile of the
  // program every plane instance shares.
  onMaterialReady,
}) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);
  // `visible` is the coarse mesh gate (section + visibleIndices). Loop
  // decode is tighter: presence > ~0.3 to start, BACK to stop — see
  // useVideoPlaneTexture's PLAY_ABOVE. One-shots stay on the clip sequence.
  const texture = useVideoPlaneTexture(
    videoUrl,
    visible,
    { progressRef, sceneIndex },
    // High fetch priority for the scene resting at FRONT, but do NOT
    // `trackLoad` it — holding PreloaderV2 for a carousel clip the user
    // hasn't scrolled to yet made the intro hero wait on a video it doesn't
    // show. The file still starts fetching at mount (and wins the scheduler
    // over the other four), so it's ready by the time the carousel is.
    isInitialScene ? { priority: 'high' } : { priority: 'low' },
  );
  const intro = useOneShotVideoTexture(
    introUrl,
    isInitialScene ? { priority: 'high' } : { priority: 'low' },
  );
  const outro = useOneShotVideoTexture(
    outroUrl,
    isInitialScene ? { priority: 'high' } : { priority: 'low' },
  );
  // Loop pause is owned by useVideoPlaneTexture (presence gate + onScreen).
  // One-shots are driven from useClipReveal's useFrame, which does not run
  // while the Canvas frameloop is parked — so leaving the section mid-intro
  // would keep those clips decoding. Park them here the moment the plane
  // leaves view.
  useEffect(() => {
    if (visible) return undefined;
    rewind(intro.videoRef.current);
    rewind(outro.videoRef.current);
    return undefined;
  }, [visible, intro.videoRef, outro.videoRef]);
  // Decided once, from static scene data — no plane ever switches paths
  // mid-life, so the material can be built for one or the other.
  const clipReveal = Boolean(introUrl);
  // Owned per plane (each scene reveals on its own schedule) and stable for
  // the material's lifetime, since three keeps the very objects handed to it
  // in onBeforeCompile and reads .value straight off them every frame.
  const uniformsRef = useRef({
    uLightUp: { value: 0 },
    uLightSoftness: { value: DEFAULT_LIGHT_UP.softness },
    uLightBoost: { value: DEFAULT_LIGHT_UP.boost },
    uLightFloor: { value: DEFAULT_LIGHT_UP.floor },
  });

  // Patched onto three's own MeshBasicMaterial shader rather than replacing
  // it with a ShaderMaterial — that keeps the whole colour pipeline (the
  // video texture's sRGB decode, output colour space, the `toneMapped={false}`
  // opt-out) exactly as three defines it, instead of this having to
  // re-implement it and drift.
  const onBeforeCompile = useCallback((shader) => {
    Object.assign(shader.uniforms, uniformsRef.current);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${LIGHT_UP_UNIFORMS}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\n${LIGHT_UP_FRAGMENT}`,
      );
  }, []);
  const programCacheKey = useCallback(() => PROGRAM_CACHE_KEY, []);

  // These planes are finished renders — their glow is already baked into the
  // footage — so the app's own bloom pass must leave them alone or it blooms
  // an already-bloomed image. See bloomExclusion for the full reasoning.
  useEffect(() => excludeFromBloom(meshRef.current), []);
  useEffect(() => {
    onMaterialReady?.(materialRef.current);
  }, [onMaterialReady]);

  useFillFrustum(meshRef, texture, visible);
  useLightUp({
    enabled: !clipReveal,
    uniformsRef,
    progressRef,
    sceneIndex,
    lightUp,
  });
  useClipReveal({
    enabled: clipReveal,
    introRef: intro.videoRef,
    outroRef: outro.videoRef,
    materialRef,
    loopTexture: texture,
    introTexture: intro.texture,
    outroTexture: outro.texture,
    progressRef,
    sceneIndex,
    // The clip path's own start, NOT the shader's — see lightUpDefaults for
    // why the two are tuned separately.
    startAt: lightUp?.clipStartAt ?? DEFAULT_LIGHT_UP.clipStartAt,
  });

  return (
    <mesh ref={meshRef} visible={visible}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={materialRef}
        // In clip mode this is only the STARTING map — useClipReveal swaps it
        // for the intro/outro textures as the sequence runs.
        map={clipReveal ? (intro.texture ?? texture) : texture}
        toneMapped={false}
        side={THREE.DoubleSide}
        onBeforeCompile={clipReveal ? undefined : onBeforeCompile}
        customProgramCacheKey={clipReveal ? undefined : programCacheKey}
      />
    </mesh>
  );
}
