import { useEffect, useId, useRef, useState } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '../../hooks/useSpotlight'
import './CustomSelect.css'

/**
 * Accessible custom select — trigger + unordered list menu.
 * @param {{ id: string, label: string }[]} options
 */
export default function CustomSelect({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  className = '',
  menuClassName = '',
  align = 'left',
}) {
  const listId = useId()
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const selected = options.find((opt) => opt.id === value) ?? options[0]

  useEffect(() => {
    if (!open) return undefined

    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu || !open) return undefined

    if (prefersReducedMotion()) {
      gsap.set(menu, { opacity: 1, y: 0, scale: 1 })
      return undefined
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        menu,
        { opacity: 0, y: -6, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'power3.out' },
      )
    })
    return () => ctx.revert()
  }, [open])

  const choose = (id) => {
    onChange?.(id)
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className={`custom-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
    >
      {label ? <span className="custom-select__label">{label}</span> : null}
      <button
        type="button"
        className="custom-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel || label || 'Select option'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="custom-select__value">{selected?.label ?? ''}</span>
        <span className="custom-select__chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={menuRef}
          id={listId}
          className={`custom-select__menu custom-select__menu--${align}${menuClassName ? ` ${menuClassName}` : ''}`}
          role="listbox"
          aria-label={ariaLabel || label || 'Options'}
        >
          {options.map((opt) => {
            const isActive = opt.id === selected?.id
            return (
              <li key={opt.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`custom-select__option${isActive ? ' is-selected' : ''}`}
                  onClick={() => choose(opt.id)}
                >
                  <span className="custom-select__check" aria-hidden="true">
                    {isActive ? '✓' : ''}
                  </span>
                  <span>{opt.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
