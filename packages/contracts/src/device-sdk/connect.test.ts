import { describe, expect, it } from "vitest";

import {
  CONNECT_WEBHOOK_EVENTS,
  ConnectSessionCreateRequestSchema,
  ConnectSessionCreateResponseSchema,
  ConnectionExchangeRequestSchema,
  ConnectionExchangeResponseSchema,
  ConnectionListResponseSchema,
  ConnectionSchema,
} from "./connect.js";
import { G2_DEVICE, NOW, expectRoundTrip } from "./test-fixtures.js";

const CONNECTION = {
  id: "conn_1",
  external_user_id: "user_42",
  status: "active" as const,
  device: G2_DEVICE,
  grants: [
    { scope: "present.*" as const, granted_at: NOW, expires_at: null },
    { scope: "capture.photo" as const, granted_at: NOW, expires_at: "2026-11-27T12:00:00.000Z" },
  ],
  created_at: NOW,
  revoked_at: null,
};

describe("C2 connect", () => {
  it("round-trips session create (full and minimal)", () => {
    expectRoundTrip(ConnectSessionCreateRequestSchema, {
      external_user_id: "user_42",
      allowed_kinds: ["glasses", "phone"],
      requested_scopes: ["present.*", "ask.*"],
      redirect_uri: "https://app.example.com/connected",
      branding: { display_name: "Acme", logo_url: "https://acme.example/logo.png", accent_color: "#112233" },
    });
    expectRoundTrip(ConnectSessionCreateRequestSchema, { external_user_id: "u", requested_scopes: ["state.read"] });
    expectRoundTrip(ConnectSessionCreateResponseSchema, {
      connect_token: "ct_1",
      url: "https://connect.usedopl.com/s/ct_1",
      expires_at: NOW,
    });
  });

  it("requires external_user_id and at least one scope", () => {
    expect(ConnectSessionCreateRequestSchema.safeParse({ requested_scopes: ["state.read"] }).success).toBe(false);
    expect(ConnectSessionCreateRequestSchema.safeParse({ external_user_id: "u", requested_scopes: [] }).success).toBe(false);
  });

  it("round-trips exchange, connection and list", () => {
    expectRoundTrip(ConnectionExchangeRequestSchema, { public_token: "public-xyz" });
    expectRoundTrip(ConnectionExchangeResponseSchema, { connection_id: "conn_1", device: G2_DEVICE });
    expectRoundTrip(ConnectionSchema, CONNECTION);
    expectRoundTrip(ConnectionListResponseSchema, { data: [CONNECTION, { ...CONNECTION, status: "revoked", revoked_at: NOW }] });
  });

  it("webhook names are the spec's five", () => {
    expect(CONNECT_WEBHOOK_EVENTS).toEqual([
      "connection.created",
      "connection.revoked",
      "connection.needs_reauth",
      "device.offline",
      "device.online",
    ]);
  });
});
