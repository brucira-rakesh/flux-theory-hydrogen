export default function FluxPdpFeatureGrid({features = []}) {
  if (!features.length) return null;

  return (
    <ul className="flux-pdp-feature-grid">
      {features.map((feature) => (
        <li key={feature.id ?? feature.label} className="flux-pdp-feature-card">
          <img
            className="flux-pdp-feature-card__icon"
            src={feature.iconUrl}
            alt=""
            width={22}
            height={24}
          />
          <div className="flux-pdp-feature-card__copy">
            <p className="flux-pdp-feature-card__title">{feature.label}</p>
            <p className="flux-pdp-feature-card__body">{feature.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
