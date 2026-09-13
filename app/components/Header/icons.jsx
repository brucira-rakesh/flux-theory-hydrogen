export function Logo({ className }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M19.464 21.8847V23.2379H14.2651V33.3885H9.56686V22.176C9.56686 20.1655 8.87886 19.0474 7.528 19.0474H7.01143V6.90155H17.3897V11.5143H11.7097V18.7562H17.424C18.7749 18.7562 19.4629 19.8743 19.4629 21.8847H19.464ZM19.2571 11.5143H23.2811V19.0462H23.7977C25.1486 19.0462 25.8366 20.1643 25.8366 22.1748V33.3873H30.5349V21.8824C30.5349 19.8731 29.8469 18.755 28.496 18.755H27.9794V11.5131H32.0434V6.90038H19.2571V11.5131V11.5143ZM40 21.8836V40H2.55543V22.176C2.55543 20.1655 1.86743 19.0474 0.516571 19.0474H0V0H37.4446V18.7562H37.9611C39.312 18.7562 40 19.8743 40 21.8847V21.8836ZM36.7223 22.176C36.7223 20.1655 36.0343 19.0474 34.6834 19.0474H34.1669V3.29932H3.27771V18.7562H3.79429C5.14514 18.7562 5.83314 19.8743 5.83314 21.8847V36.7007H36.7223V22.176Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function IconSearch({ className }) {
  return (
    <svg viewBox="0 0 13 12" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.04533 1.16992H5.66561C3.27871 1.16992 1.34375 3.10488 1.34375 5.49177C1.34375 7.87866 3.27871 9.81362 5.66561 9.81362H6.04533C8.43222 9.81362 10.3672 7.87866 10.3672 5.49177C10.3672 3.10488 8.43222 1.16992 6.04533 1.16992Z"
        stroke="currentColor"
      />
      <line x1="9.10355" y1="8.78512" x2="11.5245" y2="11.206" stroke="currentColor" />
    </svg>
  )
}

export function IconUser({ className }) {
  return (
    <svg viewBox="0 0 13 12" fill="none" className={className} aria-hidden="true">
      <path d="M11.6562 7.36896H0.65625V11.0002H11.6562V7.36896Z" stroke="currentColor" />
      <path
        d="M6.14326 0.999817H5.92978C4.58785 0.999817 3.5 2.08766 3.5 3.42959C3.5 4.77152 4.58785 5.85937 5.92978 5.85937H6.14326C7.48519 5.85937 8.57304 4.77152 8.57304 3.42959C8.57304 2.08766 7.48519 0.999817 6.14326 0.999817Z"
        stroke="currentColor"
      />
    </svg>
  )
}

export function IconBag({ className }) {
  return (
    <svg viewBox="0 0 14 12" fill="none" className={className} aria-hidden="true">
      <path d="M12.6562 4H0.65625V11H12.6562V4Z" stroke="currentColor" />
      <path
        d="M5.15625 3.5C5.15625 4.05228 4.70853 4.5 4.15625 4.5C3.60397 4.5 3.15625 4.05228 3.15625 3.5H5.15625ZM10.1562 3.5C10.1562 4.05228 9.70853 4.5 9.15625 4.5C8.60397 4.5 8.15625 4.05228 8.15625 3.5H10.1562ZM3.15625 3.5C3.15625 1.46932 4.56028 -0.5 6.65625 -0.5V1.5C5.99079 1.5 5.15625 2.21697 5.15625 3.5H3.15625ZM6.65625 -0.5C8.75222 -0.5 10.1562 1.46932 10.1562 3.5H8.15625C8.15625 2.21697 7.32171 1.5 6.65625 1.5V-0.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function IconMenu({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 12H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 17H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconClose({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
