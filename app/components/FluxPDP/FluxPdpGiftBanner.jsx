import {useEffect, useMemo, useRef, useState} from 'react';
import {Image} from '@shopify/hydrogen';
import {Check} from '@phosphor-icons/react';
import {AddToCartButton} from '~/components/AddToCartButton';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import {useCartDrawer} from '~/components/Cart/CartProvider';
import {moneyAmount, moneySymbol} from '~/lib/storefrontCatalog';
import hotspotPlus from '~/assets/pdp/gift/hotspot-plus.svg';

const SHOPIFY_CDN_ORIGIN = 'https://cdn.shopify.com';
const TITLE_DURATION = 0.8;
const TITLE_STAGGER = 0.02;
const TITLE_SWEEP_BLUR = 5;

/**
 * Hydrogen Image defaults crop="center"; strip crop/height so the banner
 * keeps its native aspect for CSS object-fit: cover.
 */
function shopifyUncroppedLoader({src, width}) {
  if (!src) return '';
  const url = new URL(src, SHOPIFY_CDN_ORIGIN);
  url.searchParams.delete('crop');
  url.searchParams.delete('height');
  if (width) url.searchParams.set('width', String(Math.round(width)));
  return url.href;
}

/**
 * Gift bundle section — banner + hotspot pins + live-price ATC card.
 * Omits entirely when `bundle` is null (no `custom.product_bundle`).
 *
 * @param {{
 *   bundle?: {
 *     titleLines: string[],
 *     description: string,
 *     desktopBanner: {url: string, altText?: string | null, width?: number | null, height?: number | null},
 *     mobileBanner: {url: string, altText?: string | null, width?: number | null, height?: number | null},
 *     hotspots: Array<{
 *       id: string,
 *       title: string,
 *       desktopXy: {x: number, y: number},
 *       mobileXy: {x: number, y: number},
 *       variantId: string,
 *       price: {amount?: string, currencyCode?: string} | null,
 *       availableForSale: boolean,
 *       selectedVariant: unknown,
 *     }>,
 *   } | null,
 * }} props
 */
export default function FluxPdpGiftBanner({bundle = null}) {
  const {openCart} = useCartDrawer();
  const sectionRef = useRef(null);
  const hotspots = bundle?.hotspots ?? [];
  const hotspotKey = hotspots.map((spot) => spot.id).join('|');

  const [selectedIds, setSelectedIds] = useState(
    () => new Set(hotspots.map((spot) => spot.id)),
  );

  useEffect(() => {
    setSelectedIds(
      new Set(hotspotKey ? hotspotKey.split('|').filter(Boolean) : []),
    );
  }, [hotspotKey]);

  const scrollTrigger = useMemo(
    () => ({
      trigger: sectionRef,
      start: 'top 80%',
      end: 'bottom top',
      toggleActions: 'play none none none',
    }),
    [],
  );

  const titleBlurSweep = useMemo(
    () => ({
      loop: 4,
      letter: 1.6,
      step: 0.09,
      blur: TITLE_SWEEP_BLUR,
      postReveal: 0.4,
    }),
    [],
  );

  const selectedHotspots = useMemo(
    () => hotspots.filter((spot) => selectedIds.has(spot.id)),
    [hotspots, selectedIds],
  );

  const totalMoney = useMemo(() => {
    const currencyCode =
      selectedHotspots[0]?.price?.currencyCode ||
      hotspots[0]?.price?.currencyCode ||
      'INR';
    if (!selectedHotspots.length) {
      return {amount: '0', currencyCode};
    }
    const amount = selectedHotspots.reduce(
      (sum, spot) => sum + moneyAmount(spot.price),
      0,
    );
    return {amount: String(amount), currencyCode};
  }, [selectedHotspots, hotspots]);

  const lines = useMemo(
    () =>
      selectedHotspots
        .filter((spot) => spot.variantId && spot.availableForSale !== false)
        .map((spot) => ({
          merchandiseId: spot.variantId,
          quantity: 1,
          selectedVariant: spot.selectedVariant,
        })),
    [selectedHotspots],
  );

  const priceLabel = useMemo(() => {
    const amount = moneyAmount(totalMoney);
    const whole = Number.isFinite(amount) ? Math.round(amount) : 0;
    return `${moneySymbol(totalMoney.currencyCode)}${whole.toLocaleString('en-IN')}`;
  }, [totalMoney]);

  const canAdd = lines.length > 0;

  if (!bundle) return null;

  const toggleHotspot = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const desktopBanner = bundle.desktopBanner;
  const mobileBanner = bundle.mobileBanner;

  return (
    <section
      ref={sectionRef}
      className="flux-pdp-gift"
      aria-label={bundle.titleLines.join(' ')}
    >
      <div className="flux-pdp-gift__canvas">
        <div className="flux-pdp-gift__scene">
          <div className="flux-pdp-gift__media" aria-hidden="true">
            <Image
              className="flux-pdp-gift__banner flux-pdp-gift__banner--desktop"
              data={desktopBanner}
              sizes="100vw"
              widths={[720, 1080, 1440, 1920, 2400]}
              loader={shopifyUncroppedLoader}
              alt=""
            />
            <Image
              className="flux-pdp-gift__banner flux-pdp-gift__banner--mobile"
              data={mobileBanner}
              sizes="100vw"
              widths={[480, 720, 960, 1200]}
              loader={shopifyUncroppedLoader}
              alt=""
            />
          </div>

          <AnimatedTitle
            as="h2"
            className="flux-pdp-gift__title"
            lines={bundle.titleLines}
            duration={TITLE_DURATION}
            stagger={TITLE_STAGGER}
            blurSweep={titleBlurSweep}
            scrollTrigger={scrollTrigger}
          />

          <div className="flux-pdp-gift__hotspots">
            {hotspots.map((spot) => {
              const selected = selectedIds.has(spot.id);
              return (
                <button
                  key={spot.id}
                  type="button"
                  className={`flux-pdp-gift__pin${selected ? ' is-selected' : ''}`}
                  style={{
                    '--pin-x-desktop': `${spot.desktopXy.x}%`,
                    '--pin-y-desktop': `${spot.desktopXy.y}%`,
                    '--pin-x-mobile': `${spot.mobileXy.x}%`,
                    '--pin-y-mobile': `${spot.mobileXy.y}%`,
                  }}
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${spot.title}`}
                  onClick={() => toggleHotspot(spot.id)}
                >
                  {selected ? (
                    <Check
                      className="flux-pdp-gift__pin-icon"
                      size={14}
                      weight="bold"
                      aria-hidden
                    />
                  ) : (
                    <img
                      className="flux-pdp-gift__pin-icon flux-pdp-gift__pin-icon--plus"
                      src={hotspotPlus}
                      alt=""
                      width={14}
                      height={14}
                      draggable={false}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flux-pdp-gift__card">
          <div className="flux-pdp-gift__card-row">
            <div className="flux-pdp-gift__price-block">
              <p className="flux-pdp-gift__price">{priceLabel}</p>
              <p className="flux-pdp-gift__taxes">Inclusive of all taxes</p>
            </div>
            <AddToCartButton
              className="flux-pdp-gift__cta"
              lines={lines}
              disabled={!canAdd}
              onClick={() => {
                if (canAdd) openCart();
              }}
            >
              Add to Cart
            </AddToCartButton>
          </div>
          {bundle.description ? (
            <>
              <hr className="flux-pdp-gift__divider" />
              <p className="flux-pdp-gift__copy">{bundle.description}</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
