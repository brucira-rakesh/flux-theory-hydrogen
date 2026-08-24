import {BRAND_ARCHETYPES} from '~/data/brand';
import './ArchetypeGradientStrip.css';

/**
 * Decorative five-column archetype gradient strip.
 * Mobile (≤960): horizontal scroll-snap with peek — same rail mechanics as
 * Similar Products, minus product data. Chosen over a 2–3 wrap grid so each
 * gradient block keeps readable height/label space at 375px.
 */
export default function ArchetypeGradientStrip({archetypes = BRAND_ARCHETYPES}) {
  return (
    <ul
      className="archetype-strip"
      aria-label="Flux Theory archetypes"
      data-lenis-prevent
      data-lenis-prevent-wheel
    >
      {archetypes.map((item) => (
        <li
          key={item.id}
          className="archetype-strip__item"
          style={{backgroundImage: item.gradient}}
        >
          <span className="archetype-strip__name">{item.name}</span>
        </li>
      ))}
    </ul>
  );
}
