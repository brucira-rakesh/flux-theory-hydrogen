import {Form, redirect, useNavigation} from 'react-router';
import FooterV3 from '~/components/Footer/FooterV3';
import {Logo} from '~/components/Header/icons';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import '~/styles/account.css';

/**
 * Branded Flux sign-in. Shopify still hosts the Shop identity step after
 * submit (OAuth) — this page is the on-site UI we control.
 *
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | Sign in'}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  if (await context.customerAccount.isLoggedIn()) {
    throw redirect('/account');
  }
  return null;
}

/**
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  const url = new URL(request.url);
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();

  return context.customerAccount.login({
    countryCode: context.storefront.i18n.country,
    acrValues: url.searchParams.get('acr_values') || undefined,
    locale: url.searchParams.get('locale') || undefined,
    loginHint: email || undefined,
  });
}

export default function AccountLogin() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  return (
    <div className="account-page account-login">
      <SiteHeader />
      <main className="account-login__main">
        <div className="account-login__card">
          <Logo className="account-login__mark" />
          <p className="account-login__brand">Flux Theory</p>
          <h1 className="account-login__title">Sign in</h1>
          <p className="account-login__lead">
            Sign in or create an account
          </p>

          <Form className="account-login__form" method="post">
            <label className="account-login__field">
              <span className="visually-hidden">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="Email"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="account-login__submit"
              disabled={busy}
            >
              {busy ? 'Continuing…' : 'Continue'}
            </button>
          </Form>

          <p className="account-login__legal">
            By continuing, you agree to our{' '}
            <a href="/policies/terms-of-service">Terms of service</a>
            {' '}and{' '}
            <a href="/policies/privacy-policy">Privacy policy</a>.
          </p>
        </div>
      </main>
      <FooterV3 />
    </div>
  );
}

/** @typedef {import('./+types/account_.login').Route} Route */
