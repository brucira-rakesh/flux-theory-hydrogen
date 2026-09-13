import { useEffect, useState } from 'react';
import { DESKTOP_MEDIA_QUERY, isDesktopViewport } from '../utils/breakpoint';

/**
 * Live `lg`-breakpoint match (see utils/breakpoint.js for the shared
 * definition) — for gating a component's own render on viewport size when a
 * `lg:hidden` class can't do it, e.g. skipping a WebGL layer entirely rather
 * than mounting its GL context and hiding the canvas with CSS.
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
