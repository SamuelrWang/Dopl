/**
 * EVERY value the Overview page renders. Hardcoded on purpose — this pass is
 * look + structure only, so wiring the real reads later is a change to THIS
 * file plus the hooks above it, and never to the six presentational modules.
 */

export interface StatCard {
  label: string;
  /** Zero-padded on purpose: the reference clone reads "03", not "3". */
  value: string;
  note: string;
  /** Picks the tile glyph in `stat-cards.tsx` — the icon set stays in the view. */
  icon: "messages" | "agents" | "members" | "channels";
}

export const HEADER = {
  eyebrow: "Good evening",
  title: "Samuel, here is the workspace",
  subline: "Today at a glance, and how the last 30 days have gone.",
} as const;

export const STAT_CARDS: StatCard[] = [
  { label: "Messages today", value: "10", note: "Across all channels", icon: "messages" },
  { label: "Agents online", value: "03", note: "Connected over MCP", icon: "agents" },
  { label: "Members", value: "13", note: "On the register", icon: "members" },
  { label: "Channels", value: "07", note: "Across the workspace", icon: "channels" },
];

export interface PeriodStat {
  label: string;
  value: string;
  note: string;
  /** Absent = no delta pill. Only ever a decline in this clone. */
  delta?: string;
  icon: "credits" | "sessions" | "balance";
}

export const PERIOD_LABEL = "Last 30 days";

export const PERIOD_STATS: PeriodStat[] = [
  {
    label: "Credits used",
    value: "12,480",
    delta: "-5%",
    note: "641 tool calls metered",
    icon: "credits",
  },
  {
    label: "Sessions",
    value: "735",
    delta: "-2%",
    note: "Agent sessions completed",
    icon: "sessions",
  },
  {
    label: "Credits left",
    value: "37,520",
    note: "Across the whole workspace, not just this period",
    icon: "balance",
  },
];

/**
 * 31 daily message counts, one per bar. `CHART_MAX` is the axis ceiling rather
 * than `Math.max(...)` so the gridline labels stay round numbers.
 */
export const CHART_TITLE = "Messages per day";
export const CHART_NOTE = "12,480 in the period";
export const CHART_MAX = 3000;
export const CHART_GRIDLINES = [3000, 2000, 1500, 1000, 500, 0];

export const CHART_BARS: number[] = [
  620, 880, 540, 1240, 960, 1480, 720, 1120, 1650, 2840, 1380, 900, 1520, 1180,
  640, 1740, 1060, 820, 1360, 2050, 1440, 760, 1180, 1620, 980, 1300, 700, 1560,
  1140, 860, 1420,
];

/** The one inked bar — the period's peak, called out the way the reference does. */
export const CHART_HIGHLIGHT_INDEX = 9;

/** x-axis tick under every bar: day of month over month number. */
export const CHART_LABELS: string[] = CHART_BARS.map(
  (_, index) => `${index + 1}/7`
);

export type ChipTone = "info" | "neutral" | "caution";

export interface UpcomingRow {
  name: string;
  time: string;
  owner: string;
  status: string;
  tone: ChipTone;
}

export const UPCOMING_LABEL = "Still to come today";

export const UPCOMING_ROWS: UpcomingRow[] = [
  {
    name: "Seun Adeyinka",
    time: "10:50",
    owner: "Research agent",
    status: "Running",
    tone: "info",
  },
  {
    name: "Quarterly rollup",
    time: "13:15",
    owner: "Reporting agent",
    status: "Scheduled",
    tone: "neutral",
  },
  {
    name: "Dara Whitfield",
    time: "15:30",
    owner: "Support agent",
    status: "Scheduled",
    tone: "neutral",
  },
  {
    name: "Index rebuild",
    time: "17:45",
    owner: "Knowledge agent",
    status: "Needs approval",
    tone: "caution",
  },
];

export interface MemberLoadRow {
  name: string;
  /** Share of the period's sessions, 0–100. Drives the bar width AND the label. */
  percent: number;
}

export const MEMBER_LOAD_LABEL = "Member load, last 30 days";
export const MEMBER_LOAD_FOOTNOTE =
  "Share of 735 sessions (denominator shown, as everywhere)";

export const MEMBER_LOAD_ROWS: MemberLoadRow[] = [
  { name: "Samuel Wang", percent: 82 },
  { name: "Dara Whitfield", percent: 64 },
  { name: "Seun Adeyinka", percent: 33 },
  { name: "Mira Kowalski", percent: 21 },
  { name: "Tomas Beaulieu", percent: 49 },
  { name: "Ada Fenwick", percent: 77 },
];
