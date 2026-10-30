/**
 * One seeded log per environment, 14 days of rows for one fictional customer. Every figure on both
 * pages is computed from these rows, so no two numbers disagree. A row has no message content:
 * Dopl's log records that a call happened, never what it said.
 */
import type { CapabilityId, ErrorCode } from "@dopl/device-contracts";
import type { ModelId, IntegrationId } from "./catalog";
import { integrationOfModel } from "./catalog";

export const DEMO_NOW = "2026-10-29T16:40:00.000Z";

export type Env = "test" | "live";
export type LogStatus = "delivered" | "answered" | "failed";

export interface LogRow {
  id: string;
  at: string;
  userId: string;
  modelId: ModelId;
  capability: CapabilityId;
  status: LogStatus;
  errorCode: ErrorCode | null;
  latencyMs: number;
}

interface UserSeed {
  id: string;
  models: ModelId[];
  perDay: number;
  failRate: number;
  error: ErrorCode;
}

const live = (n: number, models: ModelId[], perDay: number, failRate = 0.015, error: ErrorCode = "device_offline"): UserSeed => ({ id: `tech_${n}`, models, perDay, failRate, error });

const SEEDS: Record<Env, UserSeed[]> = {
  live: [
    live(1042, ["g2", "macos"], 38),
    live(1058, ["g2"], 27),
    live(1063, ["g2", "macos"], 29),
    live(1077, ["g2"], 17, 0.21, "needs_reauth"),
    live(1084, ["g2", "macos"], 45),
    live(1091, ["g2"], 7, 0.07),
    live(1096, ["g2"], 19, 0.04, "vendor_error"),
    live(1107, ["g2"], 22, 0.17),
    live(1113, ["g2", "macos"], 25),
    live(1120, ["macos"], 3),
    live(1128, ["g2"], 29, 0.03, "rate_limited"),
    live(1134, ["g2", "macos"], 17, 0.24, "needs_reauth"),
    live(1141, ["g2"], 16, 0.04, "vendor_error"),
    live(1149, ["g2"], 2, 0.1),
    live(1155, ["g2", "macos"], 33),
    live(1162, ["g2"], 14, 0.05),
    live(1168, ["g2"], 19),
    live(1173, ["macos"], 2),
    live(1179, ["g2", "macos"], 29),
    live(1186, ["g2"], 10, 0.25, "needs_reauth"),
    live(1192, ["g2"], 13),
    live(1198, ["g2", "macos"], 19),
    live(1204, ["g2"], 4, 0.05),
    live(1211, ["g2"], 9),
    live(1219, ["macos"], 5),
  ],
  test: [
    { id: "qa_mei", models: ["g2", "macos"], perDay: 22, failRate: 0.05, error: "device_offline" },
    { id: "qa_dario", models: ["macos"], perDay: 9, failRate: 0, error: "device_offline" },
    { id: "qa_lab_1", models: ["g2"], perDay: 12, failRate: 0.12, error: "capability_unsupported" },
    { id: "qa_lab_2", models: ["g2"], perDay: 3, failRate: 0, error: "device_offline" },
  ],
};

const G2_CAPABILITIES: CapabilityId[] = ["present.notify", "present.notify", "present.notify", "present.display", "ask.choice", "ask.choice"];
const DAY_MS = 86_400_000;
/** Sunday first: weekends are quiet for field teams. */
const WEEK_SHAPE = [0.4, 1.05, 1.15, 1.2, 1.1, 1.0, 0.45];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generate(env: Env, seed: number): LogRow[] {
  const r = rng(seed);
  const now = Date.parse(DEMO_NOW);
  const rows: LogRow[] = [];
  for (const user of SEEDS[env]) {
    for (let day = 0; day < 14; day++) {
      const dow = new Date(now - day * DAY_MS).getUTCDay();
      const count = Math.round(user.perDay * WEEK_SHAPE[dow] * (0.85 + r() * 0.3));
      for (let i = 0; i < count; i++) {
        const modelId = user.models[r() < 0.78 ? 0 : user.models.length - 1];
        const capability = modelId === "macos" ? "present.notify" : G2_CAPABILITIES[Math.floor(r() * G2_CAPABILITIES.length)];
        const failed = r() < user.failRate;
        const answered = capability === "ask.choice" && r() < 0.8;
        rows.push({
          id: `${env}_${rows.length}`,
          at: new Date(now - day * DAY_MS - Math.floor(r() * (day === 0 ? 16 : 24) * 3_600_000)).toISOString(),
          userId: user.id,
          modelId,
          capability,
          status: failed ? "failed" : answered ? "answered" : "delivered",
          errorCode: failed ? user.error : null,
          latencyMs: failed ? 30 + Math.floor(r() * 400) : 140 + Math.floor(r() * 900),
        });
      }
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export const LOGS: Record<Env, readonly LogRow[]> = { live: generate("live", 7), test: generate("test", 21) };

const weekOf = (env: Env) => LOGS[env].filter((row) => Date.parse(DEMO_NOW) - Date.parse(row.at) < 7 * DAY_MS);

const isDelivered = (row: LogRow) => row.status !== "failed";

export function usageOf(env: Env) {
  const week = weekOf(env);
  const delivered = week.filter(isDelivered).length;
  return {
    calls: week.length,
    delivered,
    activeUsers: new Set(week.map((row) => row.userId)).size,
    successRate: week.length ? Math.round((delivered / week.length) * 1000) / 10 : 0,
  };
}

export function byIntegration(env: Env): { id: IntegrationId; calls: number; successRate: number }[] {
  const totals = new Map<IntegrationId, { calls: number; delivered: number }>();
  for (const row of weekOf(env)) {
    const id = integrationOfModel(row.modelId).id;
    const t = totals.get(id) ?? { calls: 0, delivered: 0 };
    t.calls += 1;
    if (isDelivered(row)) t.delivered += 1;
    totals.set(id, t);
  }
  return [...totals.entries()]
    .map(([id, t]) => ({ id, calls: t.calls, successRate: Math.round((t.delivered / t.calls) * 1000) / 10 }))
    .sort((a, b) => b.calls - a.calls);
}

export function topErrors(env: Env): { code: ErrorCode; count: number }[] {
  const counts = new Map<ErrorCode, number>();
  for (const row of weekOf(env)) if (row.errorCode) counts.set(row.errorCode, (counts.get(row.errorCode) ?? 0) + 1);
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 4);
}

export function callsThisWeek(env: Env, id: IntegrationId): number {
  return byIntegration(env).find((row) => row.id === id)?.calls ?? 0;
}

export function dailyBars(env: Env): { key: string; value: number; label: string; tick: string }[] {
  const now = Date.parse(DEMO_NOW);
  return Array.from({ length: 14 }, (_, i) => {
    const day = 13 - i;
    const stamp = new Date(now - day * DAY_MS);
    const key = stamp.toISOString().slice(0, 10);
    const value = LOGS[env].filter((row) => row.at.slice(0, 10) === key).length;
    const tick = stamp.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return { key, value, label: `${tick} · ${value.toLocaleString("en-US")} calls`, tick };
  });
}

/** A user's rows, newest first. The id must match in full. */
export function rowsForUser(env: Env, query: string, limit = 50): LogRow[] {
  const id = query.trim().toLowerCase();
  if (!id) return [];
  return LOGS[env].filter((row) => row.userId === id).slice(0, limit);
}
