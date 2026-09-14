import {useMemo, useRef} from 'react';
import {Money, getProductOptions} from '@shopify/hydrogen';
import {useNavigate} from 'react-router';
import {useStickyFooterDock} from '~/components/PDP/PdpStickyBar';
import CustomSelect from '~/components/Shop/CustomSelect';
import {
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

/**
 * Flux PDP sticky ATC — Figma 309:452.
 * Title + MRP/price + pack dropdown + Add to Cart. No description.
 */
export default function FluxPdpStickyBar({
  product,
  selectedVariant,
  price,
  compareAtPrice = null,
  title,
  visible = false,
  heroControlsRef,
  footerSentinelRef,
}) {
  const navigate = useNavigate();
  const barRef = useRef(null);
  useStickyFooterDock(barRef, footerSentinelRef, visible);

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
        entries.push({
          id: `${option.name}::${value.name}`,
          label: value.name,
          value,
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

  const onPackChange = (id) => {
    const entry = packEntries.find((item) => item.id === id);
    if (!entry) return;
    const value = entry.value;
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

  const canAdd = Boolean(selectedVariant?.availableForSale !== false);
  const onAddToCart = () => {
    if (!canAdd) return;
    heroControlsRef?.current?.submit();
  };

  return (
    <aside
      ref={barRef}
      className={`flux-pdp-sticky${visible ? ' is-visible' : ''}`}
      aria-label="Quick add to cart"
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
    >
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
        onClick={onAddToCart}
      >
        Add to Cart
      </button>
    </aside>
  );
}
