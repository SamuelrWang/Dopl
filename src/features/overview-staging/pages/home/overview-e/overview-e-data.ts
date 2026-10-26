// STAGING ONLY — Overview Version E (2026-10-26): pure derivations over the SAME fixtures Current
// and Version D read (`overview-mock-data.ts` through the stubs, plus D's two invented asks). No
// UI, and nothing imported from Current's or D's components: every helper here is E's own.
import {
  DEVICES_MOCK,
  HOME_CHANNELS,
  type MockHost,
  type MockStatus,
} from "@/features/overview-staging/overview-mock-data";
import { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP } from "@/features/home/overview-types";

export { NEEDS, type Need } from "../overview-d/overview-d-data";

/* ── months ── */

export function monthKeyOf(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function shiftMonth(key: string, delta: number): string {
  const [y = "", m = ""] = key.split("-");
  return monthKeyOf(new Date(Date.UTC(Number(y), Number(m) - 1 + delta, 1)));
}
export function monthName(key: string): string {
  const [y = "", m = ""] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
/** The same series path the stub answers (`channel`, `month` only when not the defaults). */
export function seriesPath(scope: string, month: string): string {
  const params = ["range=month", "metric=credits"];
  if (scope !== USAGE_SCOPE_ALL) params.push(`channel=${scope}`);
  if (month !== monthKeyOf()) params.push(`month=${month}`);
  return `/api/home/overview-series?${params.join("&")}`;
}

/** Usage scopes, the same set Current's scope menu offers. */
export const SCOPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: USAGE_SCOPE_ALL, label: "All channels" },
  { id: USAGE_SCOPE_DESKTOP, label: "Desktop agent" },
  ...HOME_CHANNELS.map((c) => ({ id: c.id, label: c.name })),
];

/* ── tokens: the last 31 local days ── */

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function tokenDays(marks: ReadonlyArray<{ at: string; tokens: number }>, days = 31) {
  const now = new Date();
  const keys: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    keys.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)));
  }
  const byDay = new Map<string, number>(keys.map((k) => [k, 0]));
  let total = 0;
  let runs = 0;
  for (const m of marks) {
    const k = dayKey(new Date(m.at));
    if (!byDay.has(k)) continue;
    byDay.set(k, (byDay.get(k) ?? 0) + m.tokens);
    total += m.tokens;
    runs += 1;
  }
  return { values: keys.map((k) => byDay.get(k) ?? 0), total, runs };
}

/** "1.2M" / "34k" / "812". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** "3h 4m" from minutes. */
export function runTime(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "now" / "12m ago" / "3h ago" from minutes. */
export function seen(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/* ── devices: one directory of every host and endpoint, by id ── */

export type DeviceRow = {
  id: string;
  kind: string;
  name: string;
  model: string;
  status: MockStatus;
  lastSeen: number;
  /** The computer an endpoint is reached through; null for a computer. */
  host: string | null;
  inUse: boolean;
  battery?: number;
};

export function deviceDirectory(hosts: readonly MockHost[] = DEVICES_MOCK.hosts): Map<string, DeviceRow> {
  const out = new Map<string, DeviceRow>();
  for (const h of hosts) {
    out.set(h.id, {
      id: h.id,
      kind: "computer",
      name: h.name,
      model: `${h.model} · Dopl ${h.appVersion}`,
      status: h.status,
      lastSeen: h.lastSeen,
      host: null,
      inUse: false,
    });
    for (const e of h.endpoints) {
      out.set(e.id, {
        id: e.id,
        kind: e.kind,
        name: e.name,
        model: e.model,
        status: e.status,
        lastSeen: e.lastSeen,
        host: h.name,
        inUse: Boolean(e.inUse),
        battery: e.battery,
      });
    }
  }
  return out;
}

export const RUNTIME_LOGO: Record<string, string> = {
  Claude: "/img/onboarding/claude-logo.svg",
  Codex: "/img/onboarding/chatgpt-logo.svg",
  Grok: "/img/onboarding/grok-logo.svg",
};

/** Agent → its host, for the needs-you rows. */
export function agentIndex(hosts: readonly MockHost[] = DEVICES_MOCK.hosts) {
  const out = new Map<string, { name: string; runtime: string; host: string }>();
  for (const h of hosts) for (const a of h.agents) out.set(a.id, { name: a.name, runtime: a.runtime, host: h.name });
  return out;
}
