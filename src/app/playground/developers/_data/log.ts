/**
 * THE UNIFIED LOG: API requests, Connect sessions, deliveries / actions and webhooks as one row
 * type, so Events can show them in one table and resolve any id (request, action, device, user,
 * connection, webhook, event, Connect token) with one search box. Pure; `log.test.ts` pins it.
 */
import type { ApiKey, DeviceEventRow, Environment, ErrorCode } from "@dopl/device-contracts";
import { ERROR_CODE_INFO } from "@dopl/device-contracts";
import type { WebhookOutboxRow } from "./activity";
import { STEP_LABEL, type ConnectSessionRow } from "./connect-sessions";

export type LogType = "request" | "connect" | "delivery" | "webhook";

export const LOG_TYPE_LABEL: Record<LogType, string> = {
  request: "Request",
  connect: "Connect",
  delivery: "Delivery",
  webhook: "Webhook",
};

export interface LogRow {
  /** The row's own id (request id, event id, Connect token, webhook id). */
  id: string;
  type: LogType;
  ts: string;
  env: Environment;
  /** Path, capability, step or event name. */
  title: string;
  ok: boolean;
  /** "202", "ok", "device_offline", "Dropped at paired", "Delivered"… */
  status: string;
  /** Every id this row answers to in the search box. */
  ids: string[];
  /** The secret key that made the call (requests only). */
  key_id: string | null;
  error_code: ErrorCode | null;
  detail: unknown;
}

const tail = (id: string) => id.slice(id.indexOf("_") + 1);
export const requestIdOf = (e: DeviceEventRow) => `req_${tail(e.event_id)}`;
export const actionIdOf = (e: DeviceEventRow) => `act_${tail(e.event_id)}`;

const isCall = (e: DeviceEventRow) => e.intent !== null || !(e.capability ?? "").startsWith("input.");

function eventIds(e: DeviceEventRow): string[] {
  return [e.event_id, requestIdOf(e), actionIdOf(e), e.external_user_id, e.device_id, e.connection_id].filter((x): x is string => Boolean(x));
}

/** A stable pick of the env's secret key that made a call. */
function keyFor(e: DeviceEventRow, keys: readonly ApiKey[]): string | null {
  const pool = keys.filter((k) => k.kind === "secret" && k.env === e.env);
  if (pool.length === 0) return null;
  let h = 0;
  for (const ch of e.event_id) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return pool[h % pool.length].id;
}

export function requestRow(e: DeviceEventRow, keys: readonly ApiKey[]): LogRow {
  const path = e.intent ? `/users/${e.external_user_id ?? "{external_user_id}"}/deliver` : `/devices/${e.device_id ?? "{device_id}"}/actions/${e.capability}`;
  const status = e.error_code ? ERROR_CODE_INFO[e.error_code].status : 202;
  const key_id = keyFor(e, keys);
  return {
    id: requestIdOf(e),
    type: "request",
    ts: e.ts,
    env: e.env,
    title: `POST ${path}`,
    ok: status < 400,
    status: String(status),
    ids: eventIds(e),
    key_id,
    error_code: e.error_code,
    detail: { request_id: requestIdOf(e), method: "POST", path, status, key_id, latency_ms: e.latency_ms.api },
  };
}

export function deliveryRow(e: DeviceEventRow): LogRow {
  return {
    id: e.event_id,
    type: "delivery",
    ts: e.ts,
    env: e.env,
    title: [e.capability, e.intent].filter(Boolean).join(" · "),
    ok: e.outcome === "ok",
    status: e.error_code ?? e.outcome,
    ids: eventIds(e),
    key_id: null,
    error_code: e.error_code,
    detail: e,
  };
}

export function webhookRow(w: WebhookOutboxRow): LogRow {
  const p = w.payload as Record<string, unknown>;
  const ids = [w.id, p.external_user_id, p.device_id, p.connection_id].filter((x): x is string => typeof x === "string");
  return {
    id: w.id,
    type: "webhook",
    ts: w.created_at,
    env: w.env,
    title: w.event_type,
    ok: w.status !== "failed",
    status: w.status === "delivered" ? "Delivered" : w.status === "pending" ? "Retrying" : "Failed",
    ids,
    key_id: null,
    error_code: null,
    detail: { id: w.id, type: w.event_type, created_at: w.created_at, attempts: w.attempts, data: w.payload },
  };
}

export function connectRow(s: ConnectSessionRow): LogRow {
  const done = s.reached === "connected";
  return {
    id: s.id,
    type: "connect",
    ts: s.steps[s.steps.length - 1].at,
    env: s.env,
    title: done ? "Connected" : `Reached ${STEP_LABEL[s.reached].toLowerCase()}`,
    ok: done,
    status: done ? "Connected" : "Dropped",
    ids: [s.id, s.external_user_id, s.connection_id].filter((x): x is string => Boolean(x)),
    key_id: null,
    error_code: null,
    detail: s,
  };
}

export function buildLog(input: {
  events: readonly DeviceEventRow[];
  webhooks: readonly WebhookOutboxRow[];
  sessions: readonly ConnectSessionRow[];
  keys: readonly ApiKey[];
}): LogRow[] {
  const rows: LogRow[] = [];
  for (const e of input.events) {
    if (isCall(e)) rows.push(requestRow(e, input.keys));
    rows.push(deliveryRow(e));
  }
  for (const w of input.webhooks) rows.push(webhookRow(w));
  for (const s of input.sessions) rows.push(connectRow(s));
  return rows.sort((a, b) => b.ts.localeCompare(a.ts));
}

export interface LogQuery {
  q?: string;
  type?: LogType | "all";
  key_id?: string | null;
  error_code?: string | null;
  failedOnly?: boolean;
}

export function queryLog(rows: readonly LogRow[], query: LogQuery): LogRow[] {
  const q = query.q?.trim().toLowerCase() ?? "";
  return rows.filter(
    (r) =>
      (!query.type || query.type === "all" || r.type === query.type) &&
      (!query.key_id || r.key_id === query.key_id) &&
      (!query.error_code || r.error_code === query.error_code) &&
      (!query.failedOnly || !r.ok) &&
      (!q || r.ids.some((id) => id.toLowerCase().includes(q)))
  );
}

export interface ErrorGroup {
  code: ErrorCode;
  count: number;
  last_seen: string;
  capabilities: string[];
  status: number;
}

/** Errors grouped by code, most frequent first. */
export function groupErrors(events: readonly DeviceEventRow[]): ErrorGroup[] {
  const by = new Map<ErrorCode, ErrorGroup>();
  for (const e of events) {
    if (!e.error_code) continue;
    const g = by.get(e.error_code) ?? { code: e.error_code, count: 0, last_seen: e.ts, capabilities: [], status: ERROR_CODE_INFO[e.error_code].status };
    g.count += 1;
    if (e.ts > g.last_seen) g.last_seen = e.ts;
    if (e.capability && !g.capabilities.includes(e.capability)) g.capabilities.push(e.capability);
    by.set(e.error_code, g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen));
}
