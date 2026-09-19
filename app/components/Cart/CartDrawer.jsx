import {Suspense, useEffect, useId, useRef, useState} from 'react';
import {Await, Link, useFetcher, useRouteLoaderData} from 'react-router';
import {CartForm, useOptimisticCart} from '@shopify/hydrogen';
import gsap from 'gsap';
import {useSmoothScrollLock} from '../SmoothScroll/SmoothScroll';
import {prefersReducedMotion} from '../../hooks/useSpotlight';
import {
  cartCompareSubtotal,
  cartLinePricing,
  cartLinesForMerchandise,
  formatMoneyDisplay,
  shouldShowSizeSelect,
  uniqueOffersFromCart,
  withoutShopifyDefaultTitleOptions,
} from '~/lib/storefrontCatalog';
import {
  calculateCartProgress,
  cartProgressMessage,
} from '~/lib/cartProgress';
import {GokwikCheckoutButton} from '~/components/Gokwik/GokwikCheckoutButton';
import CustomSelect from '~/components/Shop/CustomSelect';
import iconOfferCopy from '~/assets/pdp/offers/icon-copy.svg';
import './CartDrawer.css';

export function CartDrawer({cart, open, onClose}) {
  const [displayCart, setDisplayCart] = useState(null);
  const resolved =
    cart && typeof cart.then === 'function' ? cart : Promise.resolve(cart ?? null);

  return (
    <>
      <Suspense fallback={null}>
        <Await resolve={resolved}>
          {(resolvedCart) => (
            <CartPromiseBridge cart={resolvedCart} onResolved={setDisplayCart} />
          )}
        </Await>
      </Suspense>
      <CartDrawerPanel cart={displayCart} open={open} onClose={onClose} />
    </>
  );
}

function CartPromiseBridge({cart, onResolved}) {
  useEffect(() => {
    onResolved(cart ?? null);
  }, [cart, onResolved]);
  return null;
}

function CartDrawerPanel({cart: originalCart, open, onClose}) {
  const cart = useOptimisticCart(originalCart);
  const titleId = useId();
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const closeRef = useRef(null);

  useSmoothScrollLock('cart-drawer', open);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return undefined;

    if (!open) {
      if (prefersReducedMotion()) {
        gsap.set(panel, {x: '105%'});
        gsap.set(backdrop, {opacity: 0, pointerEvents: 'none'});
      }
      return undefined;
    }

    if (prefersReducedMotion()) {
      gsap.set(backdrop, {opacity: 1, pointerEvents: 'auto'});
      gsap.set(panel, {x: 0});
      return undefined;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdrop,
        {opacity: 0},
        {opacity: 1, duration: 0.35, ease: 'power2.out', pointerEvents: 'auto'},
      );
      gsap.fromTo(
        panel,
        {x: '105%'},
        {x: 0, duration: 0.5, ease: 'power3.out'},
      );
    });

    return () => ctx.revert();
  }, [open]);

  const handleClose = () => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop || prefersReducedMotion()) {
      onClose?.();
      return;
    }
    const tl = gsap.timeline({
      onComplete: () => onClose?.(),
    });
    tl.to(panel, {x: '105%', duration: 0.38, ease: 'power3.in'}, 0);
    tl.to(backdrop, {opacity: 0, duration: 0.3, ease: 'power2.in'}, 0);
  };

  const lines = cart?.lines?.nodes ?? [];
  const count = cart?.totalQuantity ?? 0;
  const subtotal = cart?.cost?.subtotalAmount;
  const subtotalPricing = cartCompareSubtotal(cart);
  const offers = uniqueOffersFromCart(cart);
  const root = useRouteLoaderData('root');
  const progress = calculateCartProgress(cart, root?.cartProgressTiers ?? []);
  const productKey = lines
    .map((line) => line?.merchandise?.product?.id)
    .filter(Boolean)
    .join('|');

  return (
    <div className={`cart-drawer${open ? ' is-open' : ''}`} inert={!open ? true : undefined}>
      <button
        ref={backdropRef}
        type="button"
        className="cart-drawer__backdrop"
        aria-label="Close cart"
        tabIndex={open ? 0 : -1}
        onClick={handleClose}
      />
      <aside
        ref={panelRef}
        className="cart-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
      >
        <div className="cart-drawer__head">
          <h2 id={titleId} className="cart-drawer__title">
            Bag{count > 0 ? ` (${count})` : ''}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="cart-drawer__close"
            aria-label="Close cart"
            tabIndex={open ? 0 : -1}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        <div className="cart-drawer__body" data-lenis-prevent>
          {lines.length === 0 ? (
            <div className="cart-drawer__empty">
              <p>Your bag is empty.</p>
              <Link to="/shop" className="cart-drawer__shop-link" onClick={handleClose}>
                Shop All
              </Link>
            </div>
          ) : (
            <>
              {progress ? (
                <CartDrawerProgress
                  progress={progress}
                  currencyCode={subtotal?.currencyCode}
                />
              ) : null}
              <ul className="cart-drawer__lines">
                {lines.map((line) => (
                  <CartDrawerLine key={line.id} line={line} onNavigate={handleClose} />
                ))}
              </ul>
              <CartDrawerUpsell
                open={open}
                productKey={productKey}
                onNavigate={handleClose}
              />
            </>
          )}
        </div>

        {lines.length > 0 && (
          <div className="cart-drawer__foot">
            <CartDrawerDiscount
              discountCodes={cart?.discountCodes}
              offers={offers}
            />
            <div
              className={`cart-drawer__subtotal${
                subtotalPricing.compare ? ' cart-drawer__subtotal--sale' : ''
              }`}
            >
              <span>
                Subtotal ({subtotalPricing.count}{' '}
                {subtotalPricing.count === 1 ? 'item' : 'items'})
              </span>
              <span className="cart-drawer__subtotal-amounts">
                <strong>
                  {subtotalPricing.payable
                    ? formatMoneyDisplay(subtotalPricing.payable)
                    : '—'}
                </strong>
                {subtotalPricing.compare ? (
                  <s>{formatMoneyDisplay(subtotalPricing.compare)}</s>
                ) : null}
              </span>
            </div>
            {cart?.id ? (
              <GokwikCheckoutButton
                cartId={cart.id}
                className="cart-drawer__checkout"
              >
                Checkout
              </GokwikCheckoutButton>
            ) : (
              <p className="cart-drawer__hint">Checkout will appear once the bag is ready.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function CartDrawerProgress({progress, currencyCode = 'INR'}) {
  const {progressPercent, nextTier, tiers, lastThreshold, cartValue} =
    progress;
  const complete = !nextTier;
  const message = cartProgressMessage(progress, currencyCode);
  const rewardTier = nextTier ?? tiers[tiers.length - 1] ?? null;

  return (
    <div
      className={`cart-drawer__progress${complete ? ' is-complete' : ''}`}
      aria-label="Cart rewards"
    >
      <p className="cart-drawer__progress-copy">{message}</p>
      <CartDrawerProgressReward tier={rewardTier} />
      <div
        className="cart-drawer__progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={lastThreshold}
        aria-valuenow={cartValue}
        aria-valuetext={message}
      >
        <span
          className="cart-drawer__progress-fill"
          style={{width: `${progressPercent}%`}}
        />
        {tiers.map((tier, index) => {
          const reached = cartValue >= tier.thresholdValue;
          const isEnd = index === tiers.length - 1;
          const position =
            lastThreshold > 0 ? (tier.thresholdValue / lastThreshold) * 100 : 100;
          return (
            <span
              key={tier.id}
              className={`cart-drawer__progress-tick${reached ? ' is-reached' : ''}${isEnd ? ' is-end' : ''}`}
              style={{left: `${position}%`}}
              title={tierRewardTitle(tier)}
            >
              <span className="cart-drawer__progress-dot" aria-hidden="true">
                {reached ? (
                  <svg viewBox="0 0 12 12" width="8" height="8">
                    <path
                      d="M2.4 6.2 4.9 8.6 9.6 3.4"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
              <span className="cart-drawer__progress-label">{tier.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function tierRewardTitle(tier) {
  const parts = [tier.rewardProduct?.title, tier.rewardText].filter(Boolean);
  return parts.length ? parts.join(' — ') : undefined;
}

function CartDrawerProgressReward({tier}) {
  if (!tier) return null;
  const product = tier.rewardProduct;
  const text = tier.rewardText;
  // FLAG: when both are present, text is treated as a caption for the
  // product (gift label), not a second independent reward.
  if (!product && !text) return null;

  return (
    <div className="cart-drawer__progress-reward">
      {product?.handle ? (
        <Link
          to={`/products/${product.handle}`}
          className="cart-drawer__progress-reward-product"
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.imageAlt || ''} />
          ) : null}
          {product.title ? <span>{product.title}</span> : null}
        </Link>
      ) : product?.title ? (
        <span className="cart-drawer__progress-reward-product">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.imageAlt || ''} />
          ) : null}
          <span>{product.title}</span>
        </span>
      ) : null}
      {text ? <p className="cart-drawer__progress-reward-text">{text}</p> : null}
    </div>
  );
}

function CartDrawerDiscount({discountCodes, offers = []}) {
  const inputId = useId();
  const [offersOpen, setOffersOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState('');
  const codes =
    discountCodes
      ?.filter((discount) => discount.applicable)
      ?.map(({code}) => code) || [];

  const copyOfferCode = (code) => {
    if (!code || typeof navigator === 'undefined') return;
    navigator.clipboard?.writeText(code).then(() => {
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(''), 1800);
    }).catch(() => {});
  };

  return (
    <div className="cart-drawer__offers">
      {codes.length > 0 ? (
        <div className="cart-drawer__discount-applied" role="group" aria-label="Applied discounts">
          <CartForm
            route="/cart"
            action={CartForm.ACTIONS.DiscountCodesUpdate}
            inputs={{discountCodes: []}}
          >
            <code className="cart-drawer__discount-code">{codes.join(', ')}</code>
            <button type="submit" className="cart-drawer__discount-remove" aria-label="Remove discount">
              Remove
            </button>
          </CartForm>
        </div>
      ) : null}

      <CartForm
        route="/cart"
        action={CartForm.ACTIONS.DiscountCodesUpdate}
        inputs={{discountCodes: codes}}
      >
        <div className="cart-drawer__discount-form">
          <label htmlFor={inputId} className="sr-only">
            Discount code
          </label>
          <input
            id={inputId}
            className="cart-drawer__discount-input"
            type="text"
            name="discountCode"
            placeholder="Discount code"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="cart-drawer__discount-apply">
            Apply
          </button>
        </div>
      </CartForm>

      <button
        type="button"
        className={`cart-drawer__offers-toggle${offersOpen ? ' is-open' : ''}`}
        aria-expanded={offersOpen}
        aria-controls="cart-drawer-offer-cards"
        onClick={() => setOffersOpen((open) => !open)}
      >
        <span>Available Offers</span>
        <span className="cart-drawer__offers-icon" aria-hidden="true">
          <span className="cart-drawer__offers-icon-h" />
          <span className="cart-drawer__offers-icon-v" />
        </span>
      </button>

      <div
        id="cart-drawer-offer-cards"
        className={`cart-drawer__offers-panel${offersOpen ? ' is-open' : ''}`}
      >
        <div className="cart-drawer__offers-clip">
          {offers.length ? (
            <div className="cart-drawer__offer-grid" aria-label="Offer cards">
              {offers.map((offer) => (
                <article
                  key={offer.id}
                  className={`cart-drawer-offer cart-drawer-offer--${offer.variant}`}
                >
                  <div className="cart-drawer-offer__top">
                    <div className="cart-drawer-offer__head">
                      <p className="cart-drawer-offer__code">{offer.code}</p>
                      {offer.title ? (
                        <p className="cart-drawer-offer__title">{offer.title}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="cart-drawer-offer__copy"
                      aria-label={`Copy code ${offer.code}`}
                      onClick={() => copyOfferCode(offer.code)}
                    >
                      <img src={iconOfferCopy} alt="" width={16} height={16} />
                      <span
                        className={`cart-drawer-offer__toast${copiedCode === offer.code ? ' is-visible' : ''}`}
                      >
                        Copied
                      </span>
                    </button>
                  </div>
                  {offer.detail ? (
                    <p className="cart-drawer-offer__detail">{offer.detail}</p>
                  ) : null}
                  <CartForm
                    route="/cart"
                    action={CartForm.ACTIONS.DiscountCodesUpdate}
                    inputs={{discountCodes: codes}}
                  >
                    <input type="hidden" name="discountCode" value={offer.code} />
                    <button type="submit" className="cart-drawer-offer__apply">
                      {codes.includes(offer.code) ? 'Applied' : 'Apply'}
                    </button>
                  </CartForm>
                </article>
              ))}
            </div>
          ) : (
            <p className="cart-drawer__offers-empty">
              No extra offers on these items right now.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CartDrawerUpsell({open, productKey, onNavigate}) {
  const fetcher = useFetcher();
  const products = fetcher.data?.products ?? [];

  useEffect(() => {
    if (!open || !productKey) return undefined;
    if (fetcher.state !== 'idle') return undefined;
    if (fetcher.data?.key === productKey) return undefined;
    fetcher.load(`/api/cart-drawer?key=${encodeURIComponent(productKey)}`);
    return undefined;
  }, [open, productKey, fetcher.state, fetcher.data?.key]);

  if (!products.length) return null;

  return (
    <section className="cart-drawer__upsell" aria-label="You may also like">
      <h3 className="cart-drawer__upsell-title">You May Also Like</h3>
      <ul className="cart-drawer__upsell-rail">
        {products.map((product) => (
          <CartDrawerUpsellItem
            key={product.id}
            product={product}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

function CartDrawerUpsellItem({product, onNavigate}) {
  const sizes = product.sizes ?? [];
  const showPicker = shouldShowSizeSelect(sizes);
  const [size, setSize] = useState(product.defaultSize ?? sizes[0] ?? '');
  const selected = showPicker ? product.variantBySize?.[size] ?? null : null;
  const merchandiseId = selected?.id ?? product.variantGid;
  const priceAmount = selected?.priceAmount ?? product.price;
  const currency = selected?.priceCurrency ?? product.currency;
  const pickerLabel = product.variantOptionLabel ?? 'Pack';

  return (
    <li className="cart-drawer__upsell-item">
      <Link
        to={product.href}
        className="cart-drawer__upsell-media"
        onClick={onNavigate}
      >
        {product.image ? (
          <img src={product.image} alt="" />
        ) : (
          <span className="cart-drawer__thumb-empty" />
        )}
      </Link>
      <Link
        to={product.href}
        className="cart-drawer__upsell-name"
        onClick={onNavigate}
      >
        {product.name}
      </Link>
      <div className="cart-drawer__upsell-meta">
        <p className="cart-drawer__upsell-price">
          {currency}
          {Number(priceAmount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        {showPicker ? (
          <CustomSelect
            className="cart-drawer__upsell-select"
            align="right"
            ariaLabel={`Select ${String(pickerLabel).toLowerCase()} for ${product.name}`}
            options={sizes.map((option) => ({id: option, label: option}))}
            value={size}
            onChange={setSize}
          />
        ) : null}
      </div>
      {merchandiseId ? (
        <div className="cart-drawer__upsell-atc">
          <CartForm
            key={merchandiseId}
            route="/cart"
            action={CartForm.ACTIONS.LinesAdd}
            inputs={{
              lines: cartLinesForMerchandise(merchandiseId, 1),
            }}
          >
            <button
              type="submit"
              className="cart-drawer__upsell-add"
              aria-label={`Add ${product.name}`}
              disabled={selected ? selected.availableForSale === false : false}
            >
              Add
            </button>
          </CartForm>
        </div>
      ) : null}
    </li>
  );
}

function CartDrawerLine({line, onNavigate}) {
  const merchandise = line.merchandise;
  const product = merchandise?.product;
  const image = merchandise?.image;
  const title = product?.title ?? merchandise?.title;
  const href = product?.handle ? `/products/${product.handle}` : '/shop';
  const {payable, compareTotal, percentOff} = cartLinePricing(line);
  const optionLabel = visibleOptions(merchandise?.selectedOptions);
  const isOptimistic = Boolean(line.isOptimistic);

  return (
    <li className="cart-drawer__line">
      <Link to={href} className="cart-drawer__thumb" onClick={onNavigate}>
        {image?.url ? (
          <img src={image.url} alt="" width={72} height={72} />
        ) : (
          <span className="cart-drawer__thumb-empty" />
        )}
      </Link>
      <div className="cart-drawer__meta">
        <div className="cart-drawer__title-row">
          <Link to={href} className="cart-drawer__name" onClick={onNavigate}>
            {title}
          </Link>
          <CartRemoveButton lineId={line.id} disabled={isOptimistic} />
        </div>
        {optionLabel ? <p className="cart-drawer__option">{optionLabel}</p> : null}
        <div className="cart-drawer__price-row">
          <p className="cart-drawer__price">
            {payable ? (
              <span className="cart-drawer__price-current">
                {formatMoneyDisplay(payable)}
              </span>
            ) : null}
            {compareTotal ? (
              <s className="cart-drawer__price-compare">
                {formatMoneyDisplay(compareTotal)}
              </s>
            ) : null}
            {percentOff != null ? (
              <span className="cart-drawer__price-badge">{percentOff}% OFF</span>
            ) : null}
          </p>
          <div className="cart-drawer__qty" role="group" aria-label={`Quantity for ${title}`}>
            <div className="cart-drawer__qty-control">
              <CartQtyButton
                lineId={line.id}
                quantity={Math.max(1, line.quantity - 1)}
                disabled={line.quantity <= 1 || isOptimistic}
                label="Decrease quantity"
              >
                −
              </CartQtyButton>
              <span className="cart-drawer__qty-value">{line.quantity}</span>
              <CartQtyButton
                lineId={line.id}
                quantity={line.quantity + 1}
                disabled={isOptimistic}
                label="Increase quantity"
              >
                +
              </CartQtyButton>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function visibleOptions(selectedOptions = []) {
  const meaningful = withoutShopifyDefaultTitleOptions(selectedOptions);
  if (!meaningful.length) return '';
  return meaningful.map((option) => option.value).join(' · ');
}

function CartQtyButton({lineId, quantity, disabled, label, children}) {
  return (
    <CartForm
      fetcherKey={`cart-qty-${lineId}`}
      route="/cart"
      action={CartForm.ACTIONS.LinesUpdate}
      inputs={{lines: [{id: lineId, quantity}]}}
    >
      <button
        type="submit"
        className="cart-drawer__qty-btn"
        aria-label={label}
        disabled={disabled}
      >
        {children}
      </button>
    </CartForm>
  );
}

function CartRemoveButton({lineId, disabled}) {
  return (
    <CartForm
      fetcherKey={`cart-remove-${lineId}`}
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds: [lineId]}}
    >
      <button
        type="submit"
        className="cart-drawer__remove"
        aria-label="Remove"
        disabled={disabled}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M 10 2 L 9 3 L 4 3 L 4 5 L 5 5 L 5 20 C 5 20.522222 5.1913289 21.05461 5.5683594 21.431641 C 5.9453899 21.808671 6.4777778 22 7 22 L 17 22 C 17.522222 22 18.05461 21.808671 18.431641 21.431641 C 18.808671 21.05461 19 20.522222 19 20 L 19 5 L 20 5 L 20 3 L 15 3 L 14 2 L 10 2 z M 7 5 L 17 5 L 17 20 L 7 20 L 7 5 z M 9 7 L 9 18 L 11 18 L 11 7 L 9 7 z M 13 7 L 13 18 L 15 18 L 15 7 L 13 7 z"
          />
        </svg>
      </button>
    </CartForm>
  );
}
