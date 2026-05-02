export const TABS = [
  { id: "mcp", label: "MCP" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "skills", label: "Skills" },
  { id: "teams", label: "Teams" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Page bg — charcoal. Clearly lighter than the panel (0.11) so the
 *  panel reads as a darker, framed surface elevated against the page. */
export const PAGE_BG = "oklch(0.16 0 0)";

/** Per-tab dwell time. The progress bar fills over this duration; when
 *  it reaches 100% the tab auto-advances to the next one. */
export const TAB_DURATION_MS = 8000;

/** Knowledge anim — total ~7.8s at 120ms × 65. */
export const KB_TICK_MS = 120;
export const KB_TICK_TOTAL = 65;

/** MCP anim — total ~7.7s at 120ms × 64. The terminal window flies in
 *  at tick 4, cycles begin at tick 8, four cycles of 14 ticks each. */
export const MCP_TICK_MS = 120;
export const MCP_TICK_TOTAL = 64;
export const MCP_FLY_IN_TICK = 4;
export const MCP_CYCLE_START_TICK = 8;
export const MCP_CYCLE_LENGTH = 14;
export const MCP_TYPE_CHARS_PER_TICK = 6;

export const MCP_CLIENT_CYCLES = [
  {
    name: "Claude Code",
    badge: "CC",
    cmd: "claude mcp add dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Connected. 12 tools registered.",
  },
  {
    name: "Codex CLI",
    badge: "CX",
    cmd: "codex mcp register dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Registered. Run codex login dopl to authenticate.",
  },
  {
    name: "Claude Desktop",
    badge: "CD",
    cmd: "claude_desktop add dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Server added. Restart Claude Desktop to use.",
  },
  {
    name: "Cursor",
    badge: "CR",
    cmd: "cursor mcp connect dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Connected. Reload Cursor to refresh tools.",
  },
] as const;

export const KB_ENTRIES: { title: string; active?: boolean }[] = [
  { title: "Mistakes Samuel pushes back on" },
  { title: "Personal context — building blocks", active: true },
  { title: "Playbook — Catch-up with existing contact" },
  { title: "Playbook — Cold or warm intro" },
  { title: "Playbook — Listing to contract conversion" },
  { title: "Playbook — Reply to delayed sender" },
  { title: "README — How to use this KB" },
  { title: "Subject lines" },
  { title: "Voice and style rules" },
  { title: "Workflow when drafting an email" },
];

/** Tick gates for the Knowledge animation. Edit these numbers to retime. */
export const KB_GATE = {
  entriesStart: 13,
  entrySelected: 24,
  title: 26,
  toolbar: 28,
  h2: 30,
  intro: 32,
  h3Position: 44,
  positionBullet1: 45,
  positionBullet2: 46,
  positionBullet3: 47,
  positionBullet4: 48,
  h3Tooling: 50,
  toolingBullet: 51,
  quote: 53,
  h3Recent: 55,
  recentBullet1: 56,
  recentBullet2: 57,
  recentBullet3: 58,
  h3Tracked: 60,
  trackedIntro: 61,
  table: 63,
};

export interface SkillEntry {
  name: string;
  desc: string;
  invocations: number;
  connectors: string[];
  expanded?: boolean;
  whenUse?: string;
  whenNot?: string;
  connectorBadges?: { name: string; connected: boolean }[];
}

export const SKILLS: SkillEntry[] = [
  {
    name: "Cold outreach email writer",
    desc: "Composes personalized outbound emails from a target&apos;s LinkedIn + company signals. Writes in the user&apos;s voice.",
    invocations: 1342,
    connectors: ["linkedin", "gmail"],
    expanded: true,
    whenUse:
      "When you need a first-touch sales email tailored to a specific prospect, with research baked in.",
    whenNot:
      "When the recipient has already replied — switch to the reply-handler skill instead.",
    connectorBadges: [
      { name: "LinkedIn", connected: true },
      { name: "Gmail", connected: true },
      { name: "Slack", connected: false },
    ],
  },
  {
    name: "Polymarket trading bot",
    desc: "Auto-buys 'No' on standalone yes/no markets with positive expected value, holds to resolution.",
    invocations: 87,
    connectors: ["polymarket"],
  },
  {
    name: "Code review assistant",
    desc: "Reviews diffs for security, type safety, and adherence to repo conventions. Posts inline comments.",
    invocations: 524,
    connectors: ["github"],
  },
  {
    name: "GitHub repo analyzer",
    desc: "Crawls a repo, extracts setup instructions, and surfaces hidden configuration knobs.",
    invocations: 211,
    connectors: ["github"],
  },
  {
    name: "Linear ticket triager",
    desc: "Reads new Linear tickets, assigns severity + owner based on past triage decisions.",
    invocations: 96,
    connectors: ["linear"],
  },
];
