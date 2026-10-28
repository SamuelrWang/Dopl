/**
 * The portal's LOCAL state, one module-level store (not a layout provider) so it survives moving
 * between sections; nothing is sent anywhere, and a reload restores the fixtures. The server always
 * renders `INITIAL`. Read through `usePortal` (`./portal-context.tsx`); written by its actions and
 * `./portal-actions.ts`.
 */
import type { ApiKey, ContextProfile, DeviceEventRow, Environment, WebhookEventName } from "@dopl/device-contracts";
import { WEBHOOK_EVENT_NAMES } from "@dopl/device-contracts";
import type { WebhookOutboxRow } from "../_data/activity";
import { DEFAULT_CONNECT_CONFIG, type ConnectConfig } from "../_data/connect-config";
import type { TypeState } from "../_data/device-type-status";
import { DEMO_ENVS, DEMO_NOW } from "../_data/fixtures";
import type { LogType } from "../_data/log";
import { seedSimDevices, type SimDevice } from "../_data/simulator";

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEventName[];
  secret_tail: string;
}

/** Filters another section hands to Events ("View requests", an error group). */
export interface LogFilter {
  key_id: string | null;
  error_code: string | null;
  type: LogType | "all";
  q: string;
}

export interface Snapshot {
  env: Environment;
  keys: Record<Environment, ApiKey[]>;
  overrides: Record<Environment, ContextProfile | null>;
  /** Only the device types changed in this tab; the rest read `seedState`. */
  types: Record<string, TypeState>;
  /** Simulator devices and what they produced (test env). */
  sim: { devices: SimDevice[]; events: DeviceEventRow[]; webhooks: WebhookOutboxRow[] };
  /** Webhooks sent from the portal itself (test events, sample payloads, replays), per env. */
  sent: Record<Environment, WebhookOutboxRow[]>;
  endpoints: Record<Environment, WebhookEndpoint[]>;
  connect: { draft: ConnectConfig; published: ConnectConfig };
  logFilter: LogFilter;
  /** Ids and the demo clock for rows made in this tab. */
  counter: number;
}

export const ALL_WEBHOOK_EVENTS: readonly WebhookEventName[] = WEBHOOK_EVENT_NAMES;


export const EMPTY_LOG_FILTER: LogFilter = { key_id: null, error_code: null, type: "all", q: "" };

export const INITIAL: Snapshot = {
  env: "test",
  keys: { test: DEMO_ENVS.test.keys, live: DEMO_ENVS.live.keys },
  overrides: { test: null, live: null },
  types: {},
  sim: { devices: seedSimDevices(), events: [], webhooks: [] },
  sent: { test: [], live: [] },
  endpoints: {
    test: [{ id: "we_test_01", url: "https://acme-agents.ngrok.app/dopl/webhooks", events: [...ALL_WEBHOOK_EVENTS], secret_tail: "4f2a" }],
    live: [{ id: "we_live_01", url: "https://api.acme-agents.com/dopl/webhooks", events: [...ALL_WEBHOOK_EVENTS], secret_tail: "9c1e" }],
  },
  connect: { draft: DEFAULT_CONNECT_CONFIG, published: DEFAULT_CONNECT_CONFIG },
  logFilter: EMPTY_LOG_FILTER,
  counter: 0,
};

let snapshot = INITIAL;
const listeners = new Set<() => void>();

export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => INITIAL;

export function update(fn: (s: Snapshot) => Snapshot) {
  snapshot = fn(snapshot);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The next id number and its timestamp: the demo clock plus one millisecond per row, so new rows sort first. */
export function tick(): { n: number; at: string } {
  const n = snapshot.counter + 1;
  snapshot = { ...snapshot, counter: n };
  return { n, at: new Date(Date.parse(DEMO_NOW) + n).toISOString() };
}

/** Test-only: put the store back to `INITIAL`. */
export function resetStore() {
  snapshot = INITIAL;
  listeners.forEach((l) => l());
}
