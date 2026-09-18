import type { Appearance } from "@stripe/stripe-js";

/**
 * Stripe Appearance config for the native custom checkout (ui_mode:
 * "elements"). Maps the Dopl design system onto the Payment Element.
 *
 * Hardcoded hex is correct here and the "no raw hex" rule does not apply: the
 * Payment Element renders in a cross-origin Stripe iframe and cannot read this
 * page's CSS custom properties. Each literal mirrors a token — keep in sync
 * with globals.css:
 *
 *   #232a31                  → --text-primary
 *   #646d78                  → --text-secondary
 *   #98a2ad                  → --text-muted
 *   #d40924                  → --danger (sRGB of oklch(0.55 0.22 25))
 *   #fbfcfd                  → --bg-elevated
 *   #eef1f5                  → --bg-inset
 *   #e9eaec                  → .concave-field fill
 *   rgba(0,0,0,0.06)         → .concave-field border
 *   rgba(0,0,0,0.08)         → --border-default
 *   rgba(24,24,24,0.22)      → .concave-field focus border-color
 *   "Helvetica Neue"…        → --font-app
 *   12.5px                   → text-body base size
 *   11px                     → text-label size
 * The inset box-shadow stacks below are copied verbatim from the
 * `.concave-field` / `.concave-field:focus-within` recipe in globals.css.
 */

// .concave-field resting recipe (globals.css)
const CONCAVE_SHADOW =
  "inset 0 2px 4px rgba(0, 0, 0, 0.13), inset 0 1px 2px rgba(0, 0, 0, 0.07), inset 0 -1px 0 rgba(255, 255, 255, 0.9), 0 1px 0 rgba(255, 255, 255, 0.8)";

// .concave-field:focus-within recipe (globals.css)
const CONCAVE_FOCUS_SHADOW =
  "inset 0 2px 5px rgba(0, 0, 0, 0.17), inset 0 1px 2px rgba(0, 0, 0, 0.09), inset 0 -1px 0 rgba(255, 255, 255, 0.9), 0 0 0 3px rgba(24, 24, 24, 0.07)";

// Kit `.raised-tab` uses a white→#f2f2f2 gradient, but the Appearance API only
// accepts a solid backgroundColor (gradients and the `background` shorthand are
// unsupported and warn) — hence solid #ffffff + hairline + raised shadow.
const RAISED_TAB_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(0, 0, 0, 0.06)";

// Soft double drop for bento blocks (approx `.bento` elevation).
const BENTO_SHADOW =
  "0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.03)";

export const checkoutAppearance: Appearance = {
  // Resting labels above each field (styled 11px uppercase via `.Label` rule).
  labels: "above",
  variables: {
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSizeBase: "12.5px",
    borderRadius: "8px",
    colorPrimary: "#232a31",
    colorBackground: "#fbfcfd",
    colorText: "#232a31",
    colorTextSecondary: "#646d78",
    colorTextPlaceholder: "#98a2ad",
    colorDanger: "#d40924",
  },
  rules: {
    // Pressed-in concave input well — mirrors `.concave-field`.
    ".Input": {
      backgroundColor: "#e9eaec",
      border: "1px solid rgba(0, 0, 0, 0.06)",
      boxShadow: CONCAVE_SHADOW,
      color: "#232a31",
    },
    ".Input:focus": {
      border: "1px solid rgba(24, 24, 24, 0.22)",
      boxShadow: CONCAVE_FOCUS_SHADOW,
    },
    ".Input--invalid": {
      border: "1px solid #d40924",
      color: "#232a31",
    },
    ".Input::placeholder": {
      color: "#98a2ad",
    },
    // 11px uppercase section label (text-label recipe).
    ".Label": {
      fontSize: "11px",
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "#646d78",
    },
    // Recessed resting tab; selected = raised white face.
    ".Tab": {
      backgroundColor: "#eef1f5",
      border: "1px solid rgba(0, 0, 0, 0.06)",
      color: "#646d78",
    },
    ".Tab:hover": {
      color: "#232a31",
    },
    ".Tab--selected": {
      backgroundColor: "#ffffff",
      border: "1px solid rgba(0, 0, 0, 0.10)",
      boxShadow: RAISED_TAB_SHADOW,
      color: "#232a31",
    },
    // Caption-sized danger error text (text-caption ≈ 11.5px).
    ".Error": {
      fontSize: "11.5px",
      color: "#d40924",
    },
    // Bento-like block: elevated surface + hairline + soft double shadow.
    ".Block": {
      backgroundColor: "#fbfcfd",
      border: "1px solid rgba(0, 0, 0, 0.08)",
      boxShadow: BENTO_SHADOW,
    },
  },
};
