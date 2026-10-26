/**
 * STAGING DATA for `/overview` — every value here is made up. THE ONE DATA FILE.
 *
 * The product Overview (`home/components/overview/home-overview.tsx`) reads
 * through one reads hook; the staging stubs (`./stubs/*`) answer each of its
 * reads out of this file and nothing else. No Supabase, no fetch, no IPC.
 *
 *   GET /api/home/overview            → `HOME_OVERVIEW`
 *   GET /api/home/overview-series     → `overviewSeries(scope, month)`
 *   GET /api/home/token-spend         → `tokenSpendReport()`
 *   GET /api/billing/status (credits) → `creditState(plan)`
 *   devices (computers + glasses)     → `connectedDevices()`
 *   usage scopes                      → `HOME_CHANNELS`
 */
import type {
  HomeOverview,
  HomeOverviewSeries,
  HomeSeriesPoint,
} from "@/features/home/overview-types";
import { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP } from "@/features/home/overview-types";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import type { ConnectedDevice } from "@/features/devices/types";
import type { TokenSpendReport } from "@/shared/lib/token-spend-days";

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

/* ─────────────────────────────────── devices ─────────────────────────────────── */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** `useConnectedDevices`' merged list: this computer first, then online, then by last seen. */
export function connectedDevices(empty = false): ConnectedDevice[] {
  if (empty) return [];
  return [
    {
      id: "mac-mbp",
      kind: "computer",
      name: "Daniel's MacBook Pro",
      platform: "macos",
      platformLabel: "macOS",
      online: true,
      lastSeen: minutesAgo(0),
      createdAt: "2026-09-01T00:00:00.000Z",
      current: true,
      appVersion: "1.43.0",
    },
    {
      id: "g2",
      kind: "glasses",
      name: "Even G2",
      platform: "even_g2",
      platformLabel: "Even G2",
      online: true,
      lastSeen: minutesAgo(0),
      createdAt: "2026-10-02T00:00:00.000Z",
    },
    {
      id: "mac-studio",
      kind: "computer",
      name: "Studio Mac",
      platform: "macos",
      platformLabel: "macOS",
      online: false,
      lastSeen: minutesAgo(190),
      createdAt: "2026-09-12T00:00:00.000Z",
      appVersion: "1.42.0",
    },
  ];
}
