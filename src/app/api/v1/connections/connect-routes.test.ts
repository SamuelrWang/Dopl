/**
 * The Connect HTTP surface (C2, openapi.yaml): `/v1/connect_sessions`, `/v1/connections/exchange`,
 * `/v1/users/{id}/connections`, `/v1/connections/{id}`, and the hosted page's
 * `/api/connect/{token}/{step}`. Key verification is real (fake DB); the Connect store is the
 * in-memory fake. Covers the C1 rule: `pk_` creates sessions and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { createFakeConnectStore } from "@/features/device-sdk/server/connect/fake-connect-store";

type Fake = ReturnType<typeof createFakeConnectStore>;
const g = vi.hoisted(() => globalThis as unknown as { __connectFake: Fake });

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});
vi.mock("@/features/device-sdk/server/connect/store", async () => {
  const m = await import("@/features/device-sdk/server/connect/fake-connect-store");
  g.__connectFake = m.createFakeConnectStore();
  return { connectStore: g.__connectFake.store };
});
vi.mock("@/features/device-sdk/server/connect/pairing-port", () => ({
  connectPairingPort: { claimPairing: async () => false, sdkDeviceFor: async () => null, setTokenHash: async () => {} },
}));
vi.mock("@/shared/auth/mcp-session", () => ({ checkAndRecordRateLimitSubject: async () => true }));

import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import { ErrorResponseSchema } from "@/features/device-sdk/types";
import { PUBLIC_ROUTES, SELF_AUTH_ROUTES } from "@/shared/auth/public-routes";
import { POST as createSession } from "../connect_sessions/route";
import { POST as exchange } from "./exchange/route";
import { DELETE as revoke } from "./[id]/route";
import { GET as list } from "../users/[external_user_id]/connections/route";
import { POST as step } from "../../connect/[token]/[step]/route";

const P = "11111111-1111-4111-8111-111111111111";
const ctx = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
const req = (path: string, key: string | null, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

let sk: string;
let pk: string;

beforeEach(async () => {
  resetFakeStore();
  fakeStore.projects.set(P, { id: P, org_id: "org-1", api_version: "2026-10-27" });
  sk = (await mintApiKey({ projectId: P, env: "test", kind: "secret" })).secret;
  pk = (await mintApiKey({ projectId: P, env: "test", kind: "publishable" })).secret;
});

async function newSession(key: string, body: unknown = { external_user_id: "user-7", requested_scopes: ["present.*"], redirect_uri: "https://dev.example/cb" }) {
  return createSession(req("/api/v1/connect_sessions", key, { method: "POST", body }), ctx());
}

describe("Connect routes", () => {
  it("full flow over HTTP: pk_ creates → page pairs + consents → sk_ exchanges, lists, revokes", async () => {
    const created = await newSession(pk);
    expect(created.status).toBe(201);
    const { connect_token, url } = await created.json();
    expect(url).toBe(`http://localhost/connect/${connect_token}`);

    const page = (s: string, body: unknown) => step(req(`/api/connect/${connect_token}/${s}`, null, { method: "POST", body }), ctx({ token: connect_token, step: s }));
    expect(await (await page("pair", { adapter_id: "simulator", kind: "phone" })).json()).toMatchObject({ method: "display_code", code: "SIM234" });
    expect((await page("claim", { adapter_id: "simulator", kind: "phone", code: "SIM234" })).status).toBe(200);
    const consent = await (await page("consent", { scopes: ["present.*"] })).json();
    const publicToken = new URL(consent.redirect_url).searchParams.get("public_token");

    const ex = await exchange(req("/api/v1/connections/exchange", sk, { method: "POST", body: { public_token: publicToken } }), ctx());
    expect(ex.status).toBe(200);
    const { connection_id, device } = await ex.json();
    expect(device.adapter_id).toBe("simulator");

    const listed = await (await list(req("/api/v1/users/user-7/connections", sk), ctx({ external_user_id: "user-7" }))).json();
    expect(listed.data.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual([[connection_id, "active"]]);

    const del = await revoke(req(`/api/v1/connections/${connection_id}`, sk, { method: "DELETE" }), ctx({ id: connection_id }));
    expect((await del.json()).status).toBe("revoked");
    const after = await (await list(req("/api/v1/users/user-7/connections", sk), ctx({ external_user_id: "user-7" }))).json();
    expect(after.data[0].status).toBe("revoked");
    expect(g.__connectFake.outbox.map((o) => o.event_type)).toEqual(["connection.created", "connection.revoked"]);
  });

  it("🔒 pk_ is refused on every Connect route except connect_sessions (C1)", async () => {
    const calls = [
      exchange(req("/api/v1/connections/exchange", pk, { method: "POST", body: { public_token: "x" } }), ctx()),
      list(req("/api/v1/users/u/connections", pk), ctx({ external_user_id: "u" })),
      revoke(req("/api/v1/connections/x", pk, { method: "DELETE" }), ctx({ id: "x" })),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("insufficient_scope");
    }
    expect((await newSession(sk)).status).toBe(201);
  });

  it("answers errors in the C10 shape", async () => {
    const bad = await newSession(sk, { external_user_id: "u" });
    expect(bad.status).toBe(400);
    expect(ErrorResponseSchema.parse(await bad.json()).error.code).toBe("invalid_request");
    const missing = await list(req("/api/v1/users/nobody/connections", sk), ctx({ external_user_id: "nobody" }));
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(await missing.json()).error.code).toBe("not_found");
    const noKey = await newSession("");
    expect(noKey.status).toBe(401);
    const unknownStep = await step(req("/api/connect/ct_x/hack", null, { method: "POST", body: {} }), ctx({ token: "ct_x", step: "hack" }));
    expect(unknownStep.status).toBe(404);
  });

  it("🔒 the hosted page and its step routes are reachable signed-out", () => {
    for (const path of ["/connect/ct_abc", "/api/connect/ct_abc/claim"]) {
      expect(PUBLIC_ROUTES.some((r) => path.startsWith(r)), path).toBe(true);
    }
    expect(SELF_AUTH_ROUTES.some((r) => "/api/connect/ct_abc/claim".startsWith(r))).toBe(true);
  });
});
