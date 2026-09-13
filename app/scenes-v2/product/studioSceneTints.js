// Per-scene accent colour for the bottle's studio rig.
//
// BottleStudioLights ports Bottle.blend's rig verbatim — including a single
// magenta DISK area light, "Area.007", hung high above and slightly behind
// the bottle. That light is the rig's ACCENT: a broad soft source whose
// colour lands as a top/rim wash down the bottle's shoulders and cap rather
// than as general fill, which is what makes it the one light worth
// re-colouring per scene. Every other light in the rig stays exactly as
// Blender authored it, so the shot's shaping/contrast never changes — only
// its accent hue does.
//
// The carousel's five scenes are five very differently-lit rooms (see
// SCENES in Scene.v2.jsx and each scene's own loop): a rose cave at a peach
// sunset, a burning red seascape, a green mist room, a lilac/periwinkle
// dream room, and a pink-gold lover's bath. The rig's authored magenta only
// actually belongs to the pink/lilac rooms — over the green and the red one
// it reads as a stray purple gel fighting the backdrop. Hence a hue per
// scene, cross-faded on the swing (see TINT_DURATION_SEC).
//
// Because this is a rim rather than a kicker, the hues below stay lighter
// and less saturated than a front light's would: at this angle the colour
// rides the bottle's edges, and a fully saturated one stops reading as
// light and starts reading as painted-on plastic.
//
// Colours are stored as sRGB hex — the same space lil-gui's colour picker
// works in, and the same round trip THREE.Color.set(hex) /
// color.getHexString() does — so a value dialled in from the debug panel can
// be pasted straight back in here. (The Blender floats in BottleStudioLights
// are LINEAR, which is why they look far more saturated as numbers than the
// hexes below: the authored [1.0, 0.3413, 0.9861] is ≈ #ff9efe on screen.)

// Which lights take a per-scene tint at all. Everything not listed keeps its
// Blender colour untouched, in every scene.
export const TINTED_LIGHT_NAMES = ["Area.007"];

// Scene ids, in the carousel's own order (see SCENES in Scene.v2.jsx), with
// the room each one shows and the bottle it carries — used to label the
// debug panel's scene dropdown and, on /bottle-studio, to put the matching
// backdrop loop and bottle label behind/on the shot being tinted. Ids and
// personas must stay in step with SCENES; the loop files stay in the page
// that imports them (this module is asset-free on purpose, so the carousel
// can import it without pulling five more mp4s into that chunk).
export const STUDIO_SCENES = [
  { id: "one", label: "One — rose cave", persona: "sport" },
  { id: "five", label: "Five — red sunset", persona: "rebel" },
  { id: "two", label: "Two — green mist", persona: "sage" },
  { id: "three", label: "Three — lilac dream", persona: "dreamer" },
  { id: "four", label: "Four — pink lover", persona: "lover" },
];

export const DEFAULT_STUDIO_SCENE_ID = STUDIO_SCENES[0].id;

// { 'Nice label': 'id' } — the shape lil-gui's `add(obj, prop, options)`
// wants for a labelled dropdown.
export const STUDIO_SCENE_OPTIONS = Object.fromEntries(
  STUDIO_SCENES.map((s) => [s.label, s.id]),
);

// Mutable on purpose: the debug panel writes dialled-in values straight back
// into this table (see setSceneTint) so a scene can be re-tinted live and
// then exported with serializeSceneTints() for pasting back above.
export const SCENE_LIGHT_TINTS = {
  // Rose/mauve cave under a lavender ceiling strip, peach horizon: the
  // authored magenta warmed towards the room's own blush.
  one: { "Area.007": "#ffa6c8" },
  // Everything in frame is burning orange-red. Magenta is the one hue that
  // reads as a mistake here — the rim goes warm amber and joins the sunset.
  five: { "Area.007": "#ffa171" },
  // Green mist. A pale aqua rim keeps the bottle inside the room's own
  // light instead of wearing a purple gel over it.
  two: { "Area.007": "#a8ffe0" },
  // Lilac ceiling, periwinkle shadows, pink sky — the one room the authored
  // magenta nearly fits; pulled towards periwinkle to match the shadows.
  three: { "Area.007": "#cbb0ff" },
  // Pink sky over gold candlelight. The backdrop is already pink, so a warm
  // gold rim is what actually separates the bottle from it.
  four: { "Area.007": "#ffc9a3" },
};

// Used when a scene has no entry (or a light has none): the light keeps the
// colour Blender authored for it, i.e. no tint at all.
export function getSceneTint(sceneId, lightName) {
  return SCENE_LIGHT_TINTS[sceneId]?.[lightName] ?? null;
}

export function setSceneTint(sceneId, lightName, hex) {
  if (!SCENE_LIGHT_TINTS[sceneId]) SCENE_LIGHT_TINTS[sceneId] = {};
  SCENE_LIGHT_TINTS[sceneId][lightName] = hex;
}

// Seconds the cross-fade to a new scene's tint takes. Matched to
// swingCarousel's own COMMIT_DURATION (1.1s) so on the home page the colour
// travels with the swing that caused it instead of arriving after it.
export const TINT_DURATION_SEC = 1.1;

// Pasteable replacement for the SCENE_LIGHT_TINTS literal above — the debug
// panel's "Copy tints JSON" button logs/copies this, so a session spent
// dialling colours in the browser ends as a one-line edit to this file.
export function serializeSceneTints() {
  return JSON.stringify(SCENE_LIGHT_TINTS, null, 2);
}
