/**
 * The demo account's ACTIVITY: `dev_events` rows (C8), the webhook outbox, and the 14-day request
 * series behind the Overview chart. Generated deterministically from `./fixtures.ts` so test and
 * live each tell a consistent story (same users, same devices, same magic ids).
 */
import type {
  CapabilityId,
  Connection,
  DeliverIntent,
  DeviceEventRow,
  Environment,
  ErrorCode,
  EventOutcome,
  WebhookEventName,
} from "@dopl/contracts/device-sdk";
import { CAPABILITY_RISK_TIER } from "@dopl/contracts/device-sdk";
import { DEMO_ENVS, DEMO_ORG, DEMO_PROJECT, ago, type EnvFixtures } from "./fixtures";

/** A small seeded PRNG so every render (server and client) draws the same rows. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Scenario {
  intent: DeliverIntent | null;
  capability: CapabilityId;
  kinds: ReadonlyArray<Connection["device"]["kind"]>;
  outcome: EventOutcome;
  error: ErrorCode | null;
  target: string;
  reason: string;
  weight: number;
  /** Test env only: the magic end user this scenario runs against. */
  magic?: "sim_device_offline" | "sim_confirm_denied";
}

const SCENARIOS: Scenario[] = [
  { intent: "message", capability: "present.display", kinds: ["glasses"], outcome: "ok", error: null, target: "auto", reason: "active_device", weight: 9 },
  { intent: "ask", capability: "ask.choice", kinds: ["glasses"], outcome: "ok", error: null, target: "auto", reason: "active_device", weight: 5 },
  { intent: "notify", capability: "present.notify", kinds: ["desktop", "glasses"], outcome: "ok", error: null, target: "desktop", reason: "kind_requested", weight: 5 },
  { intent: null, capability: "input.utterance", kinds: ["glasses"], outcome: "ok", error: null, target: "inbound", reason: "device_event", weight: 4 },
  { intent: "message", capability: "present.display", kinds: ["glasses"], outcome: "error", error: "device_offline", target: "auto", reason: "only_candidate", weight: 2, magic: "sim_device_offline" },
  { intent: null, capability: "act.motion.move", kinds: ["robot"], outcome: "denied", error: "confirmation_denied", target: "robot", reason: "kind_requested", weight: 1, magic: "sim_confirm_denied" },
  { intent: null, capability: "capture.photo", kinds: ["phone", "glasses"], outcome: "denied", error: "grant_missing", target: "auto", reason: "capability_match", weight: 1 },
  { intent: "message", capability: "present.display", kinds: ["glasses"], outcome: "error", error: "rate_limited", target: "auto", reason: "active_device", weight: 1 },
  { intent: "notify", capability: "present.notify", kinds: ["glasses"], outcome: "error", error: "needs_reauth", target: "glasses", reason: "kind_requested", weight: 1 },
];

const TOTAL_WEIGHT = SCENARIOS.reduce((n, s) => n + s.weight, 0);

function pick(r: number): Scenario {
  let acc = r * TOTAL_WEIGHT;
  for (const s of SCENARIOS) {
    acc -= s.weight;
    if (acc < 0) return s;
  }
  return SCENARIOS[0];
}

function candidatesFor(fx: EnvFixtures, s: Scenario): Connection[] {
  const pool = fx.connections.filter((c) => c.status !== "revoked" && s.kinds.includes(c.device.kind));
  if (s.magic && fx.env === "test") return pool.filter((c) => c.external_user_id === s.magic);
  if (fx.env === "test") return pool.filter((c) => !c.external_user_id.startsWith("sim_"));
  if (s.error === "needs_reauth") return fx.connections.filter((c) => c.status === "needs_reauth");
  if (s.error === "device_offline") return pool.filter((c) => !c.device.online);
  return pool.filter((c) => c.device.online || s.outcome !== "ok");
}

function buildEvents(fx: EnvFixtures, count: number, seed: number): DeviceEventRow[] {
  const r = rng(seed);
  const rows: DeviceEventRow[] = [];
  let minutes = 0;
  for (let i = 0; i < count; i++) {
    minutes += 1 + Math.floor(r() * (fx.env === "live" ? 6 : 14));
    const s = pick(r());
    const pool = candidatesFor(fx, s);
    const c = pool.length > 0 ? pool[Math.floor(r() * pool.length)] : null;
    const d = c?.device ?? null;
    const glasses = d?.kind === "glasses";
    const profile = d ? (glasses && d.model === "even_g2" ? { id: "acme-g2-briefings", v: 3 } : { id: `${d.kind}-default`, v: 1 }) : null;
    const tier = CAPABILITY_RISK_TIER[s.capability];
    const delivered = s.outcome === "ok" && s.intent !== null;
    rows.push({
      event_id: `evt_${fx.env[0]}${(9000 - i).toString(36)}${Math.floor(r() * 1e6).toString(36)}`,
      ts: ago(minutes),
      org_id: DEMO_ORG.id,
      project_id: DEMO_PROJECT.id,
      env: fx.env,
      external_user_id: c?.external_user_id ?? null,
      connection_id: c?.id ?? null,
      device_id: d?.id ?? null,
      device_kind: d?.kind ?? null,
      vendor: d?.vendor ?? null,
      model: d?.model ?? null,
      firmware: d?.firmware ?? null,
      adapter_version: d?.adapter_version ?? null,
      capability: s.capability,
      intent: s.intent,
      route_decision:
        s.target === "inbound" || !d
          ? null
          : {
              target: s.target,
              reason: s.reason,
              candidates: (c ? fx.connections.filter((x) => x.external_user_id === c.external_user_id && x.status !== "revoked") : []).map((x) => x.device.id),
            },
      profile_id: profile?.id ?? null,
      profile_version: profile?.v ?? null,
      risk_tier: tier,
      confirmation: tier === "T4" || tier === "T3" ? { required: true, result: s.outcome === "denied" ? "denied" : "approved" } : null,
      outcome: s.outcome,
      error_code: s.error,
      latency_ms: {
        api: 18 + Math.floor(r() * (s.error === "rate_limited" ? 8 : 70)),
        device_delivery: delivered ? 90 + Math.floor(r() * 420) : null,
        user_response: s.intent === "ask" && delivered ? 1800 + Math.floor(r() * 9000) : null,
      },
      bytes_in: 180 + Math.floor(r() * 900),
      bytes_out: s.outcome === "ok" ? 120 + Math.floor(r() * 400) : 160,
      cost_units: s.outcome === "ok" ? 1 : 0,
    });
  }
  return rows;
}

/* ───────────────────────────── webhooks ───────────────────────────── */

/** One `dev_webhook_outbox` row (migration `20261122400000_device_sdk_connect.sql`). */
export interface WebhookOutboxRow {
  id: string;
  project_id: string;
  env: Environment;
  event_type: WebhookEventName;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string;
  created_at: string;
}

const EVENT_FOR_ERROR: Partial<Record<ErrorCode, WebhookEventName>> = {
  device_offline: "device.offline",
  needs_reauth: "connection.needs_reauth",
};

function buildWebhooks(fx: EnvFixtures, events: DeviceEventRow[]): WebhookOutboxRow[] {
  const rows: WebhookOutboxRow[] = [];
  const push = (event_type: WebhookEventName, created_at: string, payload: Record<string, unknown>) => {
    const n = rows.length;
    const status: WebhookOutboxRow["status"] = n === 1 ? "pending" : n % 9 === 4 ? "failed" : "delivered";
    rows.push({
      id: `whk_${fx.env[0]}${(4200 + n).toString(36)}`,
      project_id: DEMO_PROJECT.id,
      env: fx.env,
      event_type,
      payload,
      status,
      attempts: status === "delivered" ? 1 : status === "failed" ? 6 : 2,
      next_attempt_at: status === "pending" ? ago(-2) : created_at,
      created_at,
    });
  };
  for (const e of events.slice(0, 40)) {
    const base = { external_user_id: e.external_user_id, connection_id: e.connection_id, device_id: e.device_id };
    const mapped = e.error_code ? EVENT_FOR_ERROR[e.error_code] : undefined;
    if (mapped) push(mapped, e.ts, base);
    else if (e.capability === "input.utterance") push("input.utterance", e.ts, { ...base, text: "What is on my calendar next?" });
    else if (e.intent === "ask" && e.outcome === "ok") push("ask.answered", e.ts, { ...base, answer: "Reschedule" });
    else if (e.outcome === "denied") push("action.failed", e.ts, { ...base, status: "failed", error: e.error_code });
    else if (e.intent === "message" && e.outcome === "ok" && rows.length % 3 === 0) push("action.completed", e.ts, { ...base, status: "done" });
  }
  for (const c of fx.connections.slice(0, 4)) push("connection.created", c.created_at, { external_user_id: c.external_user_id, connection_id: c.id });
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* ───────────────────────────── 14-day series ───────────────────────────── */

export interface DayPoint {
  /** `YYYY-MM-DD`. */
  day: string;
  requests: number;
  errors: number;
}

function buildSeries(env: Environment): DayPoint[] {
  const r = rng(env === "live" ? 77 : 11);
  return Array.from({ length: 14 }, (_, i) => {
    const day = ago((13 - i) * 24 * 60).slice(0, 10);
    const base = env === "live" ? 3200 + i * 260 : 140 + i * 9;
    const requests = Math.round(base * (0.8 + r() * 0.4));
    return { day, requests, errors: Math.round(requests * (0.01 + r() * 0.025)) };
  });
}

export interface EnvActivity {
  events: DeviceEventRow[];
  webhooks: WebhookOutboxRow[];
  series: DayPoint[];
}

function activity(env: Environment, count: number, seed: number): EnvActivity {
  const fx = DEMO_ENVS[env];
  const events = buildEvents(fx, count, seed);
  return { events, webhooks: buildWebhooks(fx, events), series: buildSeries(env) };
}

export const DEMO_ACTIVITY: Record<Environment, EnvActivity> = {
  test: activity("test", 48, 5),
  live: activity("live", 90, 42),
};
