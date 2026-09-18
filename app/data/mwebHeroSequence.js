// ============================================================================
// Scenev2mweb — frame source + scene timeline.
//
// >>> THIS IS THE ONLY FILE YOU NEED TO EDIT WHEN THE SEQUENCE CHANGES. <<<
//
// Frames are picked up automatically from src/assets/mweb-hero-seq/*.webp
// (sorted by the trailing number in the filename), so dropping in a new
// render updates FRAME_COUNT on its own. What you DO have to retune by hand
// is the SCENES block below — the frame numbers that describe each scene's
// boundaries.
//
// Source render: Mweb_Hero_00001.webp .. Mweb_Hero_00345.webp (345 frames,
// portrait, q80 webp — see src/assets/mweb-hero-seq/). It's one continuous
// bake of all 5 bottle variants: a settled "float" shot of each bottle in its
// own environment, connected by a quick whip-pan/motion-blur spin that wipes
// to black and reveals the next bottle.
//
// Every frame number in SCENES below was picked by eyeballing sampled frames
// (and a per-frame pixel-diff scan to locate the whip-pan spikes) — not a
// frame-accurate scrub. Treat them as a starting point; nudge them if a swipe
// lands mid-blur or the idle loop shows a seam. Numbers here are 1-indexed to
// match the source filenames directly (Mweb_Hero_00059.webp -> 59) — the
// exports further down convert to 0-based playback indices.
//
// Each scene owns a contiguous frame range [start, end]:
//   start     the first clean (settled) frame of this scene — where a swipe
//             transition lands.
//   loopEnd   last frame of the safe idle range — the scene idles by
//             ping-ponging [start, loopEnd] so it's never a dead freeze.
//   end       last frame this scene owns, i.e. nextScene.start - 1. The span
//             (loopEnd, end] is the whip-pan OUT of this scene into the next
//             one — only ever played during a committed swipe, never looped.
//
// The last scene has no outgoing whip (nothing to swipe forward into), so its
// `end` is just the final frame of the render and loopEnd sits a few frames
// before it purely so the idle loop doesn't ride the very last frames (in
// case the bake fades/settles oddly right at the end).
// ============================================================================

const modules = import.meta.glob("../assets/mweb-hero-seq/*.webp", {
  eager: true,
  import: "default",
});

export const FRAME_URLS = Object.entries(modules)
  .map(([path, url]) => [Number(path.match(/(\d+)\.webp$/)?.[1] ?? 0), url])
  .filter(([n]) => n > 0)
  .sort(([a], [b]) => a - b)
  .map(([, url]) => url);

export const FRAME_COUNT = FRAME_URLS.length;
export const LAST_FRAME = Math.max(0, FRAME_COUNT - 1);

export function getMwebHeroFramePath(index) {
  const clamped = Math.max(0, Math.min(LAST_FRAME, index));
  return FRAME_URLS[clamped] ?? "";
}

// --- SCENES ── edit these frame numbers ────────────────────────────────────
// 1-indexed source frame numbers, converted to 0-based playback indices below.
const SCENES_1_INDEXED = [
  { id: "sport", label: "The Sport", start: 22, loopEnd: 51 },
  { id: "sage", label: "The Sage", start: 110, loopEnd: 149 },
  { id: "rebel", label: "The Rebel", start: 194, loopEnd: 218 },
  { id: "lover", label: "The Lover", start: 275, loopEnd: 308 },
  { id: "dreamer", label: "The Dreamer", start: 348, loopEnd: 383 },
];

function clampFrame(value) {
  return Math.max(0, Math.min(LAST_FRAME, Math.round(value)));
}

/**
 * Resolves SCENES_1_INDEXED into 0-based playback indices with `end` filled
 * in as the next scene's `start - 1` (last scene's `end` is the final frame).
 */
function resolveScenes(scenes) {
  return scenes.map((scene, index) => {
    const start = clampFrame(scene.start - 1);
    const loopEnd = clampFrame(scene.loopEnd - 1);
    const nextStart =
      index < scenes.length - 1
        ? clampFrame(scenes[index + 1].start - 1)
        : LAST_FRAME + 1;
    const end = clampFrame(nextStart - 1);
    return {
      id: scene.id,
      label: scene.label,
      start,
      loopEnd: Math.max(start, Math.min(loopEnd, end)),
      end,
    };
  });
}

export const SCENES = resolveScenes(SCENES_1_INDEXED);

// --- Playback feel ──────────────────────────────────────────────────────────

/** Idle ping-pong speed within a scene's [start, loopEnd], in frames/sec. */
export const LOOP_FPS = 24;

/** Fixed wall-clock duration (seconds) a committed swipe takes to animate
 *  from wherever the playhead currently sits to the target scene's `start` —
 *  NOT a frame speed, so every commit takes the same time to land regardless
 *  of how far the frames are apart, just covering more/fewer of them per
 *  second to do it. */
export const TRANSITION_DURATION_SEC = 1.5;

/** Vertical drag distance (px) below which a touch is treated as a tap or
 *  jitter, not a swipe. There is no larger "commit" threshold above this —
 *  ANY swipe past the dead zone advances to the next/previous scene; this
 *  purely tells a real gesture apart from an accidental micro-move. */
export const SWIPE_DEAD_ZONE_PX = 6;
