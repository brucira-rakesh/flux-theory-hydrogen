import {data} from 'react-router';
import {fetchCartUpsellProducts} from '~/lib/storefrontCatalog';

/**
 * Cart drawer merchandising — complementary/related products not already in bag.
 * @param {Route.LoaderArgs} args
 */
export async function loader({request, context}) {
  const cart = await context.cart.get();
  const products = await fetchCartUpsellProducts(context.storefront, cart);
  const key = new URL(request.url).searchParams.get('key') || '';
  return data({products, key});
}

/** @typedef {import('./+types/api.cart-drawer').Route} Route */
