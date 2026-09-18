import {useEffect, useState} from 'react';
import {useRouteLoaderData} from 'react-router';
import {useOptimisticCart} from '@shopify/hydrogen';

/**
 * Resolved root loader cart with optimistic lines, for PDP shipping copy.
 * Root `cart` is a promise — wait it out so pack notes can use subtotal.
 */
export function useRootOptimisticCart() {
  const root = useRouteLoaderData('root');
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(root?.cart ?? null).then((cart) => {
      if (!cancelled) setResolved(cart ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [root?.cart]);

  return useOptimisticCart(resolved);
}
