import { describe, expect, it } from "vitest";

import {
  DeviceEventRowSchema,
  EVENT_ROW_FIELDS,
  EventListResponseSchema,
  PRIVATE_EVENT_FIELDS,
  PublicDeviceEventSchema,
  WEBHOOK_EVENT_NAMES,
  toPublicDeviceEvent,
} from "./events.js";
import { NOW, expectRoundTrip } from "./test-fixtures.js";

/** Spec v1 › C8, in order; `profile_id@version` and `bytes_in/out` split into columns. */
const SPEC_FIELDS = [
  "event_id", "ts", "org_id", "project_id", "env", "external_user_id", "connection_id",
  "device_id", "device_kind", "vendor", "model", "firmware", "adapter_version",
  "capability", "intent", "route_decision", "profile_id", "profile_version",
  "risk_tier", "confirmation", "outcome", "error_code",
  "latency_ms", "bytes_in", "bytes_out", "cost_units",
];

const ROW = {
  event_id: "evt_1",
  ts: NOW,
  org_id: "org_1",
  project_id: "proj_1",
  env: "test" as const,
  external_user_id: "user_42",
  connection_id: "conn_1",
  device_id: "dev_123",
  device_kind: "glasses" as const,
  vendor: "even_realities",
  model: "even_g2",
  firmware: "1.4.2",
  adapter_version: "0.3.0",
  capability: "present.display" as const,
  intent: "display" as const,
  route_decision: { target: "auto", reason: "last_message_source", candidates: ["dev_123", "dev_9"] },
  profile_id: "glasses-default",
  profile_version: 2,
  risk_tier: "T1" as const,
  confirmation: { required: false, result: null },
  outcome: "ok" as const,
  error_code: null,
  latency_ms: { api: 42, device_delivery: 310, user_response: null },
  bytes_in: 512,
  bytes_out: 128,
  cost_units: 1,
};

describe("C8 events", () => {
  it("event row fields are exactly the spec's, in order", () => {
    expect(EVENT_ROW_FIELDS).toEqual(SPEC_FIELDS);
  });

  it("round-trips a full row and a device-less failure row", () => {
    expectRoundTrip(DeviceEventRowSchema, ROW);
    expectRoundTrip(DeviceEventRowSchema, {
      ...ROW,
      connection_id: null, device_id: null, device_kind: null, vendor: null, model: null, firmware: null,
      adapter_version: null, capability: null, route_decision: null, profile_id: null, profile_version: null,
      risk_tier: null, confirmation: null, outcome: "error", error_code: "grant_missing",
      latency_ms: { api: 3, device_delivery: null, user_response: null },
    });
  });

  it("webhook names cover C2 and C8", () => {
    expect([...WEBHOOK_EVENT_NAMES].sort()).toEqual(
      [
        "connection.created", "connection.revoked", "connection.needs_reauth",
        "device.online", "device.offline", "action.completed", "action.failed",
        "ask.answered", "input.utterance",
      ].sort(),
    );
  });

  it("the public event is the row minus exactly the private fields, in row order", () => {
    expect(Object.keys(PublicDeviceEventSchema.shape)).toEqual(
      EVENT_ROW_FIELDS.filter((f) => !(PRIVATE_EVENT_FIELDS as readonly string[]).includes(f))
    );
  });

  it("toPublicDeviceEvent drops org, bytes and cost and keeps the rest", () => {
    const pub = toPublicDeviceEvent(ROW);
    for (const f of PRIVATE_EVENT_FIELDS) expect(pub).not.toHaveProperty(f);
    expectRoundTrip(PublicDeviceEventSchema, pub);
    expect(pub.route_decision).toEqual(ROW.route_decision);
  });

  it("an event page uses the list envelope", () => {
    const page = { data: [toPublicDeviceEvent(ROW)], next_cursor: null, has_more: false };
    expect(EventListResponseSchema.parse(page)).toEqual(page);
  });
});
