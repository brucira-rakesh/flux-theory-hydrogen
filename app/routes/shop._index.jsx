import {useEffect, useState} from 'react';
import {useLoaderData} from 'react-router';
import {fetchAllShopProducts} from '~/lib/storefrontCatalog';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

/**
 * @param {Route.LoaderArgs} args
 */
export async function loader({context}) {
  const catalog = await fetchAllShopProducts(context.storefront);
  return {catalog};
}

export default function ShopIndex() {
  /** @type {LoaderReturnData} */
  const {catalog} = useLoaderData();
  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    Promise.all([
      import('~/pages/ShopPage'),
      import('~/components/SmoothScroll/SmoothScroll'),
    ]).then(([pageMod, scrollMod]) => {
      setBundle({
        Page: pageMod.default,
        SmoothScroll: scrollMod.default,
      });
    });
  }, []);

  if (!bundle) return null;
  const {Page, SmoothScroll} = bundle;
  return (
    <SmoothScroll>
      <Page catalog={catalog} />
    </SmoothScroll>
  );
}

/** @typedef {import('./+types/shop._index').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
