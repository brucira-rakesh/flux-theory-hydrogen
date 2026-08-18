import {useEffect, useState} from 'react';

/**
 * Renders children only after client mount so SSR never evaluates
 * window/document/WebGL/Lenis/ScrollTrigger trees.
 * Default fallback is nothing — matching flux-theory pages that
 * show no chrome until GSAP/Lenis/Three initialize.
 * @param {{children: React.ReactNode | (() => React.ReactNode), fallback?: React.ReactNode}} props
 */
export function ClientOnly({children, fallback = null}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return fallback;

  return typeof children === 'function' ? children() : children;
}
