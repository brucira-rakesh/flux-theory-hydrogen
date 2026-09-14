import {BRAND_ARCHETYPES} from '~/data/brand';

/**
 * Reviewer avatar palette — first stop of each archetype gradient in
 * `BRAND_ARCHETYPES` (app/data/brand.js). Those are the only reusable
 * persona color values in the repo (no `--persona-*` CSS tokens exist;
 * bottle hues otherwise live in textures / studio light tints).
 *
 * Order: Dreamer, Sport/Player, Sage, Rebel, Lover.
 */
const AVATAR_PALETTE = [
  'dreamer',
  'player', // Sport on product; Brand page labels this archetype "Player"
  'sage',
  'rebel',
  'lover',
].map((id) => {
  const archetype = BRAND_ARCHETYPES.find((entry) => entry.id === id);
  const match = archetype?.gradient?.match(/#([0-9A-Fa-f]{6})/);
  return match ? `#${match[1]}` : '#000000';
});

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function hashNameToIndex(name, paletteLength) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % paletteLength;
}

export function getAvatarProps(reviewerName) {
  const name = reviewerName ?? '';
  return {
    initials: getInitials(name),
    background:
      AVATAR_PALETTE[hashNameToIndex(name, AVATAR_PALETTE.length)] ??
      AVATAR_PALETTE[0],
  };
}
