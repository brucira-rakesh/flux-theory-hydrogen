export const FRAME_COUNT = 280
export const FRAMES_PER_USP = 56
export const SCROLL_MULTIPLIER = 7

const chipFrameModules = import.meta.glob('../assets/chip-frames/*.webp', {
  eager: true,
  import: 'default',
})

/** Sorted frame URLs — index 0 maps to Comp_00000.webp, index 279 maps to Comp_00279.webp. */
export const FRAME_URLS = Object.entries(chipFrameModules)
  .sort(([pathA], [pathB]) => {
    const numA = Number(pathA.match(/(\d+)\.webp$/)?.[1] ?? 0)
    const numB = Number(pathB.match(/(\d+)\.webp$/)?.[1] ?? 0)
    return numA - numB
  })
  .map(([, url]) => url)

export function getFramePath(index) {
  const clamped = Math.max(0, Math.min(FRAME_COUNT - 1, index))
  return FRAME_URLS[clamped] ?? ''
}

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
]

export function getActiveHighlightIndex(frame) {
  return Math.min(
    highlights.length - 1,
    Math.floor(Math.max(0, frame) / FRAMES_PER_USP),
  )
}

export function getHighlightScrollProgress(index) {
  return Math.min(1, Math.max(0, index / highlights.length))
}

export function getHighlightStartFrame(index) {
  return highlights[index]?.startFrame ?? index * FRAMES_PER_USP
}
