import {useEffect, useRef} from 'react';
import {CartForm} from '@shopify/hydrogen';

/**
 * @param {{
 *   analytics?: unknown;
 *   children: React.ReactNode;
 *   className?: string;
 *   disabled?: boolean;
 *   fetcherKey?: string;
 *   lines: Array<OptimisticCartLineInput>;
 *   onClick?: () => void;
 *   onSuccess?: () => void;
 * }}
 */
export function AddToCartButton({
  analytics,
  children,
  className,
  disabled,
  fetcherKey,
  lines,
  onClick,
  onSuccess,
}) {
  return (
    <CartForm
      route="/cart"
      fetcherKey={fetcherKey}
      inputs={{lines}}
      action={CartForm.ACTIONS.LinesAdd}
    >
      {(fetcher) => (
        <AddToCartInner
          fetcher={fetcher}
          className={className}
          disabled={disabled}
          analytics={analytics}
          onClick={onClick}
          onSuccess={onSuccess}
        >
          {children}
        </AddToCartInner>
      )}
    </CartForm>
  );
}

function AddToCartInner({ fetcher, className, disabled, analytics, onClick, onSuccess, children }) {
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    if (prevState.current !== 'idle' && fetcher.state === 'idle') {
      onSuccess?.();
    }
    prevState.current = fetcher.state;
  }, [fetcher.state, onSuccess]);

  return (
    <>
      <input
        name="analytics"
        type="hidden"
        value={JSON.stringify(analytics)}
      />
      <button
        type="submit"
        className={className}
        onClick={onClick}
        disabled={disabled ?? fetcher.state !== 'idle'}
      >
        {children}
      </button>
    </>
  );
}

/** @typedef {import('react-router').FetcherWithComponents} FetcherWithComponents */
/** @typedef {import('@shopify/hydrogen').OptimisticCartLineInput} OptimisticCartLineInput */
