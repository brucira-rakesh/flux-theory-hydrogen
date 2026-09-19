import {data, Link} from 'react-router';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import FooterV3 from '~/components/Footer/FooterV3';
import '~/components/Gokwik/ThankYou.css';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | Order confirmed'}];
};

/**
 * Scenario 2: GoKwik cannot clear the Hydrogen cart cookie. Rotate to a
 * fresh Storefront cart and persist it the same way the rest of the app does
 * (`cart` cookie via cart.setCartId). Loader data is a flag only — no cartId.
 * @param {Route.LoaderArgs} args
 */
export async function loader({context}) {
  const {cart} = context;
  /** @type {Headers} */
  let headers = new Headers();

  try {
    const created = await cart.create({});
    if (created?.cart?.id) {
      headers = cart.setCartId(created.cart.id);
    } else {
      throw new Error('empty-create');
    }
  } catch {
    console.error('Failed to rotate Hydrogen cart after GoKwik checkout');
    try {
      const current = await cart.get();
      const lineIds =
        current?.lines?.nodes?.map((line) => line?.id).filter(Boolean) ?? [];
      if (lineIds.length) {
        const removed = await cart.removeLines(lineIds);
        if (removed?.cart?.id) {
          headers = cart.setCartId(removed.cart.id);
        }
      }
    } catch {
      console.error('Failed to rotate Hydrogen cart after GoKwik checkout');
    }
  }

  return data({ok: true}, {headers});
}

export default function ThankYou() {
  return (
    <div className="thank-you-page">
      <SiteHeader />
      <main className="thank-you-main">
        <p className="thank-you-eyebrow">Order confirmed</p>
        <h1 className="thank-you-title">Thank you</h1>
        <p className="thank-you-copy">
          Your order is confirmed. A receipt is on its way if an email was
          provided at checkout.
        </p>
        <Link to="/shop" className="thank-you-cta">
          Continue shopping
        </Link>
      </main>
      <FooterV3 />
    </div>
  );
}

/** @typedef {import('./+types/thank-you').Route} Route */
