import {useState} from 'react';
import {useGokwikCheckout} from '~/hooks/useGokwikCheckout';
import './GokwikCheckout.css';

/**
 * Checkout control that waits for the GoKwik SDK, then passes the existing
 * Storefront cart GID into Scenario 2 custom checkout.
 *
 * @param {{
 *   cartId?: string | null;
 *   className?: string;
 *   children?: React.ReactNode;
 * }} props
 */
export function GokwikCheckoutButton({
  cartId,
  className,
  children = 'Checkout',
}) {
  const {triggerCheckout, isGokwikReady, loadError, retryGokwikLoad} =
    useGokwikCheckout();
  const [actionError, setActionError] = useState('');

  const disabled = !cartId || !isGokwikReady || loadError;
  const label = loadError
    ? 'Checkout unavailable'
    : isGokwikReady
      ? children
      : 'Loading checkout…';

  const handleClick = () => {
    setActionError('');
    try {
      triggerCheckout(cartId);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Checkout could not start. Try again.',
      );
    }
  };

  const errorMessage = loadError
    ? 'Checkout could not load. Check your connection and try again.'
    : actionError;

  return (
    <div className="gokwik-checkout">
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-busy={!isGokwikReady && !loadError}
        onClick={handleClick}
      >
        {label}
      </button>
      {errorMessage ? (
        <p className="gokwik-checkout__error" role="alert">
          {errorMessage}{' '}
          {loadError ? (
            <button
              type="button"
              className="gokwik-checkout__retry"
              onClick={() => {
                setActionError('');
                retryGokwikLoad();
              }}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
