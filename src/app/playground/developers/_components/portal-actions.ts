/** Store writes for the simulator, the log filter, webhooks, key rotation and Connect customization. */
import type { CapabilityId, DeviceKind, WebhookEventName } from "@dopl/device-contracts";
import type { WebhookOutboxRow } from "../_data/activity";
import type { ConnectConfig } from "../_data/connect-config";
import { rotateKey } from "../_data/keys";
import { createSimDevice, deliverTo, publishState, samplePayload, type SimDelivery, type SimDevice, type SimState } from "../_data/simulator";
import { webhookOf } from "../_data/simulator";
import { EMPTY_LOG_FILTER, getSnapshot, tick, update, type LogFilter, type WebhookEndpoint } from "./portal-store";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const randomTail = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

/* ── log filter ── */

export function setLogFilter(next: Partial<LogFilter>) {
  update((s) => ({ ...s, logFilter: { ...EMPTY_LOG_FILTER, ...next } }));
}

export function patchLogFilter(next: Partial<LogFilter>) {
  update((s) => ({ ...s, logFilter: { ...s.logFilter, ...next } }));
}

/* ── keys ── */

/** Rotates a key in the current env; returns the successor's full secret (shown once). */
export function rotate(id: string): string | null {
  const s = getSnapshot();
  const old = s.keys[s.env].find((k) => k.id === id);
  if (!old) return null;
  const secret = old.prefix.slice(0, old.prefix.indexOf("_", 3) + 1) + randomTail(24);
  update((x) => ({ ...x, keys: { ...x.keys, [x.env]: rotateKey(x.keys[x.env], id, secret, `key_rot_${randomTail(6)}`) } }));
  return secret;
}

/* ── simulator ── */

const setDevice = (d: SimDevice) => update((s) => ({ ...s, sim: { ...s.sim, devices: s.sim.devices.map((x) => (x.id === d.id ? d : x)) } }));

export function createSim(input: { kind: DeviceKind; name: string; external_user_id: string }): string {
  const { n } = tick();
  const device = createSimDevice(input, 100 + n);
  update((s) => ({ ...s, sim: { ...s.sim, devices: [device, ...s.sim.devices] } }));
  return device.id;
}

export function editSim(id: string, patch: Partial<SimState>) {
  const d = getSnapshot().sim.devices.find((x) => x.id === id);
  if (d) setDevice({ ...d, state: { ...d.state, ...patch } });
}

export function resetSim(id: string) {
  const d = getSnapshot().sim.devices.find((x) => x.id === id);
  if (d) setDevice({ ...d, state: d.published });
}

export function toggleSimScope(id: string, family: keyof SimDevice["scopes"]) {
  const d = getSnapshot().sim.devices.find((x) => x.id === id);
  if (d) setDevice({ ...d, scopes: { ...d.scopes, [family]: !d.scopes[family] } });
}

function appendSim(out: { device: SimDevice; events: SimDelivery["events"]; webhooks: WebhookOutboxRow[] }) {
  update((s) => ({
    ...s,
    sim: {
      devices: s.sim.devices.map((x) => (x.id === out.device.id ? out.device : x)),
      events: [...out.events, ...s.sim.events],
      webhooks: [...out.webhooks, ...s.sim.webhooks],
    },
  }));
}

export function publishSim(id: string) {
  const d = getSnapshot().sim.devices.find((x) => x.id === id);
  if (!d) return;
  const { n, at } = tick();
  appendSim(publishState(d, n * 10, at));
}

export function deliverSim(id: string, capability: CapabilityId): SimDelivery | null {
  const d = getSnapshot().sim.devices.find((x) => x.id === id);
  if (!d) return null;
  const { n, at } = tick();
  const out = deliverTo(d, capability, n * 10, at);
  appendSim(out);
  return out;
}

export function sendSample(event: WebhookEventName, deviceId: string | null) {
  const s = getSnapshot();
  const d = s.sim.devices.find((x) => x.id === deviceId) ?? null;
  const { n, at } = tick();
  const row = samplePayload(event, d, n * 10, at);
  update((x) => ({ ...x, sim: { ...x.sim, webhooks: [row, ...x.sim.webhooks] } }));
}

/* ── webhooks ── */

export function addEndpoint(url: string, events: WebhookEventName[]) {
  const { n } = tick();
  const endpoint: WebhookEndpoint = { id: `we_${randomTail(8)}`, url, events, secret_tail: n.toString(16).padStart(4, "0") };
  update((s) => ({ ...s, endpoints: { ...s.endpoints, [s.env]: [...s.endpoints[s.env], endpoint] } }));
}

/** "Send test event": a delivered sample of the endpoint's first event, in the current env. */
export function sendTestEvent(endpoint: WebhookEndpoint) {
  const s = getSnapshot();
  const { n, at } = tick();
  const row = { ...webhookOf(endpoint.events[0] ?? "connection.created", { test: true, endpoint_id: endpoint.id }, n * 10, at), env: s.env };
  update((x) => ({ ...x, sent: { ...x.sent, [x.env]: [row, ...x.sent[x.env]] } }));
}

/* ── Connect customization ── */

export function editConnect(fn: (c: ConnectConfig) => ConnectConfig) {
  update((s) => ({ ...s, connect: { ...s.connect, draft: fn(s.connect.draft) } }));
}

export const publishConnect = () => update((s) => ({ ...s, connect: { ...s.connect, published: s.connect.draft } }));
export const resetConnect = () => update((s) => ({ ...s, connect: { ...s.connect, draft: s.connect.published } }));
