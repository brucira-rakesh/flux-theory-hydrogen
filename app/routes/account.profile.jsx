import {CUSTOMER_UPDATE_MUTATION} from '~/graphql/customer-account/CustomerUpdateMutation';
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useOutletContext,
} from 'react-router';
import Addresses, {action as addressesAction} from './account.addresses';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | Profile'}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  await context.customerAccount.handleAuthStatus();

  return {};
}

/**
 * @param {Route.ActionArgs}
 */
export async function action(args) {
  const form = await args.request.clone().formData();
  if (form.has('addressId')) {
    return addressesAction(args);
  }

  const {request, context} = args;
  const {customerAccount} = context;

  if (request.method !== 'PUT') {
    return data({error: 'Method not allowed'}, {status: 405});
  }

  try {
    const customer = {};
    const validInputKeys = ['firstName', 'lastName'];
    for (const [key, value] of form.entries()) {
      if (!validInputKeys.includes(key)) {
        continue;
      }
      if (typeof value === 'string' && value.length) {
        customer[key] = value;
      }
    }

    const {data: result, errors} = await customerAccount.mutate(
      CUSTOMER_UPDATE_MUTATION,
      {
        variables: {
          customer,
          language: customerAccount.i18n.language,
        },
      },
    );

    if (errors?.length) {
      throw new Error(errors[0].message);
    }

    if (!result?.customerUpdate?.customer) {
      throw new Error('Customer profile update failed.');
    }

    return {
      error: null,
      customer: result.customerUpdate.customer,
    };
  } catch (error) {
    return data(
      {error: error.message, customer: null},
      {
        status: 400,
      },
    );
  }
}

export default function AccountProfile() {
  const account = useOutletContext();
  const {state, formData} = useNavigation();
  /** @type {ActionReturnData} */
  const action = useActionData();
  const customer = action?.customer ?? account?.customer;
  const profileBusy = state !== 'idle' && !formData?.has('addressId');
  const profileError =
    typeof action?.error === 'string' ? action.error : null;

  return (
    <div className="account-details">
      <section className="account-profile" aria-labelledby="account-profile-heading">
        <h2 id="account-profile-heading">Profile</h2>
        <Form className="account-form" method="PUT">
          <fieldset>
            <legend>Personal information</legend>
            <div className="account-form__fields">
              <div className="account-form__field">
                <label htmlFor="profile-firstName">First name</label>
                <input
                  id="profile-firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  placeholder="First name"
                  aria-label="First name"
                  defaultValue={customer.firstName ?? ''}
                  minLength={2}
                />
              </div>
              <div className="account-form__field">
                <label htmlFor="profile-lastName">Last name</label>
                <input
                  id="profile-lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Last name"
                  aria-label="Last name"
                  defaultValue={customer.lastName ?? ''}
                  minLength={2}
                />
              </div>
            </div>
          </fieldset>
          {profileError ? (
            <p>
              <mark>
                <small>{profileError}</small>
              </mark>
            </p>
          ) : null}
          <button className="account-btn" type="submit" disabled={profileBusy}>
            {profileBusy ? 'Updating' : 'Update'}
          </button>
        </Form>
      </section>

      <hr className="account-section-divider" />

      <Addresses />
    </div>
  );
}

/**
 * @typedef {{
 *   error: string | null;
 *   customer: CustomerFragment | null;
 * }} ActionResponse
 */

/** @typedef {import('customer-accountapi.generated').CustomerFragment} CustomerFragment */
/** @typedef {import('@shopify/hydrogen/customer-account-api-types').CustomerUpdateInput} CustomerUpdateInput */
/** @typedef {import('./+types/account.profile').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
/** @typedef {ReturnType<typeof useActionData<typeof action>>} ActionReturnData */
