import {useEffect, useState} from 'react';
import {useLoaderData} from 'react-router';
import {fetchHomeProductCards} from './storefrontCatalog';

/**
 * Shared `/` and `/home` mount. Both routes re-export this so HomeV3Page
 * stays a single dynamic-import specifier (one Vite chunk).
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

/**
 * @param {Route.LoaderArgs} args
 */
export async function loader({context}) {
  const productCards = await fetchHomeProductCards(context.storefront);
  return {productCards};
}

export default function HomeRoute() {
  const {productCards} = useLoaderData();
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/pages/HomeV3Page').then((mod) => {
      setPage(() => mod.HomeV3Page ?? mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page productCards={productCards} />;
}
