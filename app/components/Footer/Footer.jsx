import { useId, useState } from "react";
import { Link } from "react-router-dom";
import FooterScene from "./FooterScene";
import { footerNav } from "../../data/footerLinks";
import "./Footer.css";
import clsx from "clsx";

function FooterLink({ href, className, children }) {
  if (href.startsWith("/")) {
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

function IconChevron({ open }) {
  return (
    <svg
      className={`ft-nav__chevron${open ? " is-open" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 5.25L7 8.75L10.5 5.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FooterNavColumn({ column, openId, onToggle, panelIdPrefix }) {
  const isOpen = openId === column.id;
  const panelId = `${panelIdPrefix}-${column.id}`;

  return (
    <nav
      className={`ft-nav${isOpen ? " is-open" : ""}`}
      aria-label={column.title}
    >
      <button
        type="button"
        className="ft-nav__title"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => onToggle(column.id)}
      >
        <span>{column.title}</span>
        <IconChevron open={isOpen} />
      </button>
      {/* ft-nav__panel is the grid container for the height transition */}
      <div id={panelId} className="ft-nav__panel" role="region" aria-label={column.title}>
        <div className="ft-nav__panel-inner">
          <ul className="ft-nav__list">
            {column.links.map((link, linkIndex) => (
              <li key={`${column.id}-${linkIndex}`}>
                <FooterLink href={link.href} className="ft-nav__link">
                  {link.label}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}

export default function Footer({ className = "" }) {
  const panelIdPrefix = useId();
  // All columns start closed on mobile; desktop ignores this state entirely.
  const [openId, setOpenId] = useState(null);

  const onToggle = (id) => {
    setOpenId((current) => (current === id ? null : id));
  };

  return (
    <footer className={clsx("ft-root", className)} aria-label="Site footer">
      <div className="ft-scene" aria-hidden="true">
        <FooterScene />
      </div>

      <div className="ft-content">
        <div className="ft-nav-grid">
          <div className="ft-nav-col ft-nav-col--left">
            {footerNav.slice(0, 2).map((column) => (
              <FooterNavColumn
                key={column.id}
                column={column}
                openId={openId}
                onToggle={onToggle}
                panelIdPrefix={panelIdPrefix}
              />
            ))}
          </div>

          <div className="ft-logo-spacer" aria-hidden="true" />

          <div className="ft-nav-col ft-nav-col--right">
            {footerNav.slice(2).map((column) => (
              <FooterNavColumn
                key={column.id}
                column={column}
                openId={openId}
                onToggle={onToggle}
                panelIdPrefix={panelIdPrefix}
              />
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
