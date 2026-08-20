import {
  data,
  Form,
  redirect,
  useActionData,
  useNavigation,
  useOutletContext,
} from 'react-router';
import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  UPDATE_ADDRESS_MUTATION,
  DELETE_ADDRESS_MUTATION,
  CREATE_ADDRESS_MUTATION,
} from '~/graphql/customer-account/CustomerAddressMutations';
import {useSmoothScrollLock} from '~/components/SmoothScroll/SmoothScroll';

/**
 * Old URL — profile and addresses now share /account/profile.
 * @param {Route.LoaderArgs}
 */
export async function loader() {
  return redirect('/account/profile#addresses');
}

/**
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  const {customerAccount} = context;

  try {
    const form = await request.formData();

    const addressId = form.has('addressId')
      ? String(form.get('addressId'))
      : null;
    if (!addressId) {
      throw new Error('You must provide an address id.');
    }

    // this will ensure redirecting to login never happen for mutatation
    const isLoggedIn = await customerAccount.isLoggedIn();
    if (!isLoggedIn) {
      return data(
        {error: {[addressId]: 'Unauthorized'}},
        {
          status: 401,
        },
      );
    }

    const defaultAddress = form.has('defaultAddress')
      ? String(form.get('defaultAddress')) === 'on'
      : false;
    const address = {};
    const keys = [
      'address1',
      'address2',
      'city',
      'company',
      'territoryCode',
      'firstName',
      'lastName',
      'phoneNumber',
      'zoneCode',
      'zip',
    ];

    for (const key of keys) {
      const value = form.get(key);
      if (typeof value === 'string') {
        address[key] = value;
      }
    }

    switch (request.method) {
      case 'POST': {
        // handle new address creation
        try {
          const {data, errors} = await customerAccount.mutate(
            CREATE_ADDRESS_MUTATION,
            {
              variables: {
                address,
                defaultAddress,
                language: customerAccount.i18n.language,
              },
            },
          );

          if (errors?.length) {
            throw new Error(errors[0].message);
          }

          if (data?.customerAddressCreate?.userErrors?.length) {
            throw new Error(data?.customerAddressCreate?.userErrors[0].message);
          }

          if (!data?.customerAddressCreate?.customerAddress) {
            throw new Error('Customer address create failed.');
          }

          return {
            error: null,
            createdAddress: data?.customerAddressCreate?.customerAddress,
            defaultAddress,
          };
        } catch (error) {
          if (error instanceof Error) {
            return data(
              {error: {[addressId]: error.message}},
              {
                status: 400,
              },
            );
          }
          return data(
            {error: {[addressId]: error}},
            {
              status: 400,
            },
          );
        }
      }

      case 'PUT': {
        // handle address updates
        try {
          const {data, errors} = await customerAccount.mutate(
            UPDATE_ADDRESS_MUTATION,
            {
              variables: {
                address,
                addressId: decodeURIComponent(addressId),
                defaultAddress,
                language: customerAccount.i18n.language,
              },
            },
          );

          if (errors?.length) {
            throw new Error(errors[0].message);
          }

          if (data?.customerAddressUpdate?.userErrors?.length) {
            throw new Error(data?.customerAddressUpdate?.userErrors[0].message);
          }

          if (!data?.customerAddressUpdate?.customerAddress) {
            throw new Error('Customer address update failed.');
          }

          return {
            error: null,
            updatedAddress: address,
            defaultAddress,
          };
        } catch (error) {
          if (error instanceof Error) {
            return data(
              {error: {[addressId]: error.message}},
              {
                status: 400,
              },
            );
          }
          return data(
            {error: {[addressId]: error}},
            {
              status: 400,
            },
          );
        }
      }

      case 'DELETE': {
        // handles address deletion
        try {
          const {data, errors} = await customerAccount.mutate(
            DELETE_ADDRESS_MUTATION,
            {
              variables: {
                addressId: decodeURIComponent(addressId),
                language: customerAccount.i18n.language,
              },
            },
          );

          if (errors?.length) {
            throw new Error(errors[0].message);
          }

          if (data?.customerAddressDelete?.userErrors?.length) {
            throw new Error(data?.customerAddressDelete?.userErrors[0].message);
          }

          if (!data?.customerAddressDelete?.deletedAddressId) {
            throw new Error('Customer address delete failed.');
          }

          return {error: null, deletedAddress: addressId};
        } catch (error) {
          if (error instanceof Error) {
            return data(
              {error: {[addressId]: error.message}},
              {
                status: 400,
              },
            );
          }
          return data(
            {error: {[addressId]: error}},
            {
              status: 400,
            },
          );
        }
      }

      default: {
        return data(
          {error: {[addressId]: 'Method not allowed'}},
          {
            status: 405,
          },
        );
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      return data(
        {error: error.message},
        {
          status: 400,
        },
      );
    }
    return data(
      {error},
      {
        status: 400,
      },
    );
  }
}

const EMPTY_ADDRESS = {
  address1: '',
  address2: '',
  city: '',
  company: '',
  territoryCode: '',
  firstName: '',
  id: 'new',
  lastName: '',
  phoneNumber: '',
  zoneCode: '',
  zip: '',
};

export default function Addresses() {
  const {customer} = useOutletContext();
  const {defaultAddress, addresses} = customer;
  /** @type {ActionReturnData} */
  const action = useActionData();
  /** @type {null | 'create' | string} */
  const [modal, setModal] = useState(null);

  useEffect(() => {
    if (action?.createdAddress || action?.updatedAddress) {
      setModal(null);
    }
  }, [action]);

  const saved = addresses?.nodes ?? [];
  const editingAddress =
    modal && modal !== 'create'
      ? saved.find((address) => address.id === modal) ?? null
      : null;
  const modalOpen = modal === 'create' || Boolean(editingAddress);

  return (
    <div className="account-addresses" id="addresses">
      <div className="account-addresses__head">
        <h2>Addresses</h2>
        <button
          className="account-btn"
          type="button"
          onClick={() => setModal('create')}
        >
          + Add new address
        </button>
      </div>

      {saved.length ? (
        <ul className="account-address-grid">
          {saved.map((address) => (
            <li key={address.id}>
              <SavedAddressCard
                address={address}
                defaultAddress={defaultAddress}
                onEdit={() => setModal(address.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="account-empty">You have no addresses saved.</p>
      )}

      {modalOpen ? (
        <AddressModal
          key={modal === 'create' ? 'create' : editingAddress?.id}
          mode={modal === 'create' ? 'create' : 'edit'}
          address={editingAddress ?? EMPTY_ADDRESS}
          addressId={modal === 'create' ? 'NEW_ADDRESS_ID' : editingAddress.id}
          defaultAddress={defaultAddress}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Shared add/edit address modal.
 * Desktop: centered overlay (ProductFormPopup pattern).
 * Mobile (≤640px, account breakpoint): bottom sheet — same as PLP ATC popup.
 */
function AddressModal({mode, address, addressId, defaultAddress, onClose}) {
  const titleId = useId();
  const closeRef = useRef(null);
  const isCreate = mode === 'create';

  useSmoothScrollLock('account-address-modal', true);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="account-address-modal" role="presentation">
      <button
        type="button"
        className="account-address-modal__backdrop"
        aria-label="Close address form"
        onClick={onClose}
      />
      <div
        className="account-address-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="account-address-modal__head">
          <h3 id={titleId}>{isCreate ? 'Add new address' : 'Edit address'}</h3>
          <button
            ref={closeRef}
            type="button"
            className="account-address-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <AddressForm
          addressId={addressId}
          address={address}
          defaultAddress={defaultAddress}
        >
          {({stateForMethod}) => {
            const method = isCreate ? 'POST' : 'PUT';
            const busy = stateForMethod(method) !== 'idle';
            return (
              <div className="account-form__actions">
                <button
                  className="account-btn"
                  disabled={busy}
                  formMethod={method}
                  type="submit"
                >
                  {busy
                    ? isCreate
                      ? 'Creating'
                      : 'Saving'
                    : isCreate
                      ? 'Create'
                      : 'Save'}
                </button>
                <button
                  className="account-btn account-btn--ghost"
                  type="button"
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            );
          }}
        </AddressForm>
      </div>
    </div>,
    document.body,
  );
}

/**
 * @param {{
 *   address: AddressFragment;
 *   defaultAddress: CustomerFragment['defaultAddress'];
 *   onEdit: () => void;
 * }}
 */
function SavedAddressCard({address, defaultAddress, onEdit}) {
  const {state, formMethod} = useNavigation();
  const deleting = formMethod === 'DELETE' && state !== 'idle';
  const isDefault = defaultAddress?.id === address.id;
  const lines = address.formatted?.filter(Boolean) ?? [];

  return (
    <article
      className={`account-address-card${isDefault ? ' is-default' : ''}`}
    >
      {isDefault ? (
        <p className="account-address-card__badge">Default</p>
      ) : null}

      {lines.length ? (
        <address>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </address>
      ) : (
        <address>
          <p>
            {[address.firstName, address.lastName].filter(Boolean).join(' ')}
          </p>
          <p>{address.address1}</p>
          {address.address2 ? <p>{address.address2}</p> : null}
          <p>
            {[address.city, address.zoneCode, address.zip]
              .filter(Boolean)
              .join(', ')}
          </p>
        </address>
      )}

      <div className="account-address-card__actions">
        <button
          className="account-btn account-btn--ghost"
          type="button"
          onClick={onEdit}
        >
          Edit
        </button>
        <Form method="DELETE">
          <input type="hidden" name="addressId" defaultValue={address.id} />
          <button
            className="account-btn account-btn--ghost"
            disabled={deleting}
            type="submit"
          >
            {deleting ? 'Deleting' : 'Delete'}
          </button>
        </Form>
      </div>
    </article>
  );
}

/**
 * @param {{
 *   addressId: AddressFragment['id'];
 *   address: CustomerAddressInput;
 *   defaultAddress: CustomerFragment['defaultAddress'];
 *   children: (props: {
 *     stateForMethod: (method: 'PUT' | 'POST' | 'DELETE') => Fetcher['state'];
 *   }) => React.ReactNode;
 * }}
 */
export function AddressForm({addressId, address, defaultAddress, children}) {
  const {state, formMethod} = useNavigation();
  /** @type {ActionReturnData} */
  const action = useActionData();
  const error =
    action?.error && typeof action.error === 'object'
      ? action.error[addressId]
      : null;
  const isDefaultAddress = defaultAddress?.id === addressId;
  const fieldId = String(addressId).replace(/[^a-zA-Z0-9_-]/g, '-');

  return (
    <Form className="account-form" id={fieldId}>
      <fieldset>
        <legend className="visually-hidden">Address</legend>
        <input type="hidden" name="addressId" defaultValue={addressId} />
        <div className="account-form__fields">
          <Field id={`${fieldId}-firstName`} label="First name*" name="firstName" autoComplete="given-name" defaultValue={address?.firstName} required />
          <Field id={`${fieldId}-lastName`} label="Last name*" name="lastName" autoComplete="family-name" defaultValue={address?.lastName} required />
          <Field id={`${fieldId}-company`} label="Company" name="company" autoComplete="organization" defaultValue={address?.company} className="account-form__field--full" />
          <Field id={`${fieldId}-address1`} label="Address line*" name="address1" autoComplete="address-line1" defaultValue={address?.address1} required className="account-form__field--full" />
          <Field id={`${fieldId}-address2`} label="Address line 2" name="address2" autoComplete="address-line2" defaultValue={address?.address2} className="account-form__field--full" />
          <Field id={`${fieldId}-city`} label="City*" name="city" autoComplete="address-level2" defaultValue={address?.city} required />
          <Field id={`${fieldId}-zoneCode`} label="State / Province*" name="zoneCode" autoComplete="address-level1" defaultValue={address?.zoneCode} required />
          <Field id={`${fieldId}-zip`} label="Zip / Postal code*" name="zip" autoComplete="postal-code" defaultValue={address?.zip} required />
          <Field id={`${fieldId}-territoryCode`} label="Country code*" name="territoryCode" autoComplete="country" defaultValue={address?.territoryCode} required maxLength={2} />
          <Field
            id={`${fieldId}-phoneNumber`}
            label="Phone"
            name="phoneNumber"
            type="tel"
            autoComplete="tel"
            defaultValue={address?.phoneNumber}
            placeholder="+16135551111"
            pattern="^\+?[1-9]\d{3,14}$"
            className="account-form__field--full"
          />
          <div className="account-form__check account-form__field--full">
            <input
              defaultChecked={isDefaultAddress}
              id={`${fieldId}-defaultAddress`}
              name="defaultAddress"
              type="checkbox"
            />
            <label htmlFor={`${fieldId}-defaultAddress`}>Set as default address</label>
          </div>
        </div>
        {error ? (
          <p>
            <mark>
              <small>{error}</small>
            </mark>
          </p>
        ) : null}
        {children({
          stateForMethod: (method) => (formMethod === method ? state : 'idle'),
        })}
      </fieldset>
    </Form>
  );
}

/**
 * @param {{
 *   id: string;
 *   label: string;
 *   name: string;
 *   defaultValue?: string | null;
 *   autoComplete?: string;
 *   required?: boolean;
 *   type?: string;
 *   placeholder?: string;
 *   pattern?: string;
 *   maxLength?: number;
 *   className?: string;
 * }}
 */
function Field({
  id,
  label,
  name,
  defaultValue,
  autoComplete,
  required,
  type = 'text',
  placeholder,
  pattern,
  maxLength,
  className,
}) {
  return (
    <div className={`account-form__field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        aria-label={label}
        autoComplete={autoComplete}
        defaultValue={defaultValue ?? ''}
        id={id}
        name={name}
        placeholder={placeholder ?? label.replace(/\*$/, '')}
        required={required}
        type={type}
        pattern={pattern}
        maxLength={maxLength}
      />
    </div>
  );
}

/**
 * @typedef {{
 *   addressId?: string | null;
 *   createdAddress?: AddressFragment;
 *   defaultAddress?: string | null;
 *   deletedAddress?: string | null;
 *   error: Record<AddressFragment['id'], string> | null;
 *   updatedAddress?: AddressFragment;
 * }} ActionResponse
 */

/** @typedef {import('@shopify/hydrogen/customer-account-api-types').CustomerAddressInput} CustomerAddressInput */
/** @typedef {import('customer-accountapi.generated').AddressFragment} AddressFragment */
/** @typedef {import('customer-accountapi.generated').CustomerFragment} CustomerFragment */
/** @template T @typedef {import('react-router').Fetcher<T>} Fetcher */
/** @typedef {import('./+types/account.addresses').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
/** @typedef {ReturnType<typeof useActionData<typeof action>>} ActionReturnData */
