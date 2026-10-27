/**
 * The DEVICE TYPES the Dopl SDK lets an agent product become compatible with: the adapter registry
 * (`features/device-sdk/adapters/registry.ts`) plus the types on the way. A type with an `adapter_id`
 * gets its capabilities from that adapter's C3 descriptors (`./device-descriptors.ts`, server side).
 *
 * `simulate` answers a capability test the way the simulator would in test mode, computed locally
 * (nothing is sent): the request is the real `/v1` call, typed with `@dopl/contracts/device-sdk`.
 */
import type {
  Action,
  CapabilityDescriptor,
  CapabilityId,
  CapabilityScope,
  DeliverIntent,
  DeliverRequest,
  DeliverResponse,
  DeviceActionRequest,
  DeviceContext,
  DeviceKind,
  WebhookEventName,
} from "@dopl/contracts/device-sdk";
import { CAPABILITY_FAMILY } from "@dopl/contracts/device-sdk";
import { DEMO_NOW } from "./fixtures";
import type { CapabilityTest, TypeState } from "./device-type-status";
import { NOT_CONNECTED, recordTests } from "./device-type-status";

export type Availability = "available" | "beta" | "test_only" | "coming_soon";

export interface DeviceType {
  id: string;
  name: string;
  kind: DeviceKind;
  availability: Availability;
  /** The registry adapter behind the type; none while it is coming soon. */
  adapter_id: string | null;
}

export const DEVICE_TYPES: readonly DeviceType[] = [
  { id: "even_g2", name: "Even G2", kind: "glasses", availability: "available", adapter_id: "even_g2" },
  { id: "desktop", name: "Desktop", kind: "desktop", availability: "beta", adapter_id: "desktop" },
  { id: "simulator", name: "Simulator", kind: "glasses", availability: "test_only", adapter_id: "simulator" },
  { id: "meta_glasses", name: "Meta glasses", kind: "glasses", availability: "coming_soon", adapter_id: null },
  { id: "mentra", name: "Mentra", kind: "glasses", availability: "coming_soon", adapter_id: null },
  { id: "home_assistant", name: "Home Assistant", kind: "home_hub", availability: "coming_soon", adapter_id: null },
  { id: "phone", name: "Phone", kind: "phone", availability: "coming_soon", adapter_id: null },
  { id: "cars", name: "Cars", kind: "vehicle", availability: "coming_soon", adapter_id: null },
  { id: "robots", name: "Robots", kind: "robot", availability: "coming_soon", adapter_id: null },
];

export const ADDABLE_TYPES = DEVICE_TYPES.filter((t) => t.adapter_id !== null);

export const deviceType = (id: string): DeviceType | null => DEVICE_TYPES.find((t) => t.id === id) ?? null;

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  beta: "Beta",
  test_only: "Test only",
  coming_soon: "Coming soon",
};

/** Where the demo account starts: one type of each status, so the catalog shows all three. */
const SEED: Partial<Record<string, "added" | "connected">> = { desktop: "added", simulator: "connected" };

/* ───────────────────────────── capability → endpoint ───────────────────────────── */

export type Endpoint =
  | { via: "deliver"; intent: DeliverIntent }
  | { via: "context" }
  | { via: "action" }
  | { via: "webhook"; event: WebhookEventName };

export function endpointFor(capability: CapabilityId): Endpoint {
  if (capability === "presence.read") return { via: "context" };
  if (capability === "present.notify") return { via: "deliver", intent: "notify" };
  if (capability === "present.display") return { via: "deliver", intent: "display" };
  if (capability.startsWith("present.")) return { via: "deliver", intent: "message" };
  if (capability.startsWith("ask.")) return { via: "deliver", intent: "ask" };
  if (capability === "input.utterance") return { via: "webhook", event: "input.utterance" };
  if (capability.startsWith("input.")) return { via: "webhook", event: "ask.answered" };
  return { via: "action" };
}

export function endpointLabel(e: Endpoint): string {
  switch (e.via) {
    case "deliver":
      return `POST /users/{external_user_id}/deliver · ${e.intent}`;
    case "context":
      return "GET /users/{external_user_id}/context";
    case "action":
      return "POST /devices/{device_id}/actions/{capability}";
    case "webhook":
      return `Webhook ${e.event}`;
  }
}

/** The Connect scopes a type's capabilities need: one `<family>.*` per family. */
export function scopesFor(capabilities: readonly CapabilityId[]): CapabilityScope[] {
  return [...new Set(capabilities.map((c) => CAPABILITY_FAMILY[c]))].map((f) => `${f}.*` as CapabilityScope);
}

/* ───────────────────────────── the simulated test ───────────────────────────── */

/** The test-mode user whose simulator answers every capability test. */
export const TEST_USER = "user_qa_ines";

const simDevice = (kind: DeviceKind) => `dev_t_sim_${kind}`;

/** A stable latency per capability, so a seeded result renders the same on server and client. */
function latencyOf(capability: string): number {
  let h = 7;
  for (const ch of capability) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 38 + (h % 140);
}

const CONTENT: Record<DeliverIntent, DeliverRequest["content"]> = {
  notify: { text: "Your 3pm moved to 4pm." },
  display: { text: "Standup in 5 min" },
  message: { text: "Your build finished." },
  ask: { text: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] },
};

/** One capability test against the simulator; passes when the call is accepted. */
export function simulate(type: DeviceType, d: CapabilityDescriptor): CapabilityTest {
  const device_id = simDevice(type.kind);
  const latency_ms = latencyOf(d.capability);
  const e = endpointFor(d.capability);
  const key = `test_${type.id}_${d.capability}`;
  let request: unknown;
  let response: unknown;
  if (e.via === "deliver") {
    const body: DeliverRequest = { intent: e.intent, content: CONTENT[e.intent], urgency: "normal", target: device_id, idempotency_key: key };
    const res: DeliverResponse = {
      delivery_id: `dlv_${key}`,
      routed_to: { device_id, kind: type.kind, reason: "explicit_target" },
      status: e.intent === "ask" ? "done" : "delivered",
    };
    request = { method: "POST", path: `/users/${TEST_USER}/deliver`, body };
    response = res;
  } else if (e.via === "context") {
    const res: DeviceContext = {
      active_device: { id: device_id, kind: type.kind, model: `simulated_${type.kind}`, last_seen_s: 2 },
      posture: "glanceable",
      available: [{ kind: type.kind, id: device_id, capabilities: [d.capability] }],
      profile: null,
      source_of_last_message: null,
    };
    request = { method: "GET", path: `/users/${TEST_USER}/context` };
    response = res;
  } else if (e.via === "action") {
    const body: DeviceActionRequest = { args: {}, idempotency_key: key };
    const res: Action = {
      action_id: `act_${key}`,
      device_id,
      capability: d.capability,
      status: "done",
      result: {},
      error: null,
      created_at: DEMO_NOW,
      updated_at: DEMO_NOW,
    };
    request = { method: "POST", path: `/devices/${device_id}/actions/${d.capability}`, body };
    response = res;
  } else {
    request = { simulator: device_id, emits: d.capability };
    response = { type: e.event, data: { external_user_id: TEST_USER, device_id, capability: d.capability } };
  }
  return { capability: d.capability, passed: true, latency_ms, request, response };
}

/** The state a type starts in; a seeded `connected` type carries a passing result per capability. */
export function seedState(id: string, descriptors: readonly CapabilityDescriptor[] | null): TypeState {
  const seed = SEED[id];
  if (!seed) return NOT_CONNECTED;
  const added: TypeState = { ...NOT_CONNECTED, status: "added" };
  const type = deviceType(id);
  if (seed === "added" || !type) return added;
  if (!descriptors) return { ...added, status: "connected" };
  return recordTests(
    added,
    descriptors.map((d) => simulate(type, d)),
    descriptors.map((d) => d.capability)
  );
}
