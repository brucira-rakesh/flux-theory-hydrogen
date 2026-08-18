export function Logo({ className }) {
  return (
    <svg
      viewBox="0 0 45 44"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M21.964 25.8847V27.2379H16.7651V37.3885H12.0669V26.176C12.0669 24.1655 11.3789 23.0474 10.028 23.0474H9.51143V10.9016H19.8897V15.5143H14.2097V22.7562H19.924C21.2749 22.7562 21.9629 23.8743 21.9629 25.8847H21.964ZM21.7571 15.5143H25.7811V23.0462H26.2977C27.6486 23.0462 28.3366 24.1643 28.3366 26.1748V37.3873H33.0349V25.8824C33.0349 23.8731 32.3469 22.755 30.996 22.755H30.4794V15.5131H34.5434V10.9004H21.7571V15.5131V15.5143ZM42.5 25.8836V44H5.05543V26.176C5.05543 24.1655 4.36743 23.0474 3.01657 23.0474H2.5V4H39.9446V22.7562H40.4611C41.812 22.7562 42.5 23.8743 42.5 25.8847V25.8836ZM39.2223 26.176C39.2223 24.1655 38.5343 23.0474 37.1834 23.0474H36.6669V7.29932H5.77771V22.7562H6.29429C7.64514 22.7562 8.33314 23.8743 8.33314 25.8847V40.7007H39.2223V26.176Z"
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
