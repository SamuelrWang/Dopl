import { describe, expect, it } from "vitest";

import {
  ACTION_STATUSES,
  ActionSchema,
  DeliverRequestSchema,
  DeliverResponseSchema,
  DeviceActionRequestSchema,
  DeviceActionResponseSchema,
} from "./actions.js";
import { errorDocUrl } from "./errors.js";
import { NOW, expectRoundTrip } from "./test-fixtures.js";

describe("C4 actions", () => {
  it("status enum includes needs_confirmation", () => {
    expect(ACTION_STATUSES).toEqual(["queued", "delivered", "done", "failed", "needs_confirmation"]);
  });

  it("round-trips deliver for each intent and target form", () => {
    expectRoundTrip(DeliverRequestSchema, {
      intent: "message",
      content: { text: "Your 3pm moved to 4pm." },
      urgency: "normal",
      idempotency_key: "idem-1",
    });
    expectRoundTrip(DeliverRequestSchema, {
      intent: "ask",
      content: { text: "Reschedule?", options: [{ label: "Yes", recommended: true }, { label: "No" }] },
      urgency: "high",
      target: "auto",
      profile: "my-glasses",
      idempotency_key: "idem-2",
    });
    expectRoundTrip(DeliverRequestSchema, {
      intent: "display",
      content: { blocks: [{ id: "h", type: "heading", text: "Today" }] },
      urgency: "low",
      target: "glasses",
      idempotency_key: "idem-3",
    });
    expectRoundTrip(DeliverRequestSchema, {
      intent: "notify",
      content: { text: "Done" },
      urgency: "low",
      target: "dev_123",
      idempotency_key: "idem-4",
    });
  });

  it("rejects deliver without idempotency_key, empty content or a bad intent", () => {
    const base = { intent: "message", content: { text: "x" }, urgency: "normal", idempotency_key: "k" };
    expect(DeliverRequestSchema.safeParse({ ...base, idempotency_key: undefined }).success).toBe(false);
    expect(DeliverRequestSchema.safeParse({ ...base, content: {} }).success).toBe(false);
    expect(DeliverRequestSchema.safeParse({ ...base, intent: "show" }).success).toBe(false);
  });

  it("round-trips deliver response, device action and the action poll", () => {
    expectRoundTrip(DeliverResponseSchema, {
      delivery_id: "dlv_1",
      routed_to: { device_id: "dev_123", kind: "glasses", reason: "last_message_source" },
      status: "queued",
    });
    expectRoundTrip(DeviceActionRequestSchema, { args: { level: 40 }, idempotency_key: "k" });
    expectRoundTrip(DeviceActionResponseSchema, { action_id: "act_1", status: "needs_confirmation" });
    expectRoundTrip(ActionSchema, {
      action_id: "act_1",
      device_id: "dev_123",
      capability: "act.lock",
      status: "failed",
      result: null,
      error: {
        type: "permission_error",
        code: "confirmation_denied",
        message: "The user declined.",
        retryable: false,
        doc_url: errorDocUrl("confirmation_denied"),
      },
      created_at: NOW,
      updated_at: NOW,
    });
  });
});
