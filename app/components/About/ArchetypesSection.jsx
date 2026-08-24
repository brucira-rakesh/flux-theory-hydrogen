import ArchetypeGradientStrip from '~/components/Brand/ArchetypeGradientStrip';
import {BRAND_DUALITY} from '~/data/brand';

/**
 * Archetypes block — copy + five-column gradient strip.
 * Shared between branded pages; currently rendered on About Us below the bento.
 */
export default function ArchetypesSection({
  title = BRAND_DUALITY.archetype.title,
  body = BRAND_DUALITY.archetype.body,
}) {
  return (
    <section className="about-section about-archetypes" aria-label="Archetypes">
      <div className="about-inner about-archetypes__grid">
        <div className="about-archetypes__copy">
          <h2 className="about-display about-h-section">{title}</h2>
          <p className="about-body">{body}</p>
        </div>
        <div className="about-archetypes__media">
          <ArchetypeGradientStrip />
        </div>
      </div>
    </section>
  );
}
