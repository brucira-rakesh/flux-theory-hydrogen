import sport from '../assets/products/sport.png'
import sage from '../assets/products/sage.png'
import rebel from '../assets/products/rebel.png'
import lover from '../assets/products/lover.png'
import dreamer from '../assets/products/dreamer.png'
import { SHELF_SEAT } from './decor'

/**
 * Design stage: 1440 × 900 (Figma Frame 134).
 * Bottles use `bottom` so their base sits on the glass shelf surface.
 *
 * Shelf layout (Figma 1286:3264):
 * Top:    Sport · towels · Sage · Rebel
 * Bottom: loofah · Lover · Dreamer · soap
 */
export const DESIGN_WIDTH = 1440
export const DESIGN_HEIGHT = 900

export const products = [
  {
    id: 'the-sport',
    name: 'THE SPORT',
    focusTitle: 'THE PLAYER',
    subtitle: 'Built to move',
    price: 299,
    currency: '₹',
    description:
      'Designed for men who thrive on movement, push beyond limits, and embrace every challenge with relentless energy, focus, and an unstoppable competitive spirit.',
    benefits: [
      { label: 'BOLD', color: '#28beff' },
      { label: 'Fearless.', color: '#ffbeb4' },
    ],
    quote:
      "Champions are never defined by talent alone they're shaped by discipline, consistency, and the decision to show up every single day.",
    image: sport,
    shelf: 'top',
    position: {
      desktop: { left: '24.17%', bottom: SHELF_SEAT.top.desktop, width: '6.25%' },
      mobile: { left: '6%', bottom: SHELF_SEAT.top.mobile, width: '14%' },
    },
    hotspot: {
      desktop: { left: '22%', top: '15%' },
      mobile: { left: '20%', top: '14%' },
    },
    visualOffset: { x: 0, y: 0, scale: 1 },
  },
  {
    id: 'the-sage',
    name: 'THE SAGE',
    focusTitle: 'THE SAGE',
    subtitle: 'Calm clarity',
    price: 299,
    currency: '₹',
    description:
      'A grounded, clear-minded wash for moments that ask for presence — balanced, steady, and quietly confident.',
    benefits: [
      { label: 'CALM', color: '#3cb889' },
      { label: 'Clear.', color: '#7ec8f0' },
    ],
    quote:
      'Wisdom is not loud. It is the quiet strength of knowing when to move, and when to hold still.',
    image: sage,
    shelf: 'top',
    position: {
      desktop: { left: '58.19%', bottom: SHELF_SEAT.top.desktop, width: '6.18%' },
      mobile: { left: '48%', bottom: SHELF_SEAT.top.mobile, width: '14%' },
    },
    hotspot: {
      desktop: { left: '0%', top: '40%' },
      mobile: { left: '0%', top: '38%' },
    },
    visualOffset: { x: 0, y: 0, scale: 1 },
  },
  {
    id: 'the-rebel',
    name: 'THE REBEL',
    focusTitle: 'THE REBEL',
    subtitle: 'Heat with intention',
    price: 299,
    currency: '₹',
    description:
      'Spiced intensity with a rebellious kick. Unapologetic warmth for the nights you choose your own rules.',
    benefits: [
      { label: 'BOLD', color: '#e07840' },
      { label: 'Wild.', color: '#f0c040' },
    ],
    quote:
      'Rebellion is not noise — it is clarity. Knowing who you are and refusing to dilute it.',
    image: rebel,
    shelf: 'top',
    position: {
      desktop: { left: '66.53%', bottom: SHELF_SEAT.top.desktop, width: '5.69%' },
      mobile: { left: '78%', bottom: SHELF_SEAT.top.mobile, width: '14%' },
    },
    hotspot: {
      desktop: { left: '100%', top: '15%' },
      mobile: { left: '100%', top: '14%' },
    },
    visualOffset: { x: 0, y: 0, scale: 1 },
  },
  {
    id: 'the-lover',
    name: 'THE LOVER',
    focusTitle: 'THE LOVER',
    subtitle: 'Soft power',
    price: 329,
    currency: '₹',
    description:
      'Warm, intimate, and magnetic. For evenings that linger — and versions of you that refuse to blend in.',
    benefits: [
      { label: 'WARM', color: '#c46b8a' },
      { label: 'Poise.', color: '#e08aab' },
    ],
    quote:
      'Desire is not waiting somewhere else. It is the quiet decision to show up as yourself, fully.',
    image: lover,
    shelf: 'bottom',
    position: {
      desktop: { left: '40.83%', bottom: SHELF_SEAT.bottom.desktop, width: '6.11%' },
      mobile: { left: '28%', bottom: SHELF_SEAT.bottom.mobile, width: '14%' },
    },
    hotspot: {
      desktop: { left: '22%', top: '15%' },
      mobile: { left: '20%', top: '14%' },
    },
    visualOffset: { x: 0, y: 0, scale: 1 },
  },
  {
    id: 'the-dreamer',
    name: 'THE DREAMER',
    focusTitle: 'THE DREAMER',
    subtitle: 'Vision in form',
    price: 349,
    currency: '₹',
    description:
      'Cool depth with a visionary finish. For the mind that builds before it speaks — imaginative, exacting, free.',
    benefits: [
      { label: 'DEEP', color: '#2a6db5' },
      { label: 'Focus.', color: '#5a8fd4' },
    ],
    quote:
      'Great work is never accidental. It is designed — one deliberate choice stacked on another.',
    image: dreamer,
    shelf: 'bottom',
    position: {
      desktop: { left: '52.15%', bottom: SHELF_SEAT.bottom.desktop, width: '6.04%' },
      mobile: { left: '56%', bottom: SHELF_SEAT.bottom.mobile, width: '14%' },
    },
    hotspot: {
      desktop: { left: '100%', top: '68%' },
      mobile: { left: '100%', top: '66%' },
    },
    visualOffset: { x: 0, y: 0, scale: 1 },
  },
]

export function getProductIndex(id) {
  return products.findIndex((p) => p.id === id)
}

export function getProductById(id) {
  return products.find((p) => p.id === id) ?? null
}
