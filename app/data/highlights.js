export const FRAME_COUNT = 280;
export const FRAMES_PER_USP = 56;
export const SCROLL_MULTIPLIER = 7;

const chipFrameModules = import.meta.glob('../assets/chip-frames/*.webp', {
  eager: true,
  import: 'default',
});

/** Sorted frame URLs — index 0 maps to Comp_00000.webp, index 279 maps to Comp_00279.webp. */
export const FRAME_URLS = Object.entries(chipFrameModules)
  .sort(([pathA], [pathB]) => {
    const numA = Number(pathA.match(/(\d+)\.webp$/)?.[1] ?? 0);
    const numB = Number(pathB.match(/(\d+)\.webp$/)?.[1] ?? 0);
    return numA - numB;
  })
  .map(([, url]) => url);

export function getFramePath(index) {
  const clamped = Math.max(0, Math.min(FRAME_COUNT - 1, index));
  return FRAME_URLS[clamped] ?? '';
}

// SeawaveSeq's frame source and scroll timeline now live in
// data/seawaveSequence.js — everything below is just the copy overlaid on it.

export const highlights = [
  {
    id: 'pure-foundation',
    label: 'PURE FOUNDATION',
    title: 'PURE FOUNDATION',
    description:
      'A clean, considered base built for skin — refined ingredients selected to prepare, protect, and elevate everything that follows.',
    startFrame: 0,
    endFrame: 55,
  },
  {
    id: 'engineered-texture',
    label: 'ENGINEERED TEXTURE',
    title: 'ENGINEERED TEXTURE',
    description:
      'Precision-formulated for a sensorial finish that feels intentional on contact — neither heavy nor fleeting, but exactly calibrated.',
    startFrame: 56,
    endFrame: 111,
  },
  {
    id: 'signature-scent',
    label: 'SIGNATURE SCENT',
    title: 'SIGNATURE SCENT',
    description:
      'Layered notes composed to linger with character — a fragrance profile designed to become unmistakably yours over time.',
    startFrame: 112,
    endFrame: 167,
  },
  {
    id: 'shift',
    label: 'SHIFT',
    title: 'THE SHIFT',
    description: "Because confidence isn't fixed.\nNeither are you.",
    startFrame: 168,
    endFrame: 223,
  },
  {
    id: 'the-result',
    label: 'THE RESULT',
    title: 'THE RESULT',
    description:
      'The complete expression — where formulation, texture, and scent converge into one refined, finished experience.',
    startFrame: 224,
    endFrame: 279,
  },
];

// SeawaveSeq's own copy of `highlights` (see useSeawaveSeq/SeawaveSeq.jsx) —
// same ids/frames/copy for now (still the KeyHighlightsV2 placeholder
// sequence), duplicated so it can diverge independently. `titleClassName`/
// `descriptionClassName`/`labelClassName` are per-item Tailwind overrides
// layered on top of SeawaveSeq's base title/description/nav-label classes
// (see className merging there), so each highlight can position its own
// title, description, and nav label differently — leave '' to keep the base
// layout for that item.
export const seawaveHighlights = [
  {
    id: 'panel-1',
    title: ['Designed For Every', 'Version Of You'],
    description: '',
    startFrame: 0,
    endFrame: 272,
    titleClassName:
      'md:left-[50vw] md:top-[50vh] md:-translate-x-1/2 md:-translate-y-1/2 text-center',
    descriptionClassName: 'md:left-[clamp(1.25rem,3.5vw,3.25rem)]',
    labelClassName: '',
  },
  // {
  //   id: "panel-2",
  //   title: "Designed For Every Version Of You",
  //   description: "Every fragrance reflects a different state. Because life never asks the same thing twice.",
  //   startFrame: 61,
  //   endFrame: 145,
  //   titleClassName: "md:left-[clamp(1.25rem,3.5vw,3.25rem)] md:top-[50vh] md:-translate-y-1/2 md:max-w-[min(60vw,36rem)]",
  //   descriptionClassName: "md:left-[clamp(1.25rem,3.5vw,3.25rem)]",
  //   labelClassName: "",
  // },
  // {
  //   id: "panel-3",
  //   title: "It’s about becoming exactly who the moment demands.",
  //   description: "Every fragrance reflects a different state. Because life never asks the same thing twice.",
  //   startFrame: 160,
  //   endFrame: 203,
  //   titleClassName: "md:left-[50vw] md:top-[50vh] md:-translate-x-1/2 md:-translate-y-1/2 md:text-center",
  //   descriptionClassName: "text-center left-[50vw] -translate-x-1/2",
  // },
  // {
  //   id: "panel-4",
  //   title: "Every bottle represents a different mindset.",
  //   description: "Every fragrance reflects a different state. Because life never asks the same thing twice.",
  //   startFrame: 204,
  //   endFrame: 272,
  //   titleClassName: "md:right-[clamp(1.25rem,3.5vw,3.25rem)] md:top-[50vh] md:-translate-y-1/2 md:max-w-[min(60vw,36rem)] md:text-right",
  //   descriptionClassName: "md:right-[clamp(1.25rem,3.5vw,3.25rem)]",
  //   labelClassName: "",
  // },
  // {
  //   id: "panel-5",
  //   label: "THE RESULT",
  //   title: "THE RESULT",
  //   description:
  //     "Every fragrance reflects a different state. Because life never asks the same thing twice.",
  //   startFrame: 224,
  //   endFrame: 279,
  //   titleClassName: "",
  //   descriptionClassName: "",
  //   labelClassName: "",
  // },
];

export function getActiveHighlightIndex(frame, list = highlights) {
  return Math.min(
    list.length - 1,
    Math.floor(Math.max(0, frame) / FRAMES_PER_USP),
  );
}

export function getHighlightScrollProgress(index, list = highlights) {
  return Math.min(1, Math.max(0, index / list.length));
}

export function getHighlightStartFrame(index, list = highlights) {
  return list[index]?.startFrame ?? index * FRAMES_PER_USP;
}

/**
 * Which copy panel belongs to `frame`, driven by the startFrame/endFrame
 * ranges above rather than a fixed frames-per-panel stride — SeawaveSeq's
 * panels are uneven and no longer tied to the 280-frame chip sequence.
 * Assumes the list is in ascending frame order.
 */
export function getSeawaveHighlightIndex(frame, list = seawaveHighlights) {
  const value = Math.max(0, frame);
  for (let i = 0; i < list.length; i += 1) {
    if (value <= (list[i].endFrame ?? Number.POSITIVE_INFINITY)) return i;
  }
  return list.length - 1;
}
