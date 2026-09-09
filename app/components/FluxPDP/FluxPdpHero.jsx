import {useMemo, useState} from 'react';
import {
  Drop,
  Flask,
  MagnifyingGlass,
  ShieldCheck,
  UserFocus,
} from '@phosphor-icons/react';
import {Image, Money, getProductOptions} from '@shopify/hydrogen';
import {Link, useNavigate} from 'react-router';
import PdpControls from '~/components/PDP/PdpControls';
import {
  isShopifyDefaultTitleOption,
  shouldShowSizeSelect,
} from '~/lib/storefrontCatalog';

/**
 * Mood tags are shop filters (e.g. filter:mood:fresh). product_ticker is the
 * marquee (currently "Paraben Free" / "Cruelty Free"). all_benefits is accordion
 * copy. None of those match the hero chip labels, so chips stay static for now.
 */
const PLACEHOLDER_CHIPS = {
  'the-dreamer': [
    {icon: 'drop', label: 'Deeply Hydrating'},
    {icon: 'flask', label: 'Hyaluronic Acid'},
    {icon: 'sparkle', label: 'Long-Lasting Fragrance'},
    {icon: 'wind', label: 'Mysterious Bergamot'},
  ],
  'the-lover': [
    {icon: 'drop', label: 'Brightening Care'},
    {icon: 'flask', label: 'Vitamin C'},
    {icon: 'sparkle', label: 'Soft Glow Finish'},
    {icon: 'wind', label: 'Warm Floral'},
  ],
  'the-rebel': [
    {icon: 'drop', label: 'Deep Exfoliation'},
    {icon: 'flask', label: '2% Salicylic Acid'},
    {icon: 'sparkle', label: 'Clears Congestion'},
    {icon: 'wind', label: 'Crisp Mint'},
  ],
  'the-sage': [
    {icon: 'drop', label: 'Deep Cleanse'},
    {icon: 'flask', label: 'Balanced Oils'},
    {icon: 'sparkle', label: 'Calm Finish'},
    {icon: 'wind', label: 'Herbal Green'},
  ],
  'the-sport': [
    {icon: 'drop', label: 'De-Tan Care'},
    {icon: 'flask', label: '5% Niacinamide'},
    {icon: 'sparkle', label: 'Sweat Ready'},
    {icon: 'wind', label: 'Cool Citrus'},
  ],
};

const CHIP_ICONS = {
  drop: Drop,
  flask: Flask,
  sparkle: ShieldCheck,
  wind: UserFocus,
};

const PLACEHOLDER_OFFERS = [
  {
    id: 'buy-2',
    variant: 'solid',
    title: 'Buy 2 Get 10% Off',
    code: 'FLUX2',
  },
  {
    id: 'buy-3',
    variant: 'dashed',
    title: 'Buy 3 Get 15% Off',
    code: 'FLUX3',
  },
];

export function mediaItemsFromProduct(product, max = 5) {
  const items = [];
  for (const node of product?.media?.nodes ?? []) {
    if (items.length >= max) break;
    if (node?.__typename === 'Video') {
      const src = node.previewImage?.url;
      if (!src) continue;
      items.push({
        id: `video-${items.length}`,
        src,
        alt: product.title,
        image: node.previewImage,
      });
      continue;
    }
    const image = node?.image;
    if (!image?.url) continue;
    items.push({
      id: image.id || `image-${items.length}`,
      src: image.url,
      alt: image.altText || product.title,
      image,
    });
  }
  if (items.length) return items;
  for (const image of product?.images?.nodes ?? []) {
    if (items.length >= max) break;
    if (!image?.url) continue;
    items.push({
      id: image.id || `image-${items.length}`,
      src: image.url,
      alt: image.altText || product.title,
      image,
    });
  }
  return items;
}

/** Same bar as shouldShowSizeSelect: 2+ real values, ignore Default Title. */
function isSwatchableOption(option) {
  const values = (option?.optionValues ?? [])
    .map((value) => value.name)
    .filter(Boolean)
    .filter(
      (name) =>
        !isShopifyDefaultTitleOption({name: option.name, value: name}),
    );
  return shouldShowSizeSelect(values);
}

function optionRowLabel(option, index) {
  const name = option.name?.toLowerCase() ?? '';
  if (name === 'size' || index === 0) return 'SELECT VARIANT';
  if (name === 'pack' || index === 1) return 'SELECT PACK';
  return `SELECT ${option.name}`.toUpperCase();
}

export default function FluxPdpHero({
  product,
  view,
  selectedVariant,
  price,
  compareAtPrice,
  percentOff,
}) {
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const thumbs = useMemo(() => mediaItemsFromProduct(product), [product]);
  const selectedThumb =
    thumbs[Math.min(selectedMediaIndex, Math.max(thumbs.length - 1, 0))] ??
    null;

  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });
  const swatchOptions = productOptions.filter(isSwatchableOption);

  const imageAlt =
    selectedThumb?.alt ||
    selectedVariant?.image?.altText ||
    view.name ||
    product.title;
  const shopifyImage = selectedThumb?.image
    ? {
        ...selectedThumb.image,
        url: selectedThumb.src,
        altText: imageAlt,
      }
    : selectedVariant?.image?.url
      ? selectedVariant.image
      : product.featuredImage?.url
        ? product.featuredImage
        : null;

  const chips =
    PLACEHOLDER_CHIPS[product.handle] ?? PLACEHOLDER_CHIPS['the-dreamer'];

  const onOptionSelect = (value) => {
    if (value.selected || !value.variantUriQuery) return;
    if (value.isDifferentProduct) {
      void navigate(`/flux-pdp/${value.handle}?${value.variantUriQuery}`, {
        preventScrollReset: true,
      });
      return;
    }
    void navigate(`?${value.variantUriQuery}`, {
      replace: true,
      preventScrollReset: true,
    });
  };

  return (
    <section
      className="flux-pdp-hero"
      aria-label={`${view.name} product hero`}
    >
      {thumbs.length ? (
        <div className="flux-pdp-thumbs" role="list" aria-label="Product images">
          {thumbs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`flux-pdp-thumbs__btn${
                index === selectedMediaIndex ? ' is-active' : ''
              }`}
              aria-label={`Show image ${index + 1}`}
              aria-pressed={index === selectedMediaIndex}
              onClick={() => setSelectedMediaIndex(index)}
            >
              <img src={item.src} alt="" />
            </button>
          ))}
        </div>
      ) : null}

      <figure className="flux-pdp-hero__media">
        {shopifyImage ? (
          <Image
            alt={imageAlt}
            aspectRatio="591/741"
            data={shopifyImage}
            sizes="(min-width: 900px) 591px, 100vw"
          />
        ) : selectedThumb?.src ? (
          <img src={selectedThumb.src} alt={imageAlt} />
        ) : null}
      </figure>

      <div className="flux-pdp-hero__info">
        <h1 className="flux-pdp-hero__title">{view.name}</h1>

        <div className="flux-pdp-price" aria-label="Price" role="group">
          {price ? (
            <span className="flux-pdp-price__current">
              <Money data={price} />
            </span>
          ) : null}
          {compareAtPrice ? (
            <s className="flux-pdp-price__compare">
              <Money data={compareAtPrice} />
            </s>
          ) : null}
          {percentOff != null ? (
            <span className="flux-pdp-price__badge">{percentOff}% OFF</span>
          ) : null}
        </div>

        <ul className="flux-pdp-chips">
          {chips.map((chip) => {
            const Icon = CHIP_ICONS[chip.icon] ?? Drop;
            return (
              <li key={chip.label} className="flux-pdp-chip">
                <Icon size={14} weight="regular" aria-hidden />
                <span>{chip.label}</span>
              </li>
            );
          })}
        </ul>

        {swatchOptions.map((option, index) => (
          <div key={option.name} className="flux-pdp-option">
            <p className="flux-pdp-option__label">{optionRowLabel(option, index)}</p>
            <div className="flux-pdp-swatches" role="list">
              {option.optionValues.map((value) => {
                if (
                  isShopifyDefaultTitleOption({
                    name: option.name,
                    value: value.name,
                  })
                ) {
                  return null;
                }
                const selected = Boolean(value.selected);
                const className = `flux-pdp-swatch${
                  selected ? ' is-selected' : ''
                }${!value.available ? ' is-unavailable' : ''}`;
                if (value.isDifferentProduct) {
                  return (
                    <Link
                      key={option.name + value.name}
                      className={className}
                      prefetch="intent"
                      preventScrollReset
                      replace
                      to={`/flux-pdp/${value.handle}?${value.variantUriQuery}`}
                    >
                      {value.name}
                    </Link>
                  );
                }
                return (
                  <button
                    key={option.name + value.name}
                    type="button"
                    className={className}
                    disabled={!value.exists}
                    aria-pressed={selected}
                    onClick={() => onOptionSelect(value)}
                  >
                    {value.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <form
          className="flux-pdp-pincode"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="visually-hidden" htmlFor="flux-pdp-pincode">
            Pin code
          </label>
          <input
            id="flux-pdp-pincode"
            type="text"
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="Enter Your Pin Code To Check Delivery."
          />
          <button type="button" aria-label="Check delivery">
            <MagnifyingGlass size={18} weight="regular" aria-hidden />
          </button>
        </form>

        <div className="flux-pdp-offers" aria-label="Offers">
          {PLACEHOLDER_OFFERS.map((offer) => (
            <article
              key={offer.id}
              className={`flux-pdp-offer flux-pdp-offer--${offer.variant}`}
            >
              <p className="flux-pdp-offer__title">{offer.title}</p>
              <p className="flux-pdp-offer__code">Use code {offer.code}</p>
            </article>
          ))}
        </div>

        <div className="flux-pdp-hero__cart">
          <PdpControls
            sizes={[]}
            size={view.defaultSize}
            quantity={quantity}
            onQuantityChange={setQuantity}
            price={view.price}
            currency={view.currency}
            merchandiseId={view.variantGid}
            selectedVariant={view.selectedVariant}
            availableForSale={view.availableForSale}
            showPrice={false}
          />
        </div>
      </div>
    </section>
  );
}
