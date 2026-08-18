import {useEffect, useState} from 'react';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

export default function SeawaveRoute() {
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/Seawave').then((mod) => {
      setPage(() => mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page />;
}

/** @typedef {import('./+types/seawave').Route} Route */
