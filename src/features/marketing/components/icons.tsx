/** Inline line-icons for the landing page. All inherit `currentColor`. */

export function ArrowUpRight({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

/** Speaker with two arcs — the ambient-audio toggle's ON face. */
export function SpeakerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

/** Same cone, arcs replaced by a cross — the toggle's OFF face. */
export function SpeakerMutedIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="m16 10 5 4" />
      <path d="m21 10-5 4" />
    </svg>
  );
}

/** Two offset strokes — matches the reference's "Menu" glyph. */
export function MenuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="9" width="16" height="2" rx="1" fill="currentColor" />
      <rect x="8" y="14" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
