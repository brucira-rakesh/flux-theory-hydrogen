import {useEffect, useMemo, useRef, useState} from 'react';
import {MagnifyingGlass} from '@phosphor-icons/react';
import {Image, Money, getProductOptions} from '@shopify/hydrogen';
import {Link, useNavigate} from 'react-router';
import PdpControls from '~/components/PDP/PdpControls';
import {
  FLUX_PDP_FEATURE_ICON_SRC,
  fluxPdpFeaturesFor,
} from '~/components/FluxPDP/fluxPdpFeatures';
import {
  isShopifyDefaultTitleOption,
  shouldShowSizeSelect,
} from '~/lib/storefrontCatalog';
import iconOfferCopy from '~/assets/pdp/offers/icon-copy.svg';
import arrowLeft from '~/assets/pdp/reviews/arrow-left.svg';
import arrowRight from '~/assets/pdp/reviews/arrow-right.svg';

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

function isPackOption(option) {
  const name = option?.name?.toLowerCase() ?? '';
  if (name.includes('pack')) return true;
  return (option?.optionValues ?? []).some((value) =>
    /pack of\s*\d+/i.test(value?.name ?? ''),
  );
}

function optionRowLabel(option) {
  if (isPackOption(option)) return 'SELECT PACK';
  return `SELECT ${option.name}`.toUpperCase();
}

/** One-liner under SELECT PACK — mirrors offer card detail typography. */
function packShippingMessage(selectedValueName) {
  const name = selectedValueName?.trim().toLowerCase() ?? '';
  if (name.includes('pack of 2')) return 'Free Shipping';
  if (name.includes('pack of 1')) return '+₹49 Shipping Fee';
  return null;
}

const SHOPIFY_CDN_ORIGIN = 'https://cdn.shopify.com';

/**
 * Hydrogen Image defaults crop="center" and, when `data` has width+height,
 * also sends a matching height — Shopify then returns a cropped file.
 * Width-only URLs keep the native aspect so CSS object-fit: contain can scale
 * the full bottle.
 */
function shopifyUncroppedLoader({src, width}) {
  if (!src) return '';
  const url = new URL(src, SHOPIFY_CDN_ORIGIN);
  url.searchParams.delete('crop');
  url.searchParams.delete('height');
  if (width) url.searchParams.set('width', String(Math.round(width)));
  return url.href;
}

function OfferCopyToast({visible}) {
  return (
    <span
      className={`flux-pdp-offer__toast${visible ? ' is-visible' : ''}`}
      aria-live="polite"
      aria-atomic="true"
    >
      Code copied!
    </span>
  );
}

export default function FluxPdpHero({
  product,
  view,
  selectedVariant,
  price,
  compareAtPrice,
  percentOff,
  quantity,
  onQuantityChange,
  formRef,
  heroControlsRef,
  relatedProducts = null,
  activeOffers = [],
  details = null,
}) {
  const navigate = useNavigate();
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [copiedCode, setCopiedCode] = useState('');
  /** Desktop gallery cursor arrow — follows pointer in the 30%/70% hit zones. */
  const [galleryCursor, setGalleryCursor] = useState(null);
  const sliderRef = useRef(null);
  const heroRef = useRef(null);
  const infoRef = useRef(null);
  const toastTimer = useRef(null);
  /** Skip onScroll→index sync while a thumb-driven scrollTo is in flight. */
  const ignoreScrollSyncRef = useRef(false);
  const scrollSyncTimerRef = useRef(null);
  const thumbs = useMemo(() => mediaItemsFromProduct(product), [product]);

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearTimeout(scrollSyncTimerRef.current);
  }, []);

  useEffect(() => {
    setSelectedMediaIndex(0);
  }, [product.id]);

  /**
   * Gallery slider is `overflow-x: auto` with `data-lenis-prevent`, so a
   * vertical wheel/trackpad gesture over it never reaches the page. Forward
   * mostly-vertical wheels to window scroll; keep mostly-horizontal for snap.
   *
   * The sticky buy box no longer has its own overflow — it stays pinned at
   * top: 64px while the left column scrolls (no scrollTop sync).
   */
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider || typeof window === 'undefined') return undefined;

    const mq = window.matchMedia('(max-width: 900px)');

    const onWheelSlider = (event) => {
      if (mq.matches) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      window.scrollBy({top: event.deltaY, left: 0, behavior: 'auto'});
    };

    slider.addEventListener('wheel', onWheelSlider, {passive: false});

    return () => {
      slider.removeEventListener('wheel', onWheelSlider);
    };
  }, [product.id]);

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return undefined;
    const slide = slider.children[selectedMediaIndex];
    if (!(slide instanceof HTMLElement)) return undefined;

    const width = slider.clientWidth || 0;
    const targetLeft = width
      ? selectedMediaIndex * width
      : slide.offsetLeft;

    // Already settled — don't re-animate (avoids fighting scroll-snap).
    if (Math.abs(slider.scrollLeft - targetLeft) < 2) {
      ignoreScrollSyncRef.current = false;
      return undefined;
    }

    ignoreScrollSyncRef.current = true;
    clearTimeout(scrollSyncTimerRef.current);

    const releaseIgnore = () => {
      ignoreScrollSyncRef.current = false;
    };

    slider.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });

    // Prefer scrollend; fall back to a timeout for browsers without it.
    const onScrollEnd = () => {
      clearTimeout(scrollSyncTimerRef.current);
      releaseIgnore();
    };
    slider.addEventListener('scrollend', onScrollEnd);
    scrollSyncTimerRef.current = setTimeout(releaseIgnore, 450);

    return () => {
      slider.removeEventListener('scrollend', onScrollEnd);
      clearTimeout(scrollSyncTimerRef.current);
    };
  }, [selectedMediaIndex]);

  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });
  // Only real pack variants stay here — SELECT VARIANT is related products.
  const packOptions = productOptions
    .filter(isSwatchableOption)
    .filter(isPackOption);

  const chips = fluxPdpFeaturesFor(product.handle);

  const onOptionSelect = (value) => {
    if (value.selected || !value.variantUriQuery) return;
    if (value.isDifferentProduct) {
      void navigate(`/products/${value.handle}?${value.variantUriQuery}`, {
        preventScrollReset: true,
      });
      return;
    }
    void navigate(`?${value.variantUriQuery}`, {
      replace: true,
      preventScrollReset: true,
    });
  };

  const onGalleryHotspotMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const side = x / rect.width < 0.3 ? 'prev' : 'next';
    setGalleryCursor({side, x, y});
  };

  const onGalleryHotspotLeave = () => {
    setGalleryCursor(null);
  };

  const onGalleryHotspotClick = (event) => {
    if (thumbs.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const side =
      (event.clientX - rect.left) / rect.width < 0.3 ? 'prev' : 'next';
    if (side === 'prev') {
      setSelectedMediaIndex(
        (index) => (index - 1 + thumbs.length) % thumbs.length,
      );
      return;
    }
    setSelectedMediaIndex((index) => (index + 1) % thumbs.length);
  };

  const onSliderScroll = () => {
    if (ignoreScrollSyncRef.current) return;
    const slider = sliderRef.current;
    if (!slider || !thumbs.length) return;
    const width = slider.clientWidth || 1;
    const next = Math.round(slider.scrollLeft / width);
    const clamped = Math.max(0, Math.min(thumbs.length - 1, next));
    if (clamped !== selectedMediaIndex) setSelectedMediaIndex(clamped);
  };

  const copyOfferCode = (code) => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopiedCode(code);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setCopiedCode(''), 2200);
      })
      .catch(() => {
        // Clipboard write failed — fail silently (same as Instagram share).
      });
  };

  return (
    <section
      ref={heroRef}
      className="flux-pdp-hero"
      aria-label={`${view.name} product hero`}
    >
      <div className="flux-pdp-hero__main">
      <div className="flux-pdp-gallery">
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

        <div className="flux-pdp-gallery__stage">
          <div
            ref={sliderRef}
            className="flux-pdp-hero__slider"
            onScroll={onSliderScroll}
            aria-label="Product image gallery"
            data-lenis-prevent
            data-lenis-prevent-wheel
          >
            {thumbs.length ? (
              thumbs.map((item, index) => {
                const shopifyImage = item.image
                  ? {
                      ...item.image,
                      url: item.src,
                      altText: item.alt,
                    }
                  : null;
                return (
                  <figure
                    key={item.id}
                    className="flux-pdp-hero__media"
                    aria-hidden={index !== selectedMediaIndex}
                  >
                    {shopifyImage ? (
                      <Image
                        alt={item.alt}
                        data={shopifyImage}
                        loader={shopifyUncroppedLoader}
                        sizes="(min-width: 900px) 591px, 100vw"
                        loading={index === 0 ? 'eager' : 'lazy'}
                      />
                    ) : (
                      <img src={item.src} alt={item.alt} />
                    )}
                  </figure>
                );
              })
            ) : (
              <figure className="flux-pdp-hero__media">
                {selectedVariant?.image?.url || product.featuredImage?.url ? (
                  <Image
                    alt={view.name || product.title}
                    data={selectedVariant?.image ?? product.featuredImage}
                    loader={shopifyUncroppedLoader}
                    sizes="(min-width: 900px) 591px, 100vw"
                  />
                ) : null}
              </figure>
            )}
          </div>

          {/* Desktop: 30% prev / 70% next. Arrow follows the cursor.
              Hidden on coarse pointers so mobile swipe still owns the slider. */}
          {thumbs.length > 1 ? (
            <button
              type="button"
              className={`flux-pdp-gallery__hotspots${
                galleryCursor ? ' is-active' : ''
              }${galleryCursor ? ` is-${galleryCursor.side}` : ''}`}
              aria-label={
                galleryCursor?.side === 'prev'
                  ? 'Previous image'
                  : 'Next image'
              }
              onMouseMove={onGalleryHotspotMove}
              onMouseLeave={onGalleryHotspotLeave}
              onClick={onGalleryHotspotClick}
            >
              {galleryCursor ? (
                <span
                  className={`flux-pdp-gallery__cursor-arrow is-${galleryCursor.side}`}
                  style={{
                    left: galleryCursor.x,
                    top: galleryCursor.y,
                  }}
                  aria-hidden="true"
                >
                  <img
                    src={
                      galleryCursor.side === 'prev' ? arrowLeft : arrowRight
                    }
                    alt=""
                    width={12}
                    height={8}
                  />
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      {details}
      </div>

      <div ref={infoRef} className="flux-pdp-hero__info">
        {Array.isArray(view.breadcrumb) && view.breadcrumb.length ? (
          <nav className="flux-pdp-breadcrumb" aria-label="Breadcrumb">
            {view.breadcrumb.map((crumb, index) => {
              const isLast = index === view.breadcrumb.length - 1;
              return (
                <span key={`${crumb}-${index}`} className="flux-pdp-breadcrumb__item">
                  {index > 0 ? (
                    <span className="flux-pdp-breadcrumb__sep" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  {isLast ? (
                    <span className="flux-pdp-breadcrumb__current">{crumb}</span>
                  ) : (
                    <Link
                      to={index === 0 ? '/' : '#'}
                      className="flux-pdp-breadcrumb__link"
                    >
                      {crumb}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        ) : null}

        <div className="flux-pdp-hero__heading">
          <div className="flux-pdp-hero__heading-main">
            <h1 className="flux-pdp-hero__title">
              {view.focusTitle || view.name}
            </h1>
            {view.shortDescription ? (
              <p className="flux-pdp-hero__blurb">{view.shortDescription}</p>
            ) : null}
          </div>

          <div className="flux-pdp-hero__heading-rule" aria-hidden="true" />

          <div
            className="flux-pdp-price"
            aria-label="Price"
            role="group"
            key={selectedVariant?.id ?? 'price'}
          >
            {compareAtPrice || percentOff != null ? (
              <div className="flux-pdp-price__meta">
                {compareAtPrice ? (
                  <s className="flux-pdp-price__compare">
                    <span>MRP</span>
                    <Money data={compareAtPrice} withoutTrailingZeros />
                  </s>
                ) : null}
                {percentOff != null ? (
                  <span className="flux-pdp-price__badge">
                    {percentOff}% OFF
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="flux-pdp-price__mrp-label">MRP</p>
            )}
            {price ? (
              <span className="flux-pdp-price__current">
                <Money data={price} withoutTrailingZeros />
              </span>
            ) : null}
            <p className="flux-pdp-price__taxes">Inclusive of all taxes</p>
          </div>
        </div>

        <ul className="flux-pdp-chips">
          {chips.map((chip) => {
            const src =
              FLUX_PDP_FEATURE_ICON_SRC[chip.icon] ??
              FLUX_PDP_FEATURE_ICON_SRC.drop;
            return (
              <li key={chip.label} className="flux-pdp-chip">
                <span className="flux-pdp-chip__icon">
                  <img src={src} alt="" width={22} height={24} />
                </span>
                <span>{chip.label}</span>
              </li>
            );
          })}
        </ul>

        {relatedProducts?.length ? (
          <div className="flux-pdp-option flux-pdp-related">
            <p className="flux-pdp-option__label">SELECT VARIANT</p>
            <div
              className="flux-pdp-related__swatches"
              role="list"
              aria-label="Related products"
            >
              {relatedProducts.map((item) => {
                if (item.isCurrent) {
                  return (
                    <span
                      key={item.id}
                      role="listitem"
                      className="flux-pdp-related__swatch is-current"
                      aria-current="page"
                      aria-label={`${item.title} (current)`}
                      title={item.title}
                    >
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : null}
                    </span>
                  );
                }
                return (
                  <Link
                    key={item.id}
                    role="listitem"
                    className="flux-pdp-related__swatch"
                    to={`/products/${item.handle}`}
                    prefetch="intent"
                    aria-label={item.title}
                    title={item.title}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {packOptions.map((option) => (
          <div key={option.name} className="flux-pdp-option">
            <p className="flux-pdp-option__label">{optionRowLabel(option)}</p>
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
                const shippingNote = isPackOption(option)
                  ? packShippingMessage(value.name)
                  : null;
                const className = `flux-pdp-swatch${
                  shippingNote ? ' flux-pdp-swatch--pack' : ''
                }${selected ? ' is-selected' : ''}${
                  !value.available ? ' is-unavailable' : ''
                }`;
                return (
                  <button
                    key={option.name + value.name}
                    type="button"
                    className={className}
                    disabled={!value.exists}
                    aria-pressed={selected}
                    onClick={() => onOptionSelect(value)}
                  >
                    <span className="flux-pdp-swatch__label">{value.name}</span>
                    {shippingNote ? (
                      <span className="flux-pdp-swatch__note">{shippingNote}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {activeOffers.length ? (
          <div className="flux-pdp-offers-block">
            <p className="flux-pdp-option__label">OFFERS</p>
            <div className="flux-pdp-offers" aria-label="Offers">
              {activeOffers.map((offer) => (
                <article
                  key={offer.id}
                  className={`flux-pdp-offer flux-pdp-offer--${offer.variant}`}
                >
                  <div className="flux-pdp-offer__top">
                    <div className="flux-pdp-offer__head">
                      <p className="flux-pdp-offer__headline">{offer.code}</p>
                      {offer.title || offer.headline ? (
                        <p className="flux-pdp-offer__benefit">
                          {offer.title || offer.headline}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="flux-pdp-offer__copy"
                      aria-label={`Copy code ${offer.code}`}
                      onClick={() => copyOfferCode(offer.code)}
                    >
                      <img
                        src={iconOfferCopy}
                        alt=""
                        width={16}
                        height={16}
                      />
                      <OfferCopyToast visible={copiedCode === offer.code} />
                    </button>
                  </div>
                  {offer.detail ? (
                    <div className="flux-pdp-offer__bottom">
                      <p className="flux-pdp-offer__detail">{offer.detail}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : null}

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

        <div ref={formRef} className="flux-pdp-hero__cart">
          <PdpControls
            ref={heroControlsRef}
            sizes={[]}
            size={view.defaultSize}
            quantity={quantity}
            onQuantityChange={onQuantityChange}
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

