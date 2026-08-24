import {useEffect, useState} from 'react';

/**
 * Flat branded route (same convention as `/about-us`), not `/pages/*`.
 * Shopify CMS pages stay on `pages.$handle`; this is a hardcoded brand story.
 *
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | The Brand'}];
};

export default function TheBrandRoute() {
  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    Promise.all([
      import('~/pages/BrandPage'),
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
      <Page />
    </SmoothScroll>
  );
}

/** @typedef {import('./+types/the-brand').Route} Route */
