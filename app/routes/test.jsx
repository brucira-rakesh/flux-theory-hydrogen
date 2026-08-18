import {useEffect, useState} from 'react';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

export default function TestRoute() {
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/pages/Test').then((mod) => {
      setPage(() => mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page />;
}

/** @typedef {import('./+types/test').Route} Route */
