import iconDeeplyHydrating from '~/assets/pdp/chips/deeply-hydrating.png';
import iconHyaluronicAcid from '~/assets/pdp/chips/hyaluronic-acid.png';
import iconLongLastingFragrance from '~/assets/pdp/chips/long-lasting-fragrance.png';
import iconMysteriousBergamot from '~/assets/pdp/chips/mysterious-bergamot.png';

/**
 * Shared Flux PDP feature copy for hero chips and the Product Details 2x2 grid.
 * Icons are Figma photo-glyphs (22×24) from node 3097:1105 — not Phosphor pills.
 */
export const FLUX_PDP_FEATURE_ICON_SRC = {
  drop: iconDeeplyHydrating,
  flask: iconHyaluronicAcid,
  sparkle: iconLongLastingFragrance,
  wind: iconMysteriousBergamot,
};

/**
 * Shared Flux PDP feature copy for hero chips and the Product Details 2x2 grid.
 * Shopify tags/ticker/benefits are a different shape, so this stays static for now.
 */
export const FLUX_PDP_FEATURES = {
  'the-dreamer': [
    {
      icon: 'drop',
      label: 'Deeply Hydrating',
      description: 'A moisture-rich cleanse that leaves skin soft, not stripped.',
    },
    {
      icon: 'flask',
      label: 'Hyaluronic Acid',
      description: 'Helps skin hold water for a plump, comfortable finish.',
    },
    {
      icon: 'sparkle',
      label: 'Long-Lasting Fragrance',
      description: 'A scent that lingers through the day without crowding the room.',
    },
    {
      icon: 'wind',
      label: 'Mysterious Bergamot',
      description: 'Citrus-wood warmth with a quiet, lingering trail.',
    },
  ],
  'the-lover': [
    {
      icon: 'drop',
      label: 'Brightening Care',
      description: 'Helps even the look of skin with every wash.',
    },
    {
      icon: 'flask',
      label: 'Vitamin C',
      description: 'An antioxidant boost for a clearer, brighter feel.',
    },
    {
      icon: 'sparkle',
      label: 'Soft Glow Finish',
      description: 'Leaves skin looking fresh, not chalky or tight.',
    },
    {
      icon: 'wind',
      label: 'Warm Floral',
      description: 'A romantic trail that stays close to the skin.',
    },
  ],
  'the-rebel': [
    {
      icon: 'drop',
      label: 'Deep Exfoliation',
      description: 'Helps clear congestion without a harsh after-feel.',
    },
    {
      icon: 'flask',
      label: '2% Salicylic Acid',
      description: 'Targets buildup so skin feels clearer over time.',
    },
    {
      icon: 'sparkle',
      label: 'Clears Congestion',
      description: 'Made for days when skin needs a reset, not a strip.',
    },
    {
      icon: 'wind',
      label: 'Crisp Mint',
      description: 'A cool finish that wakes up the shower, then settles.',
    },
  ],
  'the-sage': [
    {
      icon: 'drop',
      label: 'Deep Cleanse',
      description: 'Washes away the day while keeping skin in balance.',
    },
    {
      icon: 'flask',
      label: 'Balanced Oils',
      description: 'Cleans thoroughly without leaving a tight, dry feel.',
    },
    {
      icon: 'sparkle',
      label: 'Calm Finish',
      description: 'Settles skin after heat, sweat, and city air.',
    },
    {
      icon: 'wind',
      label: 'Herbal Green',
      description: 'A quiet green scent that stays grounded, not loud.',
    },
  ],
  'the-sport': [
    {
      icon: 'drop',
      label: 'De-Tan Care',
      description: 'Helps fade the look of sun and sweat on active days.',
    },
    {
      icon: 'flask',
      label: '5% Niacinamide',
      description: 'Supports a more even, resilient-looking finish.',
    },
    {
      icon: 'sparkle',
      label: 'Sweat Ready',
      description: 'Rinses clean and stays comfortable after a workout.',
    },
    {
      icon: 'wind',
      label: 'Cool Citrus',
      description: 'A sharp, clean scent that doesn’t cling too heavy.',
    },
  ],
};

export function fluxPdpFeaturesFor(handle) {
  return FLUX_PDP_FEATURES[handle] ?? FLUX_PDP_FEATURES['the-dreamer'];
}

/**
 * Product Details 2×2 grid (Figma) — icon + title + body in a row.
 * Separate from hero chips so chip labels can stay as designed.
 */
export const FLUX_PDP_DETAIL_FEATURES = {
  'the-dreamer': [
    {
      icon: 'drop',
      label: 'Deeply Hydrating',
      description: 'For skin that feels soft and refreshed.',
    },
    {
      icon: 'flask',
      label: 'Hyaluronic Acid',
      description:
        'A hydration-focused formula with hyaluronic acid variants.',
    },
    {
      icon: 'wind',
      label: 'Mysterious Bergamot',
      description:
        'A distinctive bergamot fragrance with a fresh, intriguing character.',
    },
    {
      icon: 'sparkle',
      label: 'Sensory Lather',
      description:
        'A rich, refreshing cleanse that makes every shower feel more indulgent.',
    },
  ],
};

export function fluxPdpDetailFeaturesFor(handle) {
  return (
    FLUX_PDP_DETAIL_FEATURES[handle] ??
    FLUX_PDP_FEATURES[handle] ??
    FLUX_PDP_DETAIL_FEATURES['the-dreamer']
  );
}
