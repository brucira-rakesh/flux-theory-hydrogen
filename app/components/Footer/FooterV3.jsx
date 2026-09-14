import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useRouteLoaderData } from 'react-router-dom';
import FluxWordmark from '../Brand/FluxWordmark';
import { footerNavV3 } from '../../data/footerLinks';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { footerLinksFromMenu } from '../../lib/navMenu';
import paymentsImg from '../../assets/footer/payments.svg';
import './FooterV3.css';

// One-line swap: flip to `false` to drop back to the static
// `.ftv3__surface` background image (see FooterV3.css) with zero WebGL
// cost. Desktop-only regardless — see the `isDesktop` gate below, same
// convention SceneV2 uses for its own WebGL layer.
const USE_WEBGL_SURFACE = true;

function FooterLink({ href, className, children }) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * FooterV3 — the wet-glass footer from Figma node 2810-2767, used by
 * HomeV3Page.
 *
 * A separate component rather than a variant of Footer.jsx: that one is a
 * stone relief with a WebGL scene behind it (FooterScene) and a two-by-two
 * nav flanking an embossed logo. This is a flat five-column band on a dark
 * rain-beaded surface, with the wordmark occupying the middle column — no
 * shared markup worth parameterising, and no WebGL context to pay for.
 *
 * The frame's "embrace" block and the photo above it are deliberately not
 * implemented here (out of scope for this component) — this is the footer
 * band only, so it drops onto any dark page section.
 */
export default function FooterV3({ className = '' }) {
  const [shopAll, knowMore, support, getInTouch] = footerNavV3;
  const rootData = useRouteLoaderData('root');
  const footerMenus = rootData?.footerMenus;

  // Each column pulls from its own Shopify menu by handle (see
  // FOOTER_MENU_HANDLES in root.jsx) and falls back to the static column
  // above when that menu hasn't been created in Admin yet.
  const withMenu = (column, menu) => ({
    ...column,
    links: footerLinksFromMenu(menu) ?? column.links,
  });
  const leftNav = [
    withMenu(shopAll, footerMenus?.shopAll),
    withMenu(knowMore, footerMenus?.knowMore),
  ];
  const rightNav = [
    withMenu(support, footerMenus?.support),
    withMenu(getInTouch, footerMenus?.getInTouch),
  ];
  const isDesktop = useIsDesktop();
  const showWebglSurface = USE_WEBGL_SURFACE && isDesktop;
  const footerRef = useRef(null);

  // Dynamic import (not a static one) so `@react-three/fiber`/`three-stdlib`
  // never enter the SSR module graph for the many non-homepage routes that
  // render this footer statically — only the browser ever needs this chunk.
  const [FooterWaterGlass, setFooterWaterGlass] = useState(null);
  useEffect(() => {
    if (!showWebglSurface || FooterWaterGlass) return;
    let cancelled = false;
    import('./FooterWaterGlass').then((mod) => {
      if (!cancelled) setFooterWaterGlass(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [showWebglSurface, FooterWaterGlass]);

  return (
    <footer ref={footerRef} className={clsx('ftv3', className)} aria-label="Site footer">
      {/* The rain-beaded glass plate from the frame. Its own element rather
          than a background on .ftv3 so the darkening scrim can ride on the
          same layer (::after) and stay under the nav's stacking context.
          On desktop this can be the live WebGL condensation shader instead
          (see USE_WEBGL_SURFACE) — same box, same background image, just
          wipeable. Mobile always gets the static version: no WebGL context
          worth paying for at that viewport, same call SceneV2 makes.

          Pointer tracking is bound to the whole `<footer>` (via
          `pointerTargetRef`), not just this surface div: `.ftv3__inner`'s
          nav sits above it in paint order, so the browser hit-tests pointer
          events to the nav over most of the footer's area — this div would
          only ever see moves in the empty margins around it. pointermove
          bubbles, so a listener on the ancestor footer still fires no
          matter which descendant was actually hit. */}
      {showWebglSurface && FooterWaterGlass ? (
        <FooterWaterGlass
          className="ftv3__surface ftv3__surface--webgl"
          pointerTargetRef={footerRef}
        />
      ) : (
        <div className="ftv3__surface" aria-hidden="true" />
      )}

      <div className="ftv3__inner">
        <div className="ftv3__grid">
          {leftNav.map((column) => (
            <nav key={column.id} className="ftv3__col" aria-label={column.title}>
              <h2 className="ftv3__title" data-title={column.title}>
                {column.title}
              </h2>
              <ul className="ftv3__list">
                {column.links.map((link) => (
                  <li key={`${column.id}-${link.label}`}>
                    <FooterLink href={link.href} className="ftv3__link">
                      {link.label}
                    </FooterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="ftv3__brand">
            <FluxWordmark className="ftv3__wordmark" />
          </div>

          {rightNav.map((column) => (
            <nav key={column.id} className="ftv3__col" aria-label={column.title}>
              <h2 className="ftv3__title" data-title={column.title}>
                {column.title}
              </h2>
              <ul className="ftv3__list">
                {column.links.map((link) => (
                  <li key={`${column.id}-${link.label}`}>
                    <FooterLink href={link.href} className="ftv3__link">
                      {link.label}
                    </FooterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="ftv3__bottom">
          <p className="ftv3__copyright">© 2026 Flux Theory. All Rights Reserved.</p>

          <div className="ftv3__pay">
            <span>Pay Using:</span>
            <img src={paymentsImg} alt="Payment methods" height="22" width="auto" loading="lazy" />
          </div>
        </div>
      </div>
    </footer>
  );
}
