/**
 * STAGING DATA for `/overview` — every value here is made up. THE ONE DATA FILE.
 *
 * The desktop Overview reads three API paths and one hook; the staging stubs
 * (`./stubs/*`) answer each of them out of this file and nothing else. No
 * Supabase, no fetch, no Electron IPC.
 *
 *   GET /api/home/overview            → `HOME_OVERVIEW`
 *   GET /api/home/overview-series     → `overviewSeries(scope, month)`
 *   GET /api/home/token-spend         → `tokenSpendReport()`
 *   GET /api/billing/status (credits) → `creditState(plan)`
 *   usage scopes                      → `HOME_CHANNELS`
 *
 * The Devices section's types and `DEVICES_MOCK` live only here; there is no product twin yet.
 */
import type {
  HomeOverview,
  HomeOverviewSeries,
  HomeSeriesPoint,
} from "@/features/home/overview-types";
import { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP } from "@/features/home/overview-types";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";

/* ────────────────────────────── home channels ────────────────────────────── */

/** The subset of `Channel` the usage scope menu reads (`id`, `name`). */
export interface StagingChannel {
  id: string;
  /** The channel's container, which the rails key by (`HomeChannelUsage.workspaceId`). */
  workspaceId: string;
  name: string;
}

export const HOME_CHANNELS: readonly StagingChannel[] = [
  { id: "ch-tech-debt", workspaceId: "demo-ws-q4", name: "tech-debt" },
  { id: "ch-deploys", workspaceId: "demo-ws-weekly", name: "deploys" },
  { id: "ch-flaky-tests", workspaceId: "demo-ws-flakes", name: "flaky-tests" },
  { id: "ch-api-v2", workspaceId: "demo-ws-apiv2", name: "api-v2-migration" },
  { id: "ch-design-review", workspaceId: "demo-ws-design", name: "design-review" },
];

/* ─────────────────────────────── the overview ─────────────────────────────── */

/**
 * Channel names match the landing demo's channel column (`banner-demo/demo-home-rows.ts`) and the
 * people match `ui-staging/staging-stubs.ts › STAGING_PEOPLE`, so the staged faces agree. The
 * last channel row has no name and the last person no profile, to show the rails' fallbacks
 * ("Untitled channel", "Unknown member"); one tool row has no op.
 */
export const HOME_OVERVIEW: HomeOverview = {
  range: "month",
  since: "2026-10-01T00:00:00.000Z",
  channels: [
    { workspaceId: "demo-ws-q4", name: "tech-debt", credits: 1412, messages: 2210 },
    { workspaceId: "demo-ws-flakes", name: "flaky-tests", credits: 486, messages: 3920 },
    { workspaceId: "demo-ws-apiv2", name: "api-v2-migration", credits: 318, messages: 611 },
    { workspaceId: "demo-ws-weekly", name: "deploys", credits: 174, messages: 1204 },
    { workspaceId: "demo-ws-design", name: "design-review", credits: 92, messages: 455 },
    { workspaceId: "demo-ws-untitled", name: "", credits: 31, messages: 74 },
  ],
  people: [
    { userId: "demo-u-daniel", name: "Daniel Ortiz", role: "owner", credits: 1880 },
    { userId: "demo-u-grace", name: "Grace Kim", role: "member", credits: 341 },
    { userId: "demo-u-anthony", name: "Anthony Reyes", role: "member", credits: 162 },
    { userId: "demo-u-mira", name: "Mira Castellanos", role: "guest", credits: 88 },
    { userId: "demo-u-unknown", name: "", role: "guest", credits: 42 },
  ],
  tools: [
    { tool: "dopl", op: "send_message", calls: 1284 },
    { tool: "dopl", op: "read_channel", calls: 966 },
    { tool: "dopl", op: "read_entry", calls: 512 },
    { tool: "dopl", op: "write_entry", calls: 233 },
    { tool: "glasses", op: "show", calls: 141 },
    { tool: "github", op: "", calls: 57 },
  ],
  scanned: 5000,
  truncated: true,
};

/** The Overview with nothing in it — the "Empty account" staging state. */
export const HOME_OVERVIEW_EMPTY: HomeOverview = {
  ...HOME_OVERVIEW,
  channels: [],
  people: [],
  tools: [],
  scanned: 0,
  truncated: false,
};

/* ───────────────────────────── the usage series ───────────────────────────── */

/** Mulberry32 — a deterministic PRNG, so SSR and the client draw the same bars. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** How big each scope's daily bars run, relative to All channels. */
const SCOPE_WEIGHT: Record<string, number> = {
  [USAGE_SCOPE_ALL]: 1,
  [USAGE_SCOPE_DESKTOP]: 0.12,
  "ch-tech-debt": 0.56,
  "ch-flaky-tests": 0.19,
  "ch-api-v2": 0.13,
  "ch-deploys": 0.07,
  "ch-design-review": 0.04,
};

/**
 * The histogram for one scope and one `YYYY-MM` month. Zero-filled for the whole month like the
 * server; the current month carries spend only through today.
 */
export function overviewSeries(scope: string, month: string, empty = false): HomeOverviewSeries {
  const [year = 2026, mon = 1] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const now = new Date();
  const isCurrent = year === now.getUTCFullYear() && mon === now.getUTCMonth() + 1;
  const lastDay = isCurrent ? now.getUTCDate() : daysInMonth;
  const rand = seeded(hash(`${scope}|${month}`));
  const weight = SCOPE_WEIGHT[scope] ?? 0.05;
  const points: HomeSeriesPoint[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const at = `${month}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
    const weekday = new Date(Date.UTC(year, mon - 1, day)).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const quiet = rand() < 0.12;
    const base = 40 + rand() * 150;
    const count =
      empty || day > lastDay || quiet ? 0 : Math.round(base * weight * weekend);
    points.push({ at, count });
  }
  return { range: "month", metric: "credits", bucket: "day", points, truncated: false };
}

/* ──────────────────────────────── token spend ──────────────────────────────── */

/** One entry per run, newest first. Mirrors the server report shape. */
export interface TokenSpendReport {
  marks: Array<{ at: string; tokens: number }>;
  truncated: boolean;
}

/** ~60 agent runs over the last 31 local days, newest first. */
export function tokenSpendReport(empty = false): TokenSpendReport {
  if (empty) return { marks: [], truncated: false };
  const rand = seeded(1326);
  const now = new Date();
  const marks: TokenSpendReport["marks"] = [];
  for (let back = 0; back < 31; back += 1) {
    const runs = Math.floor(rand() * 4);
    for (let r = 0; r < runs; r += 1) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 9 + r * 3, 15);
      marks.push({ at: at.toISOString(), tokens: Math.round((20 + rand() * 900) * 10) * 1000 });
    }
  }
  return { marks, truncated: false };
}

/* ─────────────────────────────── credit wallet ─────────────────────────────── */

export type StagingPlan = "free" | "pro" | "exhausted";

function periodEnd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
function periodStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** `/api/billing/status › credits` for each staging plan. `isPaid` drives the upgrade button. */
export function creditState(plan: StagingPlan): {
  credits: WorkspaceCreditsStatus;
  isPaid: boolean;
} {
  const base = {
    wallet: "personal" as const,
    periodStart: periodStart(),
    periodEnd: periodEnd(),
    ledgerDrift: 0,
    unmeteredSince: null,
  };
  if (plan === "pro") {
    return {
      isPaid: true,
      credits: { ...base, used: 2513, limit: 5000, remaining: 2487 },
    };
  }
  if (plan === "exhausted") {
    return {
      isPaid: false,
      credits: { ...base, used: 500, limit: 500, remaining: 0 },
    };
  }
  return {
    isPaid: false,
    credits: { ...base, used: 312, limit: 500, remaining: 188 },
  };
}

/* ──────────────── DEVICES ──────────────── */
/*
 * MOCK DATA for the Overview "Devices" preview. Every value here is made up.
 *
 * Model: a HOST is a Mac running the desktop app; it runs the agents. An ENDPOINT is a device
 * an agent on that host can reach (glasses, phone, ...) to show something, ask, or take input.
 */

/** Only this account sees the preview (Samuel). Everyone else gets Overview unchanged. */
export const DEVICES_MOCK_USER_ID = "2dac1943-da3b-4fd9-aee6-1716ddfc25f9";

export type MockStatus = "active" | "away" | "offline";
export type EndpointKind = "glasses" | "phone" | "watch" | "web";
export type LogLevel = "info" | "warn" | "error";

export interface MockAgent {
  id: string;
  name: string;
  channel: string;
  runtime: string;
  /** Minutes since start. */
  runningFor: number;
  state: "working" | "waiting";
}

export interface MockEndpoint {
  id: string;
  kind: EndpointKind;
  name: string;
  model: string;
  status: MockStatus;
  /** Minutes ago. */
  lastSeen: number;
  /** The one the routing view picks right now. */
  inUse?: boolean;
  battery?: number;
}

export interface MockHost {
  id: string;
  name: string;
  model: string;
  status: MockStatus;
  lastSeen: number;
  appVersion: string;
  thisComputer?: boolean;
  runtimes: string[];
  agents: MockAgent[];
  endpoints: MockEndpoint[];
}

export interface MockLog {
  id: string;
  /** "HH:MM:SS" today. */
  at: string;
  deviceId: string;
  level: LogLevel;
  event: string;
  detail: string;
}

export interface MockRoute {
  id: string;
  at: string;
  kind: "Question" | "Message" | "Decision" | "Notice";
  from: string;
  summary: string;
  /** Endpoint ids tried, in order; the last one is where it landed. */
  tried: string[];
  landedOn: string;
  why: string;
}

export interface DevicesMock {
  hosts: MockHost[];
  /** The order the router walks when the device you are on does not answer. */
  fallbackChain: string[];
  routes: MockRoute[];
  logs: MockLog[];
}

export const DEVICES_MOCK: DevicesMock = {
  hosts: [
    {
      id: "mac-mbp",
      name: "Samuel's MacBook Pro",
      model: "MacBook Pro 14, macOS 26.1",
      status: "active",
      lastSeen: 0,
      appVersion: "1.42.0",
      thisComputer: true,
      runtimes: ["Claude", "Codex", "Grok"],
      agents: [
        { id: "a1", name: "Orchestrator", channel: "Dopl", runtime: "Claude", runningFor: 184, state: "waiting" },
        { id: "a2", name: "Devices Dashboard Mock", channel: "Dopl", runtime: "Claude", runningFor: 22, state: "working" },
        { id: "a3", name: "Landing Copy Fix", channel: "Dopl", runtime: "Claude", runningFor: 9, state: "working" },
      ],
      endpoints: [
        { id: "ep-g2", kind: "glasses", name: "Even G2", model: "Even Realities G2", status: "active", lastSeen: 0, inUse: true, battery: 64 },
        { id: "ep-iphone", kind: "phone", name: "Samuel's iPhone", model: "iPhone 17 Pro", status: "away", lastSeen: 12, battery: 81 },
      ],
    },
    {
      id: "mac-studio",
      name: "Studio Mac",
      model: "Mac Studio, macOS 26.1",
      status: "away",
      lastSeen: 6,
      appVersion: "1.41.0",
      runtimes: ["Claude", "Codex"],
      agents: [
        { id: "a4", name: "Nightly Audit", channel: "AI Ops Outreach", runtime: "Codex", runningFor: 47, state: "working" },
      ],
      endpoints: [
        { id: "ep-web", kind: "web", name: "Dopl web", model: "Chrome on Studio Mac", status: "offline", lastSeen: 190 },
      ],
    },
  ],
  fallbackChain: ["ep-g2", "ep-iphone", "mac-mbp"],
  routes: [
    {
      id: "r1",
      at: "14:32",
      kind: "Question",
      from: "Landing Copy Fix",
      summary: "Keep the SDK section or hide it?",
      tried: ["ep-g2"],
      landedOn: "ep-g2",
      why: "You're wearing your glasses and they answered.",
    },
    {
      id: "r2",
      at: "14:05",
      kind: "Decision",
      from: "Orchestrator",
      summary: "Start page fixes and devices together?",
      tried: ["ep-g2", "ep-iphone"],
      landedOn: "ep-iphone",
      why: "Glasses didn't answer in 30 seconds, so it moved to your phone.",
    },
    {
      id: "r3",
      at: "13:48",
      kind: "Message",
      from: "Nightly Audit",
      summary: "Audit finished, 3 issues found",
      tried: ["mac-mbp"],
      landedOn: "mac-mbp",
      why: "Not urgent, so it waited on your Mac.",
    },
    {
      id: "r4",
      at: "12:10",
      kind: "Notice",
      from: "Studio Mac",
      summary: "Studio Mac went to sleep",
      tried: ["ep-iphone"],
      landedOn: "ep-iphone",
      why: "Your phone was the last device you used.",
    },
    {
      id: "r5",
      at: "11:02",
      kind: "Question",
      from: "Orchestrator",
      summary: "Which account should the outreach go from?",
      tried: ["ep-g2", "ep-iphone", "mac-mbp"],
      landedOn: "mac-mbp",
      why: "Glasses and phone were offline, so it fell back to your Mac.",
    },
  ],
  logs: [
    { id: "l1", at: "14:32:07", deviceId: "ep-g2", level: "info", event: "Answer received", detail: "Tapped option 1 for Landing Copy Fix" },
    { id: "l2", at: "14:31:52", deviceId: "ep-g2", level: "info", event: "Question shown", detail: "From Landing Copy Fix, 2 options" },
    { id: "l3", at: "14:30:11", deviceId: "mac-mbp", level: "info", event: "Agent started", detail: "Devices Dashboard Mock on Claude" },
    { id: "l4", at: "14:05:40", deviceId: "ep-iphone", level: "info", event: "Decision answered", detail: "Picked Both at once" },
    { id: "l5", at: "14:05:31", deviceId: "ep-g2", level: "warn", event: "No answer", detail: "Timed out after 30 seconds, handed to phone" },
    { id: "l6", at: "13:58:02", deviceId: "mac-studio", level: "info", event: "Went idle", detail: "No input for 5 minutes" },
    { id: "l7", at: "13:48:19", deviceId: "mac-studio", level: "info", event: "Agent finished", detail: "Nightly Audit, 47 minutes" },
    { id: "l8", at: "13:20:44", deviceId: "mac-mbp", level: "warn", event: "Permission asked", detail: "Landing Copy Fix wants to post in Dopl" },
    { id: "l9", at: "12:10:03", deviceId: "mac-studio", level: "warn", event: "Lost connection", detail: "Heartbeat missed twice" },
    { id: "l10", at: "11:58:27", deviceId: "ep-web", level: "error", event: "Sign-in expired", detail: "Signed out after 30 days" },
    { id: "l11", at: "11:02:15", deviceId: "ep-iphone", level: "error", event: "Delivery failed", detail: "Phone offline, retried twice" },
    { id: "l12", at: "11:02:09", deviceId: "ep-g2", level: "warn", event: "Not reachable", detail: "Glasses were off" },
    { id: "l13", at: "10:41:56", deviceId: "ep-g2", level: "info", event: "Paired", detail: "Connected through MacBook Pro" },
    { id: "l14", at: "09:15:00", deviceId: "mac-mbp", level: "info", event: "Updated", detail: "Dopl 1.41.0 to 1.42.0" },
  ],
};
