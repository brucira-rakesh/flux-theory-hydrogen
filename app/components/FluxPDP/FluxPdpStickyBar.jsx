import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Money, getProductOptions} from '@shopify/hydrogen';
import {useNavigate} from 'react-router';
import {AddToCartButton} from '~/components/AddToCartButton';
import {useCartDrawer} from '~/components/Cart/CartProvider';
import {useStickyFooterDock} from '~/components/PDP/PdpStickyBar';
import CustomSelect from '~/components/Shop/CustomSelect';
import {useSmoothScrollLock} from '~/components/SmoothScroll/SmoothScroll';
import {
  cartLinesForMerchandise,
  isShopifyDefaultTitleOption,
  shouldShowSizeSelect,
} from '~/lib/storefrontCatalog';

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

function packShippingMessage(selectedValueName) {
  const name = selectedValueName?.trim().toLowerCase() ?? '';
  if (name.includes('pack of 2')) return 'Free Shipping';
  if (name.includes('pack of 1')) return '+₹49 Shipping Fee';
  return null;
}

/** Resolve a pack option value to a merchandise id from product.variants. */
function variantForPackLabel(product, packLabel) {
  const nodes = product?.variants?.nodes ?? [];
  if (!packLabel || !nodes.length) return null;
  return (
    nodes.find((variant) =>
      (variant.selectedOptions ?? []).some(
        (option) =>
          /pack/i.test(option?.name ?? '') && option?.value === packLabel,
      ),
    ) ?? null
  );
}

/**
 * Flux PDP sticky ATC — Figma 309:452 (desktop) + permanent mobile qty/ATC.
 * Mobile (≤900): always visible qty + ATC. Past the hero, ATC opens a
 * pack-size sheet; selecting a pack adds that variant to cart.
 */
export default function FluxPdpStickyBar({
  product,
  selectedVariant,
  price,
  compareAtPrice = null,
  title,
  visible = false,
  heroInView = true,
  quantity = 1,
  onQuantityChange,
  heroControlsRef,
  footerSentinelRef,
}) {
  const navigate = useNavigate();
  const {openCart} = useCartDrawer();
  const barRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useStickyFooterDock(barRef, footerSentinelRef, visible);
  useSmoothScrollLock('flux-pdp-variant-picker', pickerOpen);

  const packEntries = useMemo(() => {
    const options = getProductOptions({
      ...product,
      selectedOrFirstAvailableVariant: selectedVariant,
    });
    const packOptions = options
      .filter(isSwatchableOption)
      .filter(isPackOption);
    const entries = [];
    for (const option of packOptions) {
      for (const value of option.optionValues ?? []) {
        if (
          isShopifyDefaultTitleOption({
            name: option.name,
            value: value.name,
          })
        ) {
          continue;
        }
        const variant = variantForPackLabel(product, value.name);
        entries.push({
          id: `${option.name}::${value.name}`,
          label: value.name,
          note: packShippingMessage(value.name),
          value,
          variantGid: variant?.id ?? null,
          availableForSale:
            value.available !== false &&
            variant?.availableForSale !== false,
        });
      }
    }
    return entries;
  }, [product, selectedVariant]);

  const selectOptions = useMemo(
    () => packEntries.map(({id, label}) => ({id, label})),
    [packEntries],
  );

  const selectedPackId =
    packEntries.find((entry) => entry.value.selected)?.id ??
    selectOptions[0]?.id;

  const selectPackInUrl = (value) => {
    if (!value || value.selected || !value.variantUriQuery) return;
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

  const onPackChange = (id) => {
    const entry = packEntries.find((item) => item.id === id);
    if (!entry) return;
    selectPackInUrl(entry.value);
  };

  const canAdd = Boolean(selectedVariant?.availableForSale !== false);
  const onDesktopAddToCart = () => {
    if (!canAdd) return;
    heroControlsRef?.current?.submit();
  };

  const onMobileAddToCart = () => {
    if (!canAdd) return;
    if (heroInView) {
      heroControlsRef?.current?.submit();
      return;
    }
    if (packEntries.length > 1) {
      setPickerOpen(true);
      return;
    }
    heroControlsRef?.current?.submit();
  };

  return (
    <>
      <aside
        ref={barRef}
        className={`flux-pdp-sticky${visible ? ' is-visible' : ''}`}
        aria-label="Quick add to cart"
        aria-hidden={!visible}
        inert={!visible ? true : undefined}
      >
        <div className="flux-pdp-sticky__desktop">
          <div className="flux-pdp-sticky__copy">
            <p className="flux-pdp-sticky__title">{title}</p>
            {price || compareAtPrice ? (
              <div className="flux-pdp-sticky__price" aria-label="Price">
                <span className="flux-pdp-sticky__mrp">MRP</span>
                {price ? (
                  <span className="flux-pdp-sticky__amount">
                    <Money data={price} withoutTrailingZeros />
                  </span>
                ) : null}
                {compareAtPrice ? (
                  <s className="flux-pdp-sticky__compare">
                    <Money data={compareAtPrice} withoutTrailingZeros />
                  </s>
                ) : null}
              </div>
            ) : null}
          </div>

          {selectOptions.length ? (
            <CustomSelect
              className="custom-select--pdp flux-pdp-sticky__pack-select"
              ariaLabel="Select pack"
              options={selectOptions}
              value={selectedPackId}
              onChange={onPackChange}
              align="right"
            />
          ) : null}

          <button
            type="button"
            className="flux-pdp-sticky__atc"
            disabled={!canAdd}
            onClick={onDesktopAddToCart}
          >
            Add to Cart
          </button>
        </div>

        <div className="flux-pdp-sticky__mobile">
          <div className="flux-pdp-sticky__qty" role="group" aria-label="Quantity">
            <button
              type="button"
              className="flux-pdp-sticky__qty-btn"
              aria-label="Decrease quantity"
              onClick={() => onQuantityChange?.(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
            >
              −
            </button>
            <span className="flux-pdp-sticky__qty-value" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="flux-pdp-sticky__qty-btn"
              aria-label="Increase quantity"
              onClick={() => onQuantityChange?.(quantity + 1)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="flux-pdp-sticky__atc flux-pdp-sticky__atc--mobile"
            disabled={!canAdd}
            onClick={onMobileAddToCart}
          >
            Add to Cart
          </button>
        </div>
      </aside>

      {pickerOpen ? (
        <FluxPdpPackPicker
          packs={packEntries}
          quantity={quantity}
          onClose={() => setPickerOpen(false)}
          onSelectPack={selectPackInUrl}
          onAdded={() => openCart()}
        />
      ) : null}
    </>
  );
}

function FluxPdpPackPicker({packs, quantity, onClose, onSelectPack, onAdded}) {
  const titleId = useId();
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="flux-pdp-variant-picker" role="presentation">
      <button
        type="button"
        className="flux-pdp-variant-picker__backdrop"
        aria-label="Close pack picker"
        onClick={onClose}
      />
      <div
        className="flux-pdp-variant-picker__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flux-pdp-variant-picker__head">
          <h3 id={titleId} className="flux-pdp-variant-picker__title">
            Select pack
          </h3>
          <button
            ref={closeRef}
            type="button"
            className="flux-pdp-variant-picker__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <ul className="flux-pdp-variant-picker__list">
          {packs.map((pack) => {
            const lines = cartLinesForMerchandise(pack.variantGid, quantity);
            const disabled = !lines.length || pack.availableForSale === false;
            return (
              <li key={pack.id} className="flux-pdp-variant-picker__item">
                <AddToCartButton
                  className={`flux-pdp-variant-picker__choice${
                    pack.value.selected ? ' is-selected' : ''
                  }`}
                  lines={lines}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelectPack?.(pack.value);
                    onAdded?.();
                  }}
                  onSuccess={onClose}
                >
                  <span className="flux-pdp-variant-picker__meta">
                    <span className="flux-pdp-variant-picker__name">
                      {pack.label}
                    </span>
                    {pack.note ? (
                      <span className="flux-pdp-variant-picker__note">
                        {pack.note}
                      </span>
                    ) : null}
                    {disabled ? (
                      <span className="flux-pdp-variant-picker__sold">
                        Sold out
                      </span>
                    ) : (
                      <span className="flux-pdp-variant-picker__hint">
                        Add to cart
                      </span>
                    )}
                  </span>
                </AddToCartButton>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
