import towels from '../assets/shelf/towel.png'
import loofah from '../assets/shelf/loofah.png'
import soap from '../assets/shelf/soap.png'
import glassShelfTop from '../assets/shelf/glass-shelf-top.png'
import glassShelfBottom from '../assets/shelf/glass-shelf-bottom.png'

/**
 * Decorative shelf elements — percentage positions relative to the 1440×900 stage.
 * Vertical alignment uses `bottom` so items sit on the glass surface.
 *
 * Shelf surfaces (Figma Frame 134 / 1286:3264):
 *   Top glass y=516 → 57.3%
 *   Bottom glass y=753 → 83.7%  (kept clear of the section edge so KH can't cover it)
 */
export const shelves = [
  {
    id: 'shelf-top',
    level: 'top',
    image: glassShelfTop,
    position: {
      desktop: { left: '16.6%', top: '62.3%', width: '67.43%' },
      mobile: { left: '4%', top: '60%', width: '92%' },
    },
  },
  {
    id: 'shelf-bottom',
    level: 'bottom',
    image: glassShelfBottom,
    position: {
      desktop: { left: '16.6%', top: '90.2%', width: '67.43%' },
      mobile: { left: '4%', top: '91%', width: '92%' },
    },
  },
]

export const shelfGlows = [
  {
    id: 'glow-top',
    position: {
      desktop: { left: '18.82%', top: '48%', width: '63.68%', height: '12%' },
      mobile: { left: '8%', top: '46%', width: '84%', height: '10%' },
    },
  },
  {
    id: 'glow-bottom',
    position: {
      desktop: { left: '18.82%', top: '78%', width: '63.68%', height: '12%' },
      mobile: { left: '8%', top: '78%', width: '84%', height: '10%' },
    },
  },
]

/** Shared seat heights — item bottoms align to glass top surface. */
export const SHELF_SEAT = {
  top: { desktop: '37.5%', mobile: '39%' },
  bottom: { desktop: '9.5%', mobile: '8.5%' },
}

export const decorItems = [
  {
    id: 'towels',
    name: 'Folded towels',
    image: towels,
    shelf: 'top',
    parallaxDepth: 0.4,
    position: {
      desktop: { left: '32.01%', bottom: SHELF_SEAT.top.desktop, width: '24.58%' },
      mobile: { left: '24%', bottom: SHELF_SEAT.top.mobile, width: '28%' },
    },
  },
  {
    id: 'loofah',
    name: 'Blue loofah',
    image: loofah,
    shelf: 'bottom',
    parallaxDepth: 0.55,
    position: {
      desktop: { left: '27.36%', bottom: SHELF_SEAT.bottom.desktop, width: '9.72%' },
      mobile: { left: '6%', bottom: SHELF_SEAT.bottom.mobile, width: '16%' },
    },
  },
  {
    id: 'soap',
    name: 'Soap dish',
    image: soap,
    shelf: 'bottom',
    parallaxDepth: 0.5,
    position: {
      desktop: { left: '62.36%', bottom: SHELF_SEAT.bottom.desktop, width: '11.11%' },
      mobile: { left: '72%', bottom: SHELF_SEAT.bottom.mobile, width: '18%' },
    },
  },
]
