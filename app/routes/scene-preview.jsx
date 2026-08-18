import {useEffect, useState} from 'react';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

export default function ScenePreviewRoute() {
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/pages/ScenePreviewPage').then((mod) => {
      setPage(() => mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page />;
}

/** @typedef {import('./+types/scene-preview').Route} Route */
