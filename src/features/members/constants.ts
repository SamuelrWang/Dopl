/** Preset team colors. Rendered as alpha tints so they read on both the dark
 *  default theme and the light AppPanel scope. */
export const TEAM_COLORS = [
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#38bdf8", // sky
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#fb923c", // orange
] as const;

export const DEFAULT_TEAM_COLOR = TEAM_COLORS[0];
