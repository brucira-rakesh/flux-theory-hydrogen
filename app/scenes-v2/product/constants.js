import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

// Ported verbatim from src/pages/Product.jsx — see that file's own comments
// for the reasoning behind each of these; this module only holds the values.

export const MODEL_URL = oxygenPublicUrl("/models/washroom_compressed.glb");
export const TEXTURE_URL = oxygenPublicUrl("/textures/bathroom_etc1s.ktx2");

export const BATHROOM_BOTTLE_MODEL_URL = oxygenPublicUrl("/models/bathroom_bottle.glb");

// The specific bathroom-bottle node the carousel's flavor bottle "becomes"
// once the scene-to-product handoff lands it — see useSceneToProductHandoff
// and useProductAssets' own bathroomBox (fitted to just this node, not the
// whole bathroom_bottle.glb, which bundles all five shelf bottles under one
// root — fitting to the whole model was what made the shadow-catcher plane
// balloon out to ~2.5x the ENTIRE shelf's width instead of one bottle's).
export const FLIGHT_TARGET_NODE_NAME = "NEW_BASE011";

export const CAMERA_MODEL_URL = oxygenPublicUrl("/models/Camera.glb");

// Toggles whether the second authored camera ("Camera.002"/"Camera.002Action")
// plays at all. false: scroll progress maps across ONLY camera one's clip
// duration, and camera one stays the active render camera for the whole
// scroll range — camera two's clip/object are never even loaded or driven.

// Scroll distance (in viewport heights) product's range occupies once the
// cloud transition has landed. This is now PURELY a linger beat: how long
// the finished shot stays pinned, with the "+" hotspots up and clickable,
// before KeyHighlightsV2/VideoHeroV2 scroll up over it.
//
// It used to also carry a CAMERA_SCRUB_VH of 300vh, which the flythrough
// camera was scrubbed across. useProductAutoZoom now plays that motion on a
// timer instead (see its own comment), so nothing reads scroll position for
// it any more — and leaving the 300vh allocation in place just meant 300vh
// of DEAD scroll between the zoom landing and the section finally releasing.
export const HOLD_SCROLL_VH = 10;
export const SCROLL_LENGTH_VH = HOLD_SCROLL_VH;
// How far through the ZOOM ITSELF (0-1) the "+" hotspots fire their
// staggered reveal. Below 1 so they start arriving while the room is still
// easing into its final framing, rather than only after it has fully
// stopped.
export const HOTSPOT_REVEAL_AT_SCRUB_PROGRESS = 0.86;

// Deadband (seconds of clip-time) around the clip-one/clip-two boundary that
// the render-camera swap must clear before flipping back.

// --- "+" hotspot overlay (one per clickable bottle node) ---
// One DOM button per revealNode, positioned every frame by projecting that
// node's world-space bounding box onto screen space (see useProductHotspots).
// Only ever shown once scroll has scrubbed past the flythrough and crossed
// into the hold zone, at which point every button fades in one after another
// as a ONE-TIME staggered reveal — not something that fades in/out
// continuously as you scroll.
export const HOTSPOT_FADE_DURATION = 0.45; // seconds, each individual button's own fade-in
export const HOTSPOT_STAGGER_DELAY = 0.09; // seconds between each successive button starting its fade-in
export const HOTSPOT_OFFSCREEN_MARGIN_PX = 24; // slack outside the viewport a hotspot is still allowed to show at

// Every button is auto-placed at the screen-space TOP-LEFT corner of its
// bottle's projected bounding box. That's a decent default but it's a box
// corner, not an eye-judged spot, so each one can be nudged from there in
// SCREEN PIXELS: +x right, +y down. Keyed by node.name ("NEW_BASE0XX");
// anything not listed falls back to DEFAULT_HOTSPOT_OFFSET.
export const DEFAULT_HOTSPOT_OFFSET = { x: 0, y: 0 };
export const HOTSPOT_OFFSET_OVERRIDES = {
  NEW_BASE011: { x: 70, y: 0 },
  NEW_BASE014: { x: 0, y: 0 },
  NEW_BASE016: { x: 65, y: 50 },
  NEW_BASE018: { x: 0, y: 50 },
  NEW_BASE009: { x: 0, y: 50 },
  NEW_BASE001: { x: 0, y: 0 },
  NEW_BASE003: { x: 0, y: 0 },
  NEW_BASE007: { x: 0, y: 0 },
};

// `-translate-x-1/2 -translate-y-1/2` centres the button on the point
// useProductHotspots computes for it, and is PERMANENT — nothing may
// re-declare it. That's why the pop is expressed as `scale-*` rather than a
// full `transform:` shorthand: Tailwind v4 compiles `scale-*` to the
// standalone CSS `scale` property and `translate-*` to `translate`, so the
// two compose independently.
export const HOTSPOT_BTN_CLASS =
  "product-plus-hotspot absolute z-[9] grid size-[clamp(32px,2.8vw,20px)] -translate-x-1/2 -translate-y-1/2 scale-100 appearance-none place-items-center rounded-full border-0 bg-transparent p-0 shadow-none backdrop-blur-[3.5px] transition-[opacity,scale] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] [-webkit-tap-highlight-color:transparent] enabled:cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#2a6db5] disabled:cursor-default";

// Added to a button while its OWN bottle is hovered in the 3D scene. Scales
// only — the centring translate on the base class is left untouched.
//
// The self-hover variants matter because the button sits ON TOP of its
// bottle: moving the pointer onto it stops the canvas receiving pointermove
// and the raycast reports no hit, so without them the button would pop back
// down the instant the pointer reached it. Same scale value in both cases,
// so crossing that boundary is visually seamless.
export const HOTSPOT_HOVER_CLASS = "scale-125";
export const HOTSPOT_SELF_HOVER_CLASS = "hover:scale-125 focus-visible:scale-125";

export const INTERACTIVE_MESH_NAME_PREFIX = "NEW_BASE";

// Node.name -> products.js id. bathroom_bottle.glb bundles all five shelf
// bottles under one root (see useProductAssets' own comment); confirmed by
// extracting each node's baked label texture from the glTF directly (mesh0
// "sage_front", mesh1 "lover_front", mesh2 "rebel_front", mesh3
// "sport_front", mesh4 "dreamer_front" — GLTFLoader's node order matches
// NEW_BASE009/011/014/016/018 below). Lets ProductOverlayV2 show the actual
// clicked bottle's data instead of a single hardcoded placeholder.
export const NODE_PRODUCT_ID_MAP = {
  NEW_BASE009: "the-sage",
  NEW_BASE011: "the-lover",
  NEW_BASE014: "the-rebel",
  NEW_BASE016: "the-sport",
  NEW_BASE018: "the-dreamer",
};

export const DEFAULT_SPIN_DEGREES = 360;
export const SPIN_DEGREES_OVERRIDES = {};

export const DEFAULT_FINAL_ROTATION_DEGREES = 0;
export const FINAL_ROTATION_OVERRIDES = {
  NEW_BASE011: -22,
  NEW_BASE014: -33,
  NEW_BASE016: 35,
  NEW_BASE018: 15,
  NEW_BASE001: -56,
  NEW_BASE003: -18,
  NEW_BASE007: -31,
};

export const MAX_BLUR_RADIUS = 8;
export const DEFAULT_MASK_FEATHER_RADIUS = 3;
