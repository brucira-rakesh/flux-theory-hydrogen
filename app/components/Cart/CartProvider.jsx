import {createContext, useContext, useMemo, useState} from 'react';
import {useLocation} from 'react-router';
import {CartDrawer} from './CartDrawer';

const CartDrawerContext = createContext(null);

/**
 * Cart drawer state for branded shop/PDP routes.
 * Closes on pathname change so a named Lenis lock cannot leak across pages.
 */
export function CartProvider({cart, children}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [path, setPath] = useState(location.pathname);

  // Close during render on route change so the named Lenis lock cannot leak
  // into the next page for a frame (effect-based close is one commit late).
  if (location.pathname !== path) {
    setPath(location.pathname);
    setOpen(false);
  }

  const value = useMemo(
    () => ({
      open,
      openCart: () => setOpen(true),
      closeCart: () => setOpen(false),
    }),
    [open],
  );

  return (
    <CartDrawerContext.Provider value={value}>
      {children}
      <CartDrawer cart={cart} open={open} onClose={() => setOpen(false)} />
    </CartDrawerContext.Provider>
  );
}

export function useCartDrawer() {
  const context = useContext(CartDrawerContext);
  return (
    context ?? {
      open: false,
      openCart: () => {},
      closeCart: () => {},
    }
  );
}
