import {Await, useRouteLoaderData} from 'react-router';

/**
 * Resolves root-loader `isLoggedIn` whether it is a boolean or a deferred Promise.
 * @param {{
 *   children: (isLoggedIn: boolean) => import('react').ReactNode;
 * }} props
 */
export function LoggedInState({children}) {
  const root = useRouteLoaderData('root');
  const value = root?.isLoggedIn;

  if (typeof value === 'boolean') {
    return children(value);
  }

  if (!value) {
    return children(false);
  }

  return (
    <Await resolve={value} errorElement={children(false)}>
      {(isLoggedIn) => children(Boolean(isLoggedIn))}
    </Await>
  );
}
