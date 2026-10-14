/**
 * THE SCRIPTED POINTER — one artwork for every animated demo that shows a hand
 * at work: the landing hero's /home scene (`banner-demo/banner-demo.tsx`) and
 * /get-started's install drawing (`get-started/components/install-animation.tsx`).
 * Samuel, 2026-10-14: the install drawing's cursor must match the landing demo's.
 *
 * Geometry is `hero-banner.tsx`'s pointer — 13x19 at the same `d`, turned 45deg
 * about the TIP (the scene cursor was once the same path at 17x25, unrotated, and
 * visibly changed shape mid-motion when it took over from the hero's) — plus the
 * white keyline the scene cursor wears (it rides dark surfaces where a `#0b0b0c`
 * fill alone disappears). `hero-banner.tsx` keeps its own keyline-free copy on
 * purpose: it rides a daylight photograph.
 *
 * ⚠ The TIP sits at the element origin (0.75, 0.9 — sub-pixel), so a mover's
 * translate IS the tip position, and the rotation pivots there so the point
 * lands on what it presses.
 *
 * ⚠ THE SHADOW TRAVELS WITH THE GLYPH. It sits on this wrapper, not the rotated
 * svg (a filter on the rotated element would be rotated with it), and not in a
 * page stylesheet — /get-started never loads `marketing.css`.
 */
export function DemoCursorGlyph() {
  return (
    <span style={{ display: "block", filter: "drop-shadow(0 2px 5px rgba(0, 0, 0, 0.35))" }}>
      <svg
        viewBox="0 0 13 19"
        width="13"
        height="19"
        fill="none"
        aria-hidden="true"
        style={{ display: "block", transform: "rotate(45deg)", transformOrigin: "0.75px 0.9px" }}
      >
        <path
          d="M0.75 0.9 L0.75 15.2 L4.3 11.9 L6.4 16.8 L8.3 15.9 L6.3 11.1 L10.6 10.8 Z"
          fill="#0b0b0c"
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
