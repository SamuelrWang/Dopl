/**
 * Design tokens — TypeScript constants mirroring the CSS variables in globals.css.
 * Use these in component code when you need to reference colors/sizes from JS
 * (e.g. dynamic styles, canvas, framer-motion). For static styling, prefer
 * Tailwind utilities or CSS variables directly.
 */

export const colors = {
  bg: {
    base: "var(--bg-base)",
    elevated: "var(--bg-elevated)",
    elevatedHover: "var(--bg-elevated-hover)",
    inset: "var(--bg-inset)",
    insetHover: "var(--bg-inset-hover)",
    overlay: "var(--bg-overlay)",
  },
  border: {
    subtle: "var(--border-subtle)",
    default: "var(--border-default)",
    strong: "var(--border-strong)",
    highlight: "var(--border-highlight)",
  },
  text: {
    primary: "var(--text-primary)",
    secondary: "var(--text-secondary)",
    muted: "var(--text-muted)",
    disabled: "var(--text-disabled)",
  },
  accent: {
    primary: "var(--accent-primary)",
    glow: "var(--accent-glow)",
    soft: "var(--accent-soft)",
  },
  status: {
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
  },
  // openclaw-cloud palette (exact values)
  openclaw: {
    paper: "var(--paper)",       // #0d0d12
    forest: "var(--forest)",     // #e0e0e0
    grid: "var(--grid-line)",    // #a0a0a0
    coral: "var(--coral)",       // #FF8C69
    mint: "var(--mint)",         // #9EFFBF
    gold: "var(--gold)",         // #F4D35E
    bodyBg: "var(--body-bg)",    // #0a0a0f
  },
} as const;

/**
 * Hex values for the openclaw-cloud accent palette.
 * Use these directly in inline styles where CSS variables don't work
 * (e.g. SVG fill, canvas, framer-motion animate props).
 */
export const openclawHex = {
  paper: "#0d0d12",
  forest: "#e0e0e0",
  grid: "#a0a0a0",
  coral: "#FF8C69",
  mint: "#9EFFBF",
  gold: "#F4D35E",
  bodyBg: "#0a0a0f",
} as const;

export const gradients = {
  elevated: "var(--gradient-elevated)",
  orb: "var(--gradient-orb)",
} as const;

export const shadows = {
  elevated: "var(--shadow-elevated)",
  floating: "var(--shadow-floating)",
  glowAccent: "var(--glow-accent)",
  glowAccentStrong: "var(--glow-accent-strong)",
  insetHighlight: "var(--inset-highlight)",
  insetHighlightStrong: "var(--inset-highlight-strong)",
} as const;

export const radii = {
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
  "2xl": "var(--radius-2xl)",
  "3xl": "var(--radius-3xl)",
  "4xl": "var(--radius-4xl)",
  pill: "var(--radius-pill)",
} as const;

/** Raw OKLCH values — for cases where you need the actual color (e.g. canvas) */
export const colorValues = {
  bg: {
    base: "oklch(0.08 0.002 260)",
    elevated: "oklch(0.14 0.003 260)",
    inset: "oklch(0.11 0.002 260)",
  },
  accent: {
    primary: "oklch(0.78 0.16 240)",
    glow: "oklch(0.68 0.22 250)",
  },
  text: {
    primary: "oklch(0.96 0 0)",
    secondary: "oklch(0.78 0 0)",
    muted: "oklch(0.58 0 0)",
  },
} as const;
