import {Suspense, useEffect, useId, useRef, useState} from 'react';
import {Await, Link} from 'react-router';
import {CartForm, useOptimisticCart} from '@shopify/hydrogen';
import gsap from 'gsap';
import {useSmoothScrollLock} from '../SmoothScroll/SmoothScroll';
import {prefersReducedMotion} from '../../hooks/useSpotlight';
import {formatMoneyDisplay, withoutShopifyDefaultTitleOptions} from '~/lib/storefrontCatalog';
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

        <div className="cart-drawer__body">
          {lines.length === 0 ? (
            <div className="cart-drawer__empty">
              <p>Your bag is empty.</p>
              <Link to="/shop" className="cart-drawer__shop-link" onClick={handleClose}>
                Shop All
              </Link>
            </div>
          ) : (
            <ul className="cart-drawer__lines">
              {lines.map((line) => (
                <CartDrawerLine key={line.id} line={line} onNavigate={handleClose} />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="cart-drawer__foot">
            <div className="cart-drawer__subtotal">
              <span>Subtotal</span>
              <strong>{subtotal ? formatMoneyDisplay(subtotal) : '—'}</strong>
            </div>
            {cart?.checkoutUrl ? (
              <a className="cart-drawer__checkout" href={cart.checkoutUrl}>
                Checkout
              </a>
            ) : (
              <p className="cart-drawer__hint">Checkout will appear once the bag is ready.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function CartDrawerLine({line, onNavigate}) {
  const merchandise = line.merchandise;
  const product = merchandise?.product;
  const image = merchandise?.image;
  const title = product?.title ?? merchandise?.title;
  const href = product?.handle ? `/products/${product.handle}` : '/shop';
  const money = line.cost?.totalAmount ?? merchandise?.price;
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
        <Link to={href} className="cart-drawer__name" onClick={onNavigate}>
          {title}
        </Link>
        {optionLabel ? <p className="cart-drawer__option">{optionLabel}</p> : null}
        <p className="cart-drawer__price">{money ? formatMoneyDisplay(money) : ''}</p>
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
          <CartRemoveButton lineId={line.id} disabled={isOptimistic} />
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
        disabled={disabled}
      >
        Remove
      </button>
    </CartForm>
  );
}
