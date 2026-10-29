import { describe, expect, it } from "vitest";
import {
  WebhookEndpointCreateRequestSchema,
  WebhookEndpointUpdateRequestSchema,
  WebhookEventEnvelopeSchema,
  WebhookSecretRotateRequestSchema,
} from "./webhooks";

describe("webhook contracts", () => {
  it("envelope = { id, type, api_version?, timestamp, livemode, data }", () => {
    const ok = {
      id: "evt_0b3f2c1e-1111-4111-8111-111111111111",
      type: "action.completed",
      api_version: "2026-10-28",
      timestamp: "2026-10-28T12:00:00.000Z",
      livemode: false,
      data: { action_id: "a" },
    };
    expect(WebhookEventEnvelopeSchema.parse(ok)).toEqual(ok);
    // Unknown types pass (consumers must tolerate new names).
    expect(WebhookEventEnvelopeSchema.safeParse({ ...ok, type: "future.thing" }).success).toBe(true);
    expect(WebhookEventEnvelopeSchema.safeParse({ ...ok, id: "act_1" }).success).toBe(false);
  });

  it("create is strict; events must be known names", () => {
    expect(WebhookEndpointCreateRequestSchema.safeParse({ url: "https://x.example/h" }).success).toBe(true);
    expect(WebhookEndpointCreateRequestSchema.safeParse({ url: "https://x.example/h", secret: "whsec_x" }).success).toBe(false);
    expect(WebhookEndpointCreateRequestSchema.safeParse({ url: "https://x.example/h", enabled_events: [] }).success).toBe(false);
    expect(WebhookEndpointCreateRequestSchema.safeParse({ url: "https://x.example/h", enabled_events: ["x.y"] }).success).toBe(false);
  });

  it("update needs one field; rotate overlap defaults to 24h, max 7d", () => {
    expect(WebhookEndpointUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(WebhookEndpointUpdateRequestSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(WebhookSecretRotateRequestSchema.parse({})).toEqual({ overlap_seconds: 86400 });
    expect(WebhookSecretRotateRequestSchema.safeParse({ overlap_seconds: 604801 }).success).toBe(false);
  });
});
