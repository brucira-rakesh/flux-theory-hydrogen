import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { IconBag, IconClose, IconMenu, IconSearch, IconUser, Logo } from './icons'
import { FACE_FILTER_ENABLED } from '../../data/shop'
import { LoggedInState } from './LoggedInState'
import { HeaderSearch } from './HeaderSearch'

const NAV_LINKS = [
  { id: 'shop', label: 'Shop All', to: '/shop' },
  { id: 'body', label: 'Body', to: '/shop/body' },
  // FACE_FILTER: re-enable when Clarity/Pulse/Ember/Muse exist in Shopify admin.
  ...(FACE_FILTER_ENABLED ? [{ id: 'face', label: 'Face', to: '/shop/face' }] : []),
  { id: 'brand', label: 'The Brand', href: '#brand' },
  { id: 'about', label: 'About Us', href: '#about' },
]

const ICON_BTN =
  'grid size-6 place-items-center appearance-none border-0 bg-transparent p-0 text-inherit ' +
  'cursor-pointer transition-opacity duration-200 hover:opacity-75 focus-visible:opacity-75'

function resolveActiveId(pathname, hash) {
  if (pathname.startsWith('/shop/body')) return 'body'
  if (pathname.startsWith('/shop/face')) return 'face'
  if (pathname === '/shop') return 'shop'
  const id = (hash || '').replace(/^#/, '')
  if (id && NAV_LINKS.some((link) => link.id === id)) return id
  return null
}

/**
 * Header V2 — floating logo + glass/solid nav cluster with headroom
 * hide-on-scroll-down / reveal-on-scroll-up behavior.
 *
 * `mode` is set by the page (based on what the header sits over), never by
 * scroll position — there is intentionally no scroll-triggered background
 * fill/pin variant here.
 *   - "light": glass panel (translucent white blur), white logo/text — for
 *     use over dark/hero imagery.
 *   - "dark": solid white panel, black logo/text — for use over light pages.
 *
 * `visible` gates a slide + fade entrance, off by default only when the
 * caller passes `false` — e.g. HomeV2Page ties it to the intro sequence's
 * `handoff` cue so the header arrives in step with the hero's own reveal
 * instead of sitting on screen before the intro has played.
 */
export default function HeaderV2({ logoTo = '/', mode = 'light', visible = true }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hidden, setHidden] = useState(false)
  const drawerId = useId()
  const closeBtnRef = useRef(null)
  const menuBtnRef = useRef(null)
  const lastScrollY = useRef(0)
  const activeId = resolveActiveId(location.pathname, location.hash)
  const isGlass = mode === 'light'

  useEffect(() => {
    if (!open) return undefined

    const menuBtn = menuBtnRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtnRef.current?.focus()

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

  // Headroom: hide on scroll down, reveal on scroll up or near the top.
  useEffect(() => {
    lastScrollY.current = window.scrollY || 0
    let ticking = false

    const update = () => {
      ticking = false
      const y = window.scrollY || 0

      if (open || searching) {
        setHidden(false)
        lastScrollY.current = y
        return
      }

      const delta = y - lastScrollY.current
      const nearTop = y < 72

      if (nearTop) setHidden(false)
      else if (delta > 6) setHidden(true)
      else if (delta < -6) setHidden(false)

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
  }, [open, searching])

  const closeDrawer = () => setOpen(false)

  // Entrance (intro reveal) and headroom (scroll) both tuck the header the
  // same way — translate off-screen + fade out — so they share one class set.
  const tucked = !visible || (hidden && !open && !searching)

  return (
    <>
      <header
        className={`fixed inset-x-3 top-3 z-50 transition-[translate,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:inset-x-6 sm:top-6 ${
          tucked
            ? '-translate-y-[calc(100%+24px)] opacity-0 pointer-events-none'
            : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <Link
            to={logoTo}
            aria-label="Flux Theory home"
            className={`grid shrink-0 place-items-center leading-none no-underline transition-colors duration-300 ${
              isGlass ? 'text-white' : 'text-black'
            }`}
          >
            <Logo className="h-[35px] w-9 sm:h-11 sm:w-[45px]" />
          </Link>

          <div
            className={`flex items-center justify-end gap-6 px-4 py-2.5 transition-colors duration-300 sm:gap-10 sm:px-6 sm:py-4 ${
              isGlass
                ? 'bg-white/[0.13] text-white backdrop-blur-[12.85px]'
                : 'border-b border-black/[0.06] bg-white text-black'
            }`}
          >
            <nav
              aria-label="Primary"
              className={`hidden items-center overflow-hidden whitespace-nowrap transition-[opacity,max-width,gap] duration-300 min-[961px]:flex ${
                searching
                  ? 'pointer-events-none max-w-0 gap-0 opacity-0'
                  : 'max-w-[40rem] gap-8 opacity-100'
              }`}
            >
              {NAV_LINKS.map((link) => {
                const isActive = link.id === activeId
                const linkClassName = `inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-normal uppercase text-inherit no-underline transition-opacity duration-200 [font-family:var(--font-body)] ${
                  isActive ? 'opacity-100' : 'opacity-60 hover:opacity-100 focus-visible:opacity-100'
                }`
                const inner = (
                  <>
                    {isActive && (
                      <span className="block size-1.5 shrink-0 border border-current" aria-hidden="true" />
                    )}
                    <span>{link.label}</span>
                  </>
                )
                return link.to ? (
                  <Link key={link.id} to={link.to} className={linkClassName}>
                    {inner}
                  </Link>
                ) : (
                  <a key={link.id} href={link.href} className={linkClassName}>
                    {inner}
                  </a>
                )
              })}
            </nav>

            <div className="flex items-center gap-4 sm:gap-6">
              <HeaderSearch
                toggleClassName={ICON_BTN}
                toggle={<IconSearch className="h-3 w-[13px]" />}
                onOpenChange={(next) => {
                  setSearching(next)
                  if (next) setOpen(false)
                }}
              />
              <LoggedInState>
                {(isLoggedIn) => (
                  <Link
                    to="/account"
                    aria-label={isLoggedIn ? 'Account' : 'Sign in'}
                    className={`${ICON_BTN} relative no-underline text-inherit${
                      isLoggedIn
                        ? " after:absolute after:right-0 after:top-0 after:size-1.5 after:bg-current after:content-['']"
                        : ''
                    }`}
                  >
                    <IconUser className="h-3 w-[13px]" />
                  </Link>
                )}
              </LoggedInState>
              <button type="button" aria-label="Shopping bag" className={ICON_BTN}>
                <IconBag className="h-3 w-3.5" />
              </button>

              <button
                ref={menuBtnRef}
                type="button"
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
                aria-controls={drawerId}
                onClick={() => setOpen((v) => !v)}
                className={`${ICON_BTN} min-[961px]:hidden`}
              >
                {open ? <IconClose className="size-6" /> : <IconMenu className="size-6" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/*
        Drawer stays outside the header's own transform context (same reason
        as SiteHeader): fixed descendants of a translated ancestor resolve
        against that ancestor's box, not the viewport.
      */}
      <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}>
        <div
          onClick={closeDrawer}
          aria-hidden="true"
          className={`absolute inset-0 cursor-pointer bg-[#1a1c12]/45 backdrop-blur-md transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <nav
          id={drawerId}
          aria-label="Site menu"
          aria-hidden={!open}
          className={`absolute left-0 top-0 flex h-full w-full max-w-[360px] flex-col gap-10 bg-[#2c2e1c] px-6 pb-8 pt-5 text-white transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex min-h-11 items-center justify-end">
            <button
              ref={closeBtnRef}
              type="button"
              aria-label="Close menu"
              tabIndex={open ? 0 : -1}
              onClick={closeDrawer}
              className={ICON_BTN}
            >
              <IconClose className="size-6" />
            </button>
          </div>

          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {NAV_LINKS.map((link) => {
              const linkClassName =
                'flex items-center justify-between border-b border-white/10 py-3.5 text-2xl font-semibold uppercase ' +
                'tracking-wide text-white no-underline transition-opacity duration-200 [font-family:var(--font-title)] hover:opacity-70 sm:text-3xl'
              return (
                <li key={link.id}>
                  {link.to ? (
                    <Link to={link.to} tabIndex={open ? 0 : -1} onClick={closeDrawer} className={linkClassName}>
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} tabIndex={open ? 0 : -1} onClick={closeDrawer} className={linkClassName}>
                      {link.label}
                    </a>
                  )}
                </li>
              )
            })}
            <li>
              <LoggedInState>
                {(isLoggedIn) => (
                  <Link
                    to="/account"
                    tabIndex={open ? 0 : -1}
                    onClick={closeDrawer}
                    className={
                      'flex items-center justify-between border-b border-white/10 py-3.5 text-2xl font-semibold uppercase ' +
                      'tracking-wide text-white no-underline transition-opacity duration-200 [font-family:var(--font-title)] hover:opacity-70 sm:text-3xl'
                    }
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
