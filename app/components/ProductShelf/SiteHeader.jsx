import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useRouteLoaderData } from 'react-router-dom'
import { LoggedInState } from '../Header/LoggedInState'
import { HeaderSearch } from '../Header/HeaderSearch'
import logoUrl from '../../assets/brand/header/logo-artwork.svg'
import iconSearchUrl from '../../assets/brand/header/icon-search.svg'
import iconUserUrl from '../../assets/brand/header/icon-user.svg'
import iconBagUrl from '../../assets/brand/header/icon-bag.svg'
import { useSmoothScrollLock } from '../SmoothScroll/SmoothScroll'
import { FACE_FILTER_ENABLED } from '../../data/shop'
import { isExternalUrl } from '../../data/site'
import { useCartDrawer } from '../Cart/CartProvider'
import { useNavLinks, resolveActiveId } from '../../lib/navMenu'
import './ProductShelf.css'

/** Fallback links used when the Shopify menu hasn't been configured yet. */
const FALLBACK_NAV_LINKS = [
  { id: 'shop', label: 'Shop All', to: '/shop' },
  { id: 'body', label: 'Body', to: '/shop/body' },
  ...(FACE_FILTER_ENABLED ? [{ id: 'face', label: 'Face', to: '/shop/face' }] : []),
  { id: 'brand', label: 'The Brand', to: '/the-brand' },
]

function IconMenu() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 12H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 17H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function HeaderIcon({ src, label, width, height, onClick, to, loggedIn }) {
  const className = `ps-header__icon-btn${loggedIn ? ' is-logged-in' : ''}`
  const inner = (
    <span className="ps-header__icon" style={{ width, height }}>
      <img src={src} alt="" width={width} height={height} />
    </span>
  )

  if (to) {
    return (
      <Link to={to} className={className} aria-label={label}>
        {inner}
      </Link>
    )
  }

  return (
    <button type="button" className={className} aria-label={label} onClick={onClick}>
      {inner}
    </button>
  )
}

function isLightSurfacePath(pathname) {
  return (
    pathname.startsWith('/shop') ||
    pathname.startsWith('/old-pdp') ||
    pathname.startsWith('/account') ||
    pathname === '/about-us' ||
    pathname === '/the-brand' ||
    pathname === '/thank-you'
  )
}

function isDarkHeroPath(pathname) {
  return pathname === '/about-us' || pathname === '/the-brand'
}

function isFluxPdpPath(pathname) {
  return pathname.startsWith('/products')
}

export default function SiteHeader({ logoTo = '/', overlayHero = false }) {
  const rootData = useRouteLoaderData('root')
  const navLinks = useNavLinks(rootData, FALLBACK_NAV_LINKS)
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hidden, setHidden] = useState(false)
  /** Past the top — full-bleed glass bar (sticky reveal). At top — homepage floating chrome. */
  const [pinned, setPinned] = useState(false)
  const drawerId = useId()
  const closeBtnRef = useRef(null)
  const menuBtnRef = useRef(null)
  const lastScrollY = useRef(0)
  const activeId = resolveActiveId(location.pathname, location.hash, navLinks)
  const onLight = isLightSurfacePath(location.pathname) && !overlayHero
  const onDarkHero = isDarkHeroPath(location.pathname)
  const onFluxPdp = isFluxPdpPath(location.pathname)
  const onPdp = onFluxPdp || location.pathname.startsWith('/old-pdp')
  const { openCart } = useCartDrawer()
  const logoIsExternal = isExternalUrl(logoTo)

  useSmoothScrollLock('site-header-menu', open)

  useEffect(() => {
    if (!open) return undefined

    const menuBtn = menuBtnRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtnRef.current?.focus()
    setHidden(false)

    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      menuBtn?.focus()
    }
  }, [open])

  // Publish header height so shop Filters/Sort can stick flush under it (no gap).
  useEffect(() => {
    const header = document.querySelector('.ps-header')
    if (!header) return undefined

    const syncOffset = () => {
      if (hidden && !open && !searching) {
        document.documentElement.style.setProperty('--ps-header-offset', '0px')
        return
      }
      const height = Math.ceil(header.getBoundingClientRect().height)
      document.documentElement.style.setProperty(
        '--ps-header-offset',
        `${Math.max(height, 0)}px`,
      )
    }

    syncOffset()
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(syncOffset)
        : null
    ro?.observe(header)
    window.addEventListener('resize', syncOffset)

    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', syncOffset)
      document.documentElement.style.removeProperty('--ps-header-offset')
    }
  }, [hidden, open, searching, pinned])

  // Let sticky shop toolbar sit flush to the top while the header is tucked away,
  // and drop under the header when it returns (avoids header covering Filters/Sort).
  useEffect(() => {
    const root = document.documentElement
    const tucked = hidden && !open && !searching
    if (tucked) root.dataset.headerHidden = 'true'
    else delete root.dataset.headerHidden
    if (pinned && !tucked) root.dataset.headerPinned = 'true'
    else delete root.dataset.headerPinned
    return () => {
      delete root.dataset.headerHidden
      delete root.dataset.headerPinned
    }
  }, [hidden, open, searching, pinned])

  // Dawn-style sticky header: hide on scroll down, reveal on scroll up.
  // Flux PDP keeps the bar fully off-screen once past the top (no scroll-up
  // reveal) so it never peeks over the buy box / mid-page content.
  // Stay put through the IntroHero pin scrub — that scroll distance is
  // programmatic (video → mist cover), not a page leave.
  useEffect(() => {
    lastScrollY.current = window.scrollY || 0
    let ticking = false

    const introOwnsScroll = (y) => {
      if (document.documentElement.dataset.preloading === 'true') return true
      const intro = document.querySelector('.intro-hero')
      if (!intro) return false
      const top = intro.offsetTop
      const bottom = top + intro.offsetHeight
      return y < bottom - 8
    }

    const update = () => {
      ticking = false
      const y = window.scrollY || 0

      if (open || searching || introOwnsScroll(y)) {
        setHidden(false)
        setPinned(introOwnsScroll(y) ? false : y >= 72)
        lastScrollY.current = y
        return
      }

      const delta = y - lastScrollY.current
      const nearTop = y < 72
      setPinned(!nearTop)

      if (nearTop) {
        setHidden(false)
      } else if (delta > 6) {
        setHidden(true)
      } else if (delta < -6 && !onFluxPdp) {
        setHidden(false)
      }

      lastScrollY.current = y
    }

    update()
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [open, searching, onFluxPdp])

  const closeDrawer = () => setOpen(false)

  return (
    <>
      <header
        className={`ps-header${pinned ? ' is-pinned' : ''}${onLight ? ' is-on-light' : ''}${onDarkHero ? ' is-on-dark-hero' : ''}${onPdp ? ' is-on-pdp' : ''}${onFluxPdp ? ' is-on-flux-pdp' : ''}${hidden && !open && !searching ? ' is-hidden' : ''}${open ? ' is-drawer-open' : ''}`}
      >
        <div className="ps-header__bar">
          {logoIsExternal ? (
            <a href={logoTo} className="ps-logo" aria-label="Flux Theory home">
              <img src={logoUrl} alt="" width={45} height={44} className="ps-logo__img" />
            </a>
          ) : (
            <Link to={logoTo} className="ps-logo" aria-label="Flux Theory home">
              <img src={logoUrl} alt="" width={45} height={44} className="ps-logo__img" />
            </Link>
          )}

          <div className="ps-header__cluster">
            <nav className="ps-header__nav" aria-label="Primary">
              {navLinks.map((link) => {
                const isActive = link.id === activeId
                const className = `ps-header__nav-link${isActive ? ' is-active' : ''}`
                const inner = (
                  <>
                    {isActive && (
                      <span className="ps-header__nav-marker" aria-hidden="true" />
                    )}
                    <span>{link.label}</span>
                  </>
                )
                if (link.to) {
                  return (
                    <Link key={link.id} to={link.to} className={className}>
                      {inner}
                    </Link>
                  )
                }
                return (
                  <a key={link.id} href={link.href} className={className}>
                    {inner}
                  </a>
                )
              })}
            </nav>

            <div className="ps-header__actions">
              <HeaderSearch
                toggleClassName="ps-header__icon-btn"
                toggle={
                  <span className="ps-header__icon" style={{ width: 13, height: 12 }}>
                    <img src={iconSearchUrl} alt="" width={13} height={12} />
                  </span>
                }
                onOpenChange={(next) => {
                  setSearching(next)
                  if (next) setOpen(false)
                }}
              />
              <LoggedInState>
                {(isLoggedIn) => (
                  <HeaderIcon
                    src={iconUserUrl}
                    label={isLoggedIn ? 'Account' : 'Sign in'}
                    width={13}
                    height={12}
                    to={isLoggedIn ? '/account' : '/account/login'}
                    loggedIn={isLoggedIn}
                  />
                )}
              </LoggedInState>
              <HeaderIcon
                src={iconBagUrl}
                label="Shopping bag"
                width={14}
                height={12}
                onClick={openCart}
              />

              <button
                ref={menuBtnRef}
                type="button"
                className="ps-header__icon-btn ps-header__menu-btn"
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
                aria-controls={drawerId}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <IconClose /> : <IconMenu />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/*
        Drawer MUST stay outside `.ps-header`. The header uses `transform` for
        hide-on-scroll, which makes `position:fixed` descendants resolve against
        the header box instead of the viewport.
      */}
      <div className={`ps-drawer-layer${open ? ' is-open' : ''}`}>
        <div
          className="ps-drawer-backdrop"
          hidden={!open}
          onClick={closeDrawer}
          aria-hidden="true"
        />

        <nav
          id={drawerId}
          className="ps-drawer"
          aria-label="Site menu"
          aria-hidden={!open}
        >
          <div className="ps-drawer__top">
            {logoIsExternal ? (
              <a
                href={logoTo}
                className="ps-drawer__logo"
                aria-label="Flux Theory home"
                tabIndex={open ? 0 : -1}
                onClick={closeDrawer}
              >
                <img src={logoUrl} alt="" width={45} height={44} className="ps-logo__img" />
              </a>
            ) : (
              <Link
                to={logoTo}
                className="ps-drawer__logo"
                aria-label="Flux Theory home"
                tabIndex={open ? 0 : -1}
                onClick={closeDrawer}
              >
                <img src={logoUrl} alt="" width={45} height={44} className="ps-logo__img" />
              </Link>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              className="ps-header__icon-btn ps-drawer__close"
              aria-label="Close menu"
              tabIndex={open ? 0 : -1}
              onClick={closeDrawer}
            >
              <IconClose />
            </button>
          </div>

          <ul className="ps-drawer__links">
            {navLinks.map((link) => (
              <li key={link.id}>
                {link.to ? (
                  <Link to={link.to} tabIndex={open ? 0 : -1} onClick={closeDrawer}>
                    {link.label}
                  </Link>
                ) : (
                  <a href={link.href} tabIndex={open ? 0 : -1} onClick={closeDrawer}>
                    {link.label}
                  </a>
                )}
              </li>
            ))}
            <li>
              <LoggedInState>
                {(isLoggedIn) => (
                  <Link
                    to={isLoggedIn ? '/account' : '/account/login'}
                    tabIndex={open ? 0 : -1}
                    onClick={closeDrawer}
                  >
                    {isLoggedIn ? 'Account' : 'Sign in'}
                  </Link>
                )}
              </LoggedInState>
            </li>
          </ul>
        </nav>
      </div>
    </>
  )
}
