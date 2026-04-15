/** Design tokens matching the Dopl openclaw-cloud dark theme */
export const tokens = {
  // Surfaces
  bgBase: "oklch(0.15 0 0)",
  bgElevated: "oklch(0.18 0 0)",
  bgElevatedHover: "oklch(0.21 0 0)",
  bgInset: "oklch(0.13 0 0)",
  bgOverlay: "oklch(0.14 0 0)",

  // Borders
  borderSubtle: "oklch(1 0 0 / 6%)",
  borderDefault: "oklch(1 0 0 / 10%)",
  borderStrong: "oklch(1 0 0 / 16%)",

  // Text
  textPrimary: "oklch(0.96 0 0)",
  textSecondary: "oklch(0.78 0 0)",
  textMuted: "oklch(0.58 0 0)",

  // Accent
  accentPrimary: "oklch(0.78 0.16 240)",
  accentGlow: "oklch(0.68 0.22 250)",
  accentSoft: "oklch(0.45 0.12 245)",

  // Status
  success: "oklch(0.72 0.16 155)",
  warning: "oklch(0.82 0.15 80)",
  danger: "oklch(0.65 0.22 25)",

  // Named hex palette
  paper: "#1a1a1a",
  coral: "#FF8C69",
  mint: "#9EFFBF",
  gold: "#F4D35E",
} as const;
