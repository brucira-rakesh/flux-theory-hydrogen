import {
  data as remixData,
  Form,
  NavLink,
  Outlet,
  useLoaderData,
} from 'react-router';
import {CUSTOMER_DETAILS_QUERY} from '~/graphql/customer-account/CustomerDetailsQuery';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import Footer from '~/components/Footer/Footer';
import '~/styles/account.css';

export function shouldRevalidate() {
  return true;
}

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | Account'}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  const {customerAccount} = context;
  const {data, errors} = await customerAccount.query(CUSTOMER_DETAILS_QUERY, {
    variables: {
      language: customerAccount.i18n.language,
    },
  });

  if (errors?.length || !data?.customer) {
    throw new Error('Customer not found');
  }

  return remixData(
    {customer: data.customer},
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    },
  );
}

export default function AccountLayout() {
  /** @type {LoaderReturnData} */
  const {customer} = useLoaderData();

  const heading = customer?.firstName
    ? `Welcome, ${customer.firstName}`
    : 'Your account';

  return (
    <div className="account-page">
      <SiteHeader logoTo="/" />
      <div className="account-page__inner">
        <header className="account-page__hero">
          <p className="account-page__eyebrow">Account</p>
          <h1 className="account-page__title">{heading}</h1>
        </header>
        <AccountMenu />
        <Outlet context={{customer}} />
      </div>
      <Footer />
    </div>
  );
}

function AccountMenu() {
  return (
    <nav className="account-page__nav" aria-label="Account">
      <NavLink
        to="/account/orders"
        className={({isActive}) =>
          `account-page__nav-link${isActive ? ' is-active' : ''}`
        }
      >
        Orders
      </NavLink>
      <NavLink
        to="/account/profile"
        className={({isActive}) =>
          `account-page__nav-link${isActive ? ' is-active' : ''}`
        }
      >
        Profile
      </NavLink>
      <Logout />
    </nav>
  );
}

function Logout() {
  return (
    <Form className="account-page__nav-logout" method="POST" action="/account/logout">
      <button type="submit">Sign out</button>
    </Form>
  );
}

/** @typedef {import('./+types/account').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
