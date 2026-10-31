/**
 * What a `/developers` page receives from the server, and the rules every page shares. Pure, so a number
 * cannot disagree between two pages: every figure below is computed here from one metrics read.
 */
import { categoryOf, integrationOf, type IntegrationId, type ModelId } from "./catalog";

export type DeviceState = "online" | "offline" | "stale" | "needs_relink";

export const STATE_LABEL: Record<DeviceState, string> = { online: "Online", offline: "Offline", stale: "Stale pairing", needs_relink: "Needs relink" };

/** Idle this long with a live connection, and a pairing is stale. */
const STALE_DAYS = 14;
export const DAY_MS = 86_400_000;

/** One row of `dev_portal_metrics`. */
export interface MetricRow {
  day: string;
  user: string | null;
  device: string | null;
  kind: string | null;
  key: string | null;
  calls: number;
  errors: number;
  deliveries: number;
  delivered: number;
  failed: number;
  last_delivery: string | null;
}

export interface OwnedDevice {
  id: string;
  userId: string;
  name: string;
  modelId: ModelId;
  state: DeviceState;
  firmware: string | null;
  lastSeenAt: string | null;
  pairedAt: string;
  grants: string[];
  deliveries7d: number;
  delivered7d: number;
}

export interface PortalUser {
  id: string;
  name: string;
  /** False when `name` is only the developer's id again. */
  named: boolean;
  devices: OwnedDevice[];
  activeDeviceId: string | null;
  lastDeliveryAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export const userDeliveries = (u: PortalUser) => u.devices.reduce((n, d) => n + d.deliveries7d, 0);
export const userDelivered = (u: PortalUser) => u.devices.reduce((n, d) => n + d.delivered7d, 0);
export const userRate = (u: PortalUser) => {
  const sent = userDeliveries(u);
  return sent === 0 ? 0 : Math.round((userDelivered(u) / sent) * 100);
};
export const needsRelink = (u: PortalUser) => u.devices.some((d) => d.state === "needs_relink");
export const hasStale = (u: PortalUser) => u.devices.some((d) => d.state === "stale");
export const LOW_RATE = 90;
export const hasIssues = (u: PortalUser) => needsRelink(u) || hasStale(u) || (userDeliveries(u) > 0 && userRate(u) < LOW_RATE);

export interface Figures {
  deliveries: number;
  delivered: number;
  rate: number;
  users: number;
  online: number;
  devices: number;
}

export function figuresOfDevices(devices: readonly OwnedDevice[]): Figures {
  const deliveries = devices.reduce((n, d) => n + d.deliveries7d, 0);
  const delivered = devices.reduce((n, d) => n + d.delivered7d, 0);
  return {
    deliveries,
    delivered,
    rate: rateOf({ deliveries, delivered }),
    users: new Set(devices.map((d) => d.userId)).size,
    online: devices.filter((d) => d.state === "online").length,
    devices: devices.length,
  };
}

export const devicesOfModel = (users: readonly PortalUser[], id: ModelId) => users.flatMap((u) => u.devices).filter((d) => d.modelId === id);
export const devicesOfIntegration = (users: readonly PortalUser[], id: IntegrationId) => users.flatMap((u) => u.devices).filter((d) => integrationOf(d.modelId).id === id);
export const categoryIdOf = (modelId: ModelId) => categoryOf(modelId).id;

export const activeWithin = (users: readonly PortalUser[], ms: number, now: number) =>
  users.filter((u) => u.lastActiveAt !== null && now - Date.parse(u.lastActiveAt) <= ms).length;

/** The UTC day `offset` days before `now`. */
export const dayOf = (now: number, offset: number) => new Date(now - offset * DAY_MS).toISOString().slice(0, 10);

interface Totals {
  calls: number;
  errors: number;
  deliveries: number;
  delivered: number;
  failed: number;
}

export function totalsOf(rows: readonly MetricRow[]): Totals {
  const t: Totals = { calls: 0, errors: 0, deliveries: 0, delivered: 0, failed: 0 };
  for (const r of rows) {
    t.calls += r.calls;
    t.errors += r.errors;
    t.deliveries += r.deliveries;
    t.delivered += r.delivered;
    t.failed += r.failed;
  }
  return t;
}

/** Rows from `from` days ago (inclusive) up to `to` days ago (inclusive). Today is 0. */
export const rowsBetween = (rows: readonly MetricRow[], now: number, from: number, to = 0) => {
  const first = dayOf(now, from);
  const last = dayOf(now, to);
  return rows.filter((r) => r.day >= first && r.day <= last);
};

export const rateOf = (t: Pick<Totals, "deliveries" | "delivered">) => (t.deliveries === 0 ? 0 : Math.round((t.delivered / t.deliveries) * 1000) / 10);

const tickFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

interface DayBar {
  key: string;
  value: number;
  label: string;
  tick: string;
  rate: number | null;
}

/** One bar per UTC day, the last one today, so an empty day still takes its place on the axis. */
export function dailyBars(rows: readonly MetricRow[], days: number, now: number): DayBar[] {
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(now, days - 1 - i);
    const t = totalsOf(rows.filter((r) => r.day === day));
    const tick = tickFormat.format(new Date(`${day}T00:00:00Z`));
    return { key: day, value: t.deliveries, label: `${tick}: ${t.deliveries.toLocaleString("en-US")} deliveries`, tick, rate: t.deliveries ? rateOf(t) : null };
  });
}

/** The change against the window before it, or nothing when there is no window to compare with. */
export function percentDelta(now: number, before: number): { text: string; down: boolean } | null {
  if (before === 0) return null;
  const change = ((now - before) / before) * 100;
  return { text: `${Math.abs(change).toFixed(1)}%`, down: change < 0 };
}

export type IssueKind = "stale_pairing" | "needs_relink" | "webhook_failing" | "error_code";

export interface Issue {
  id: string;
  kind: IssueKind;
  title: string;
  code: string;
  count: number;
  countLabel: string;
  why: string;
  firstSeen: string | null;
  userIds: string[];
  latestCallId: string | null;
  /** Where to go about it. */
  action: { label: string; href: string };
}

export type CallKind = "delivery" | "message" | "request" | "webhook";
export type CallStatus = "queued" | "delivered" | "answered" | "dismissed" | "failed" | "refused" | "expired" | "received" | "ok" | "retrying";

export const STATUS_LABEL: Record<CallStatus, string> = {
  queued: "Queued",
  delivered: "Delivered",
  answered: "Answered",
  dismissed: "Dismissed",
  failed: "Failed",
  refused: "Refused",
  expired: "No answer",
  received: "Received",
  ok: "OK",
  retrying: "Retrying",
};
export const CALL_KIND_LABEL: Record<CallKind, string> = { delivery: "Delivery", message: "Message", request: "Request", webhook: "Webhook" };
export const TROUBLE: readonly CallStatus[] = ["failed", "refused", "retrying", "expired"];
export const WORKED: readonly CallStatus[] = ["delivered", "answered", "dismissed", "received", "ok"];

export interface CallStep {
  key: string;
  label: string;
  detail?: string;
  /** Milliseconds after the call started. */
  at?: number;
  state: "done" | "pending" | "failed";
}

export interface Considered {
  deviceId: string;
  verdict: "chosen" | "eligible" | "skipped";
  reason: string;
}

export interface WebhookCall {
  endpointId: string;
  endpointName: string;
  event: string;
  attempts: { at: string; status: number | null; note: string }[];
  payload: unknown;
}

export interface Call {
  id: string;
  kind: CallKind;
  at: string;
  userId: string | null;
  deviceId: string | null;
  modelId: ModelId | null;
  capability: string | null;
  status: CallStatus;
  errorCode: string | null;
  title: string;
  /** The message's own words, where it has any. */
  text: string | null;
  latencyMs: number | null;
  steps: CallStep[];
  considered: Considered[];
  route: string | null;
  response: unknown;
  webhook: WebhookCall | null;
}

export interface KeyView {
  id: string;
  name: string;
  kind: "secret" | "publishable";
  prefix: string;
  scopes: string[];
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  calls7d: number;
  revokedAt: string | null;
  expiresAt: string | null;
  /** Dopl's own delivery key: rotating or revoking it stops the app reaching devices. */
  locked: boolean;
}

export interface EndpointView {
  id: string;
  name: string;
  url: string;
  events: string[] | null;
  state: "healthy" | "failing" | "paused";
  sent7d: number;
  delivered7d: number;
  failed7d: number;
  rate: number;
  lastAt: string | null;
  bars: number[];
}

/** Failing: the last three settled sends failed, or under 90% across at least ten in a day. */
export function endpointFailing(settledNewestFirst: readonly { failed: boolean; at: string }[], now: number): boolean {
  if (settledNewestFirst.length >= 3 && settledNewestFirst.slice(0, 3).every((d) => d.failed)) return true;
  const day = settledNewestFirst.filter((d) => now - Date.parse(d.at) <= DAY_MS);
  return day.length >= 10 && day.filter((d) => !d.failed).length / day.length < LOW_RATE / 100;
}

export interface MemberView {
  userId: string;
  email: string | null;
  role: "owner" | "admin" | "developer";
  isOwner: boolean;
  isYou: boolean;
  lastActiveAt: string | null;
}

export interface InviteView {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expired: boolean;
}

/** The device states, derived on read: nothing stores them. */
export function deviceState(a: { connectionStatus: string; expiresAt: string | null; online: boolean; lastSeenAt: string | null; now: number }): DeviceState {
  if (a.connectionStatus === "needs_reauth" || (a.expiresAt !== null && Date.parse(a.expiresAt) <= a.now)) return "needs_relink";
  if (a.online) return "online";
  if (a.lastSeenAt !== null && a.now - Date.parse(a.lastSeenAt) > STALE_DAYS * DAY_MS) return "stale";
  return "offline";
}
