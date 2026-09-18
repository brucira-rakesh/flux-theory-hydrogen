import {useEffect, useState} from 'react';
import {useLoaderData} from 'react-router';
import {fetchAllShopProducts, fetchCollectionMainBanner} from '~/lib/storefrontCatalog';

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
  const [catalog, banner] = await Promise.all([
    fetchAllShopProducts(context.storefront),
    fetchCollectionMainBanner(context.storefront),
  ]);
  return {catalog, banner};
}

export default function ShopIndex() {
  /** @type {LoaderReturnData} */
  const {catalog, banner = null} = useLoaderData();
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
      <Page catalog={catalog} banner={banner} />
    </SmoothScroll>
  );
}

/** @typedef {import('./+types/shop._index').Route} Route */
/** @typedef {ReturnType<typeof useLoaderData<typeof loader>>} LoaderReturnData */
