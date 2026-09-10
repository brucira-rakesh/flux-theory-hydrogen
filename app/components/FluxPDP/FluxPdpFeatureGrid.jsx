import {
  FLUX_PDP_FEATURE_ICON_SRC,
  fluxPdpDetailFeaturesFor,
} from './fluxPdpFeatures';

export default function FluxPdpFeatureGrid({handle}) {
  const features = fluxPdpDetailFeaturesFor(handle);

  return (
    <ul className="flux-pdp-feature-grid">
      {features.map((feature) => {
        const src =
          FLUX_PDP_FEATURE_ICON_SRC[feature.icon] ??
          FLUX_PDP_FEATURE_ICON_SRC.drop;
        return (
          <li key={feature.label} className="flux-pdp-feature-card">
            <img
              className="flux-pdp-feature-card__icon"
              src={src}
              alt=""
              width={22}
              height={24}
            />
            <div className="flux-pdp-feature-card__copy">
              <p className="flux-pdp-feature-card__title">{feature.label}</p>
              <p className="flux-pdp-feature-card__body">{feature.description}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
