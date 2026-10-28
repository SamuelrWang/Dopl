/**
 * THE SIMULATOR (test mode): simulated devices with editable state. Publishing a state change and
 * sending a delivery produce the same `dev_events` rows and webhook outbox rows the API would, so
 * they land in Events, Webhooks and Overview. Pure; `simulator.test.ts` pins it.
 */
import type {
  CapabilityFamily,
  CapabilityId,
  DeliverRequest,
  DeliverResponse,
  DeviceEventRow,
  DeviceKind,
  ErrorCode,
  ErrorResponse,
  WebhookEventName,
} from "@dopl/device-contracts";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, ERROR_CODE_INFO, TEST_MAGIC_DEVICE_IDS, errorDocUrl } from "@dopl/device-contracts";
import type { WebhookOutboxRow } from "./activity";
import { DEMO_ENVS, DEMO_ORG, DEMO_PROJECT } from "./fixtures";

export interface SimState {
  online: boolean;
  battery: number;
  wearing: boolean;
  display_busy: boolean;
}

export interface SimDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  external_user_id: string;
  connection_id: string;
  /** What the editor shows. */
  state: SimState;
  /** What the API and webhooks last saw. */
  published: SimState;
  /** Granted scope families; an unticked one makes calls in it fail with `grant_missing`. */
  scopes: Record<CapabilityFamily, boolean>;
}

export const SIM_KINDS: readonly DeviceKind[] = ["glasses", "phone", "desktop", "watch", "home_hub", "vehicle", "robot"];

const FAMILIES = [...new Set(Object.values(CAPABILITY_FAMILY))] as CapabilityFamily[];
export const SCOPE_FAMILIES: readonly CapabilityFamily[] = FAMILIES;

/** The deliveries the simulator panel offers. */
export const SIM_CAPABILITIES: readonly CapabilityId[] = ["present.notify", "present.display", "ask.choice", "capture.photo"];

const DEFAULT_STATE: SimState = { online: true, battery: 82, wearing: true, display_busy: false };

export function createSimDevice(input: { kind: DeviceKind; name: string; external_user_id: string }, n: number): SimDevice {
  const id = `dev_sim_${input.kind}_${n.toString(36)}`;
  return {
    id,
    kind: input.kind,
    name: input.name || `Simulated ${input.kind}`,
    external_user_id: input.external_user_id,
    connection_id: `conn_sim_${n.toString(36)}`,
    state: DEFAULT_STATE,
    published: DEFAULT_STATE,
    scopes: Object.fromEntries(FAMILIES.map((f) => [f, true])) as Record<CapabilityFamily, boolean>,
  };
}

/** The test env's simulator connections, as editable devices. */
export function seedSimDevices(): SimDevice[] {
  return DEMO_ENVS.test.connections
    .filter((c) => c.device.adapter_id === "simulator")
    .map((c, i) => ({
      ...createSimDevice({ kind: c.device.kind, name: `Simulated ${c.device.kind}`, external_user_id: c.external_user_id }, i),
      id: c.device.id,
      connection_id: c.id,
    }));
}

export const isDirty = (d: SimDevice) => JSON.stringify(d.state) !== JSON.stringify(d.published);

function eventRow(d: SimDevice, n: number, at: string, capability: CapabilityId, over: Partial<DeviceEventRow> = {}): DeviceEventRow {
  return {
    event_id: `evt_sim${n.toString(36)}`,
    ts: at,
    org_id: DEMO_ORG.id,
    project_id: DEMO_PROJECT.id,
    env: "test",
    external_user_id: d.external_user_id,
    connection_id: d.connection_id,
    device_id: d.id,
    device_kind: d.kind,
    vendor: "dopl",
    model: `simulated_${d.kind}`,
    firmware: null,
    adapter_version: "0.1.0",
    capability,
    intent: null,
    route_decision: null,
    profile_id: null,
    profile_version: null,
    risk_tier: CAPABILITY_RISK_TIER[capability],
    confirmation: null,
    outcome: "ok",
    error_code: null,
    latency_ms: { api: 24, device_delivery: null, user_response: null },
    bytes_in: 0,
    bytes_out: 0,
    cost_units: 0,
    ...over,
  };
}

export function webhookOf(event_type: WebhookEventName, payload: Record<string, unknown>, n: number, at: string): WebhookOutboxRow {
  return {
    id: `whk_sim${n.toString(36)}`,
    project_id: DEMO_PROJECT.id,
    env: "test",
    event_type,
    payload,
    status: "delivered",
    attempts: 1,
    next_attempt_at: at,
    created_at: at,
  };
}

const base = (d: SimDevice) => ({ external_user_id: d.external_user_id, connection_id: d.connection_id, device_id: d.id });

export interface SimOutput {
  device: SimDevice;
  events: DeviceEventRow[];
  webhooks: WebhookOutboxRow[];
}

/** Publishes the editor's state: one event per changed signal, plus `device.online` / `device.offline`. */
export function publishState(d: SimDevice, n: number, at: string): SimOutput {
  const events: DeviceEventRow[] = [];
  const webhooks: WebhookOutboxRow[] = [];
  const { state: next, published: prev } = d;
  const changed = (k: keyof SimState) => next[k] !== prev[k];
  if (changed("online")) {
    events.push(eventRow(d, n + events.length, at, "presence.read"));
    webhooks.push(webhookOf(next.online ? "device.online" : "device.offline", base(d), n + webhooks.length, at));
  }
  if (changed("wearing")) events.push(eventRow(d, n + events.length, at, "presence.read"));
  if (changed("battery")) events.push(eventRow(d, n + events.length, at, "telemetry.read"));
  if (changed("display_busy")) events.push(eventRow(d, n + events.length, at, "state.read"));
  return { device: { ...d, published: next }, events, webhooks };
}

/** Why a delivery to this device fails, if it does: a magic id, a revoked scope, or offline. */
export function failureOf(d: SimDevice, capability: CapabilityId): ErrorCode | null {
  const magic = (Object.entries(TEST_MAGIC_DEVICE_IDS) as Array<[string, ErrorCode]>).find(([id]) => d.external_user_id === id);
  if (magic) return magic[1];
  if (!d.scopes[CAPABILITY_FAMILY[capability]]) return "grant_missing";
  if (!d.published.online) return "device_offline";
  return null;
}

export interface SimDelivery extends SimOutput {
  request: DeliverRequest;
  response: DeliverResponse | ErrorResponse;
}

const INTENT: Partial<Record<CapabilityId, DeliverRequest["intent"]>> = {
  "present.notify": "notify",
  "present.display": "display",
  "ask.choice": "ask",
};

export function deliverTo(d: SimDevice, capability: CapabilityId, n: number, at: string): SimDelivery {
  const intent = INTENT[capability] ?? "message";
  const request: DeliverRequest = {
    intent,
    content: intent === "ask" ? { text: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] } : { text: "Your 3pm moved to 4pm." },
    urgency: "normal",
    target: d.id,
    idempotency_key: `sim-${n}`,
  };
  const code = failureOf(d, capability);
  const event = eventRow(d, n, at, capability, {
    intent: INTENT[capability] ?? null,
    route_decision: { target: d.id, reason: "explicit_target", candidates: [d.id] },
    outcome: code ? (code === "grant_missing" || code === "confirmation_denied" ? "denied" : "error") : "ok",
    error_code: code,
    latency_ms: { api: 31, device_delivery: code ? null : 140, user_response: null },
    cost_units: code ? 0 : 1,
  });
  if (code) {
    const info = ERROR_CODE_INFO[code];
    const response: ErrorResponse = {
      error: { type: info.type, code, message: code, device_kind: d.kind, retryable: info.retryable, doc_url: errorDocUrl(code) },
    };
    return { device: d, events: [event], webhooks: [webhookOf("action.failed", { ...base(d), status: "failed", error: code }, n, at)], request, response };
  }
  const response: DeliverResponse = {
    delivery_id: `dlv_sim${n.toString(36)}`,
    routed_to: { device_id: d.id, kind: d.kind, reason: "explicit_target" },
    status: "delivered",
  };
  return { device: d, events: [event], webhooks: [webhookOf("action.completed", { ...base(d), status: "done" }, n, at)], request, response };
}

/** A sample payload for any webhook event, from this device when there is one. */
export function samplePayload(event_type: WebhookEventName, d: SimDevice | null, n: number, at: string): WebhookOutboxRow {
  const ids = d ? base(d) : { external_user_id: "user_qa_ines", connection_id: "conn_t_03", device_id: "dev_t_sim_glasses" };
  const extra: Record<string, unknown> =
    event_type === "ask.answered"
      ? { answer: "Yes" }
      : event_type === "input.utterance"
        ? { text: "What is on my calendar next?" }
        : event_type.startsWith("action.")
          ? { status: event_type === "action.completed" ? "done" : "failed" }
          : {};
  return webhookOf(event_type, { ...ids, ...extra, sample: true }, n, at);
}
