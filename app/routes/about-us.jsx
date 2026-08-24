import {useEffect, useState} from 'react';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory | About Us'}];
};

export default function AboutUsRoute() {
  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    Promise.all([
      import('~/pages/AboutPage'),
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

/** @typedef {import('./+types/about-us').Route} Route */
