import {useEffect, useState} from 'react';

/**
 * Shared `/` and `/home` mount. Both routes re-export this so HomeV2Page
 * stays a single dynamic-import specifier (one Vite chunk).
 */
export const meta = () => {
  return [{title: 'Flux Theory'}];
};

export default function HomeV2Route() {
  const [Page, setPage] = useState(null);

  useEffect(() => {
    import('~/pages/HomeV2Page').then((mod) => {
      setPage(() => mod.HomeV2Page ?? mod.default);
    });
  }, []);

  if (!Page) return null;
  return <Page />;
}
