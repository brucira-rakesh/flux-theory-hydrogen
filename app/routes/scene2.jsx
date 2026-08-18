import {useEffect, useState} from 'react';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

export default function Scene2Route() {
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/Scene.v2').then((mod) => {
      setPage(() => mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page />;
}

/** @typedef {import('./+types/scene2').Route} Route */
