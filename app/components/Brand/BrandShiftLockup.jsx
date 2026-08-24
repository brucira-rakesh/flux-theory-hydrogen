/**
 * "FLUX THEORY" wordmark with the brand Shift divide —
 * horizontal channel between upper/lower letter halves, matching the
 * mid-band cut in `app/assets/brand/header/logo-artwork.svg` (the FT mark).
 * Pure CSS clip treatment; no separate Shift component existed to import.
 */
export default function BrandShiftLockup({className = ''}) {
  return (
    <div
      className={`brand-shift-lockup ${className}`.trim()}
      aria-label="Flux Theory"
    >
      <span className="brand-shift-lockup__stack" aria-hidden="true">
        <span className="brand-shift-lockup__half brand-shift-lockup__half--top">
          FLUX THEORY
        </span>
        <span className="brand-shift-lockup__gap" />
        <span className="brand-shift-lockup__half brand-shift-lockup__half--bottom">
          FLUX THEORY
        </span>
      </span>
    </div>
  );
}
