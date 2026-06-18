/**
 * Landing page copy + decorative data.
 *
 * The landing visual system is the ported "Flow" design (see marketing.css,
 * scoped under `.flow-landing`). Copy here is re-themed to the Dopl product;
 * decorative arrays (waveform, app tiles, ribbon/curve flavor text) drive the
 * background motifs. Colors live in marketing.css `:root`-equivalent block.
 */

/** Pill-nav links. `caret` shows the dropdown chevron (decorative). */
export const NAV_LINKS = [
  { label: "Product", caret: true },
  { label: "For teams", caret: true },
  { label: "Business", caret: false },
  { label: "Resources", caret: true },
  { label: "Company", caret: true },
] as const;

/** Hero copy. */
export const HERO = {
  /** Two-tone headline, one tone per line. */
  headlineGray: "Humans have offices",
  headlineInk: "your agents should too",
  subLine1: "The agent workspace that turns context",
  subLine2: "into skills your whole team shares for good.",
  cta: "Get started free",
  avail: "Works in Claude Code, Cursor, Codex, and more",
  loadedPill: "Knowledge loaded",
} as const;

/** Showcase (dark) section copy. */
export const SHOWCASE = {
  heading: "Move faster across every agent and client.",
  sub: "Seamless skills and knowledge across every agent you run, on any device.",
  cta: "Watch in action",
} as const;

/** Social-proof (green) section copy. */
export const SOCIAL = {
  heading: "Used by teams everywhere to speed up their delivery",
} as const;

/**
 * Decorative dictation-style flavor text bent along the hero SVG curves.
 * Re-themed to "scattered team context" — length-matched to the originals so
 * the textPath fills the same arc length.
 */
export const CURVE_TEXT =
  "and honestly the whole setup's been kind of scattered, nobody really knows which skill does what so can you sync it up and check";

export const RIBBON_TEXT =
  "week's off to a strong start. I synced the new runbook earlier, and the";

/** Waveform bar heights (px) for the hero mic pill. */
export const WAVEFORM_HEIGHTS = [
  14, 26, 40, 58, 30, 46, 70, 52, 34, 60, 80, 56, 30, 48, 66, 40, 22, 52, 72,
  44, 28, 38, 56, 30, 18, 42, 60, 36, 20, 30, 46, 26, 16,
] as const;

export interface AppTile {
  /** CSS background (solid or gradient). */
  bg: string;
  /** Foreground/text color. */
  fg?: string;
  /** Glyph rendered in the tile. */
  glyph: string;
  /** Position as vw (x) / % (y), rotation (deg), scale. */
  x: number;
  y: number;
  r: number;
  s: number;
}

/** Colorful rounded app tiles streaming down the dark section. Decorative. */
export const APP_TILES: AppTile[] = [
  { bg: "#fff", fg: "#000", glyph: "N", x: 44, y: 50, r: -8, s: 1 },
  { bg: "linear-gradient(135deg,#7c4dff,#448aff)", glyph: "✦", x: 40, y: 56, r: 6, s: 0.92 },
  { bg: "#3a7bf6", glyph: "✉", x: 36, y: 62, r: -12, s: 1 },
  { bg: "linear-gradient(135deg,#feda75,#d62976,#4f5bd5)", glyph: "◎", x: 32, y: 68, r: 8, s: 0.86 },
  { bg: "#0d0d0d", fg: "#fff", glyph: "❋", x: 28, y: 72, r: -6, s: 1 },
  { bg: "#2dbe60", fg: "#fff", glyph: "🐘", x: 24, y: 77, r: 10, s: 0.9 },
  { bg: "#fff", fg: "#ea4335", glyph: "M", x: 20, y: 81, r: -10, s: 1 },
  { bg: "#34da50", fg: "#fff", glyph: "💬", x: 16, y: 84, r: 6, s: 0.84 },
  { bg: "#161614", fg: "#fff", glyph: "⌥", x: 12, y: 87, r: -8, s: 1 },
  { bg: "#fff", fg: "#4285f4", glyph: "📄", x: 8, y: 90, r: 9, s: 0.9 },
  { bg: "#0a0a0a", fg: "#fff", glyph: "◆", x: 4.5, y: 92, r: -6, s: 1 },
  { bg: "#2aabee", fg: "#fff", glyph: "➤", x: 1, y: 94, r: 7, s: 0.88 },
];

export interface PhoneBubble {
  side: "in" | "out";
  dim?: boolean;
  text: string;
}

/** Phone-mock chat — an agent answering from the team's shared knowledge. */
export const PHONE_BUBBLES: PhoneBubble[] = [
  { side: "out", dim: true, text: "Sure — I'll pull the latest from the runbook." },
  { side: "in", text: "Thanks, I know the docs are dense!" },
  { side: "out", text: "Haha, you keep me sharp 💀" },
  { side: "in", text: "Anytime." },
];

export const PHONE_NAME = "Jordan";
export const PHONE_PLACEHOLDER = "Message...";
