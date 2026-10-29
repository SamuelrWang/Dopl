/**
 * The webhook endpoint HTTP surface (C8): `/v1/webhook_endpoints*`, `/v1/webhook_deliveries/*`.
 * Key verification is real (fake DB); the webhook store is the in-memory fake; DNS is stubbed (no
 * network). Covers: secret shown only on create + rotate, SSRF refusals, tenancy (env + project),
 * list envelope + cursor paging, deliveries with attempts, replay.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { fakeWebhookStore } from "@/features/device-sdk/server/webhooks/fake-store";

type Fake = ReturnType<typeof fakeWebhookStore>;
const g = vi.hoisted(() => globalThis as unknown as { __whFake: Fake });

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});
vi.mock("@/features/device-sdk/server/webhooks/store-supabase", async () => {
  const m = await import("@/features/device-sdk/server/webhooks/fake-store");
  g.__whFake = m.fakeWebhookStore();
  return { supabaseWebhookStore: g.__whFake.store };
});
vi.mock("node:dns", () => ({
  lookup: (host: string, _o: unknown, cb: (e: Error | null, a: Array<{ address: string; family: number }>) => void) =>
    cb(null, [{ address: host.startsWith("private.") ? "10.0.0.7" : "93.184.216.34", family: 4 }]),
}));

import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import { ErrorResponseSchema } from "@/features/device-sdk/types";
import {
  ListQuerySchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema,
  WebhookEndpointWithSecretSchema,
  listResponseSchema,
} from "@dopl/device-contracts";
import { GET as listEndpoints, POST as createEndpoint } from "./route";
import { DELETE as deleteEndpoint, GET as getEndpoint, PATCH as patchEndpoint } from "./[id]/route";
import { POST as rotate } from "./[id]/rotate_secret/route";
import { GET as listDeliveries } from "./[id]/deliveries/route";
import { GET as getDelivery } from "../webhook_deliveries/[id]/route";
import { POST as replay } from "../webhook_deliveries/[id]/replay/route";

const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const req = (path: string, key: string | null, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

let sk: string;
let skLive: string;
let skOther: string;
let pk: string;

beforeEach(async () => {
  resetFakeStore();
  g.__whFake.endpoints.length = 0;
  g.__whFake.deliveries.length = 0;
  g.__whFake.attempts.length = 0;
  g.__whFake.outbox.length = 0;
  fakeStore.projects.set(P, { id: P, org_id: "org-1", api_version: "2026-10-27" });
  fakeStore.projects.set(Q, { id: Q, org_id: "org-2", api_version: "2026-10-27" });
  sk = (await mintApiKey({ projectId: P, env: "test", kind: "secret" })).secret;
  skLive = (await mintApiKey({ projectId: P, env: "live", kind: "secret" })).secret;
  skOther = (await mintApiKey({ projectId: Q, env: "test", kind: "secret" })).secret;
  pk = (await mintApiKey({ projectId: P, env: "test", kind: "publishable" })).secret;
});

async function create(key = sk, body: unknown = { url: "https://hooks.example.com/dopl", description: "prod" }) {
  return createEndpoint(req("/api/v1/webhook_endpoints", key, { method: "POST", body }), ctx());
}

describe("webhook endpoint routes", () => {
  it("✅ create answers 201 with the secret once; reads never show it", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const created = WebhookEndpointWithSecretSchema.parse(await res.json());
    expect(created).toMatchObject({ url: "https://hooks.example.com/dopl", status: "enabled", livemode: false, enabled_events: null });
    expect(created.secret).toMatch(/^whsec_/);
    expect(g.__whFake.endpoints[0].secret).toBe(created.secret);

    const got = await (await getEndpoint(req(`/api/v1/webhook_endpoints/${created.id}`, sk), ctx({ id: created.id }))).json();
    expect(WebhookEndpointSchema.strict().parse(got)).not.toHaveProperty("secret");
    const list = await (await listEndpoints(req("/api/v1/webhook_endpoints", sk), ctx())).json();
    expect(JSON.stringify(list)).not.toContain(created.secret);
  });

  it.each([
    [{ url: "http://hooks.example.com/x" }, "url: url must use https"],
    [{ url: "https://10.0.0.1/x" }, "url: url points at a private or reserved address"],
    [{ url: "https://private.example.com/x" }, "url: url resolves to a private or reserved address"],
    [{ url: "https://ok.example.com/x", enabled_events: ["nope"] }, "enabled_events.0"],
    [{ url: "https://ok.example.com/x", extra: 1 }, ""],
    [null, ""],
  ])("🔒 refuses %j", async (body, msg) => {
    const res = await create(sk, body);
    expect(res.status).toBe(400);
    const err = ErrorResponseSchema.parse(await res.json());
    expect(err.error.code).toBe("invalid_request");
    expect(err.error.message).toContain(msg);
  });

  it("🔒 publishable keys and missing keys are refused", async () => {
    expect((await create(pk)).status).toBe(403);
    expect((await listEndpoints(req("/api/v1/webhook_endpoints", null), ctx())).status).toBe(401);
  });

  it("🔒 tenancy: another env or project sees 404, never the row", async () => {
    const { id } = await (await create()).json();
    for (const key of [skLive, skOther]) {
      expect((await getEndpoint(req(`/api/v1/webhook_endpoints/${id}`, key), ctx({ id }))).status).toBe(404);
      expect((await patchEndpoint(req(`/api/v1/webhook_endpoints/${id}`, key, { method: "PATCH", body: { disabled: true } }), ctx({ id }))).status).toBe(404);
      expect((await rotate(req(`/api/v1/webhook_endpoints/${id}/rotate_secret`, key, { method: "POST", body: {} }), ctx({ id }))).status).toBe(404);
      expect((await deleteEndpoint(req(`/api/v1/webhook_endpoints/${id}`, key, { method: "DELETE" }), ctx({ id }))).status).toBe(404);
      const list = await (await listEndpoints(req("/api/v1/webhook_endpoints", key), ctx())).json();
      expect(list.data).toEqual([]);
    }
    expect((await getEndpoint(req(`/api/v1/webhook_endpoints/not-a-uuid`, sk), ctx({ id: "not-a-uuid" }))).status).toBe(404);
  });

  it("list = { data, next_cursor, has_more } with cursor paging, newest first", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await (await create(sk, { url: `https://h${i}.example.com/x` })).json()).id);
    const schema = listResponseSchema(WebhookEndpointSchema);
    const p1 = schema.parse(await (await listEndpoints(req("/api/v1/webhook_endpoints?limit=2", sk), ctx())).json());
    expect(p1.data.map((e) => e.id)).toEqual([ids[2], ids[1]]);
    expect(p1.has_more).toBe(true);
    const p2 = schema.parse(
      await (await listEndpoints(req(`/api/v1/webhook_endpoints?limit=2&cursor=${p1.next_cursor}`, sk), ctx())).json()
    );
    expect(p2).toMatchObject({ has_more: false, next_cursor: null });
    expect(p2.data.map((e) => e.id)).toEqual([ids[0]]);
    expect(ListQuerySchema.parse({}).limit).toBe(50);
    const bad = await listEndpoints(req("/api/v1/webhook_endpoints?cursor=Zm9v", sk), ctx());
    expect(bad.status).toBe(400);
  });

  it("PATCH updates url (re-checked), events, disabled; DELETE removes", async () => {
    const { id } = await (await create()).json();
    const patch = (body: unknown) => patchEndpoint(req(`/api/v1/webhook_endpoints/${id}`, sk, { method: "PATCH", body }), ctx({ id }));
    expect((await patch({ url: "https://private.example.com/x" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const up = await (await patch({ enabled_events: ["action.completed", "action.completed"], disabled: true })).json();
    expect(up).toMatchObject({ enabled_events: ["action.completed"], status: "disabled" });
    expect((await (await patch({ disabled: false })).json()).status).toBe("enabled");
    const del = await deleteEndpoint(req(`/api/v1/webhook_endpoints/${id}`, sk, { method: "DELETE" }), ctx({ id }));
    expect(await del.json()).toEqual({ id, deleted: true });
    expect((await getEndpoint(req(`/api/v1/webhook_endpoints/${id}`, sk), ctx({ id }))).status).toBe(404);
  });

  it("✅ rotate answers a NEW secret once, keeps the old one for the overlap", async () => {
    const created = await (await create()).json();
    const res = await rotate(req(`/api/v1/webhook_endpoints/${created.id}/rotate_secret`, sk, { method: "POST", body: { overlap_seconds: 600 } }), ctx({ id: created.id }));
    const rotated = WebhookEndpointWithSecretSchema.parse(await res.json());
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.previous_secret_expires_at).not.toBeNull();
    expect(g.__whFake.endpoints[0]).toMatchObject({ secret: rotated.secret, previous_secret: created.secret });
    const bad = await rotate(req(`/api/v1/webhook_endpoints/${created.id}/rotate_secret`, sk, { method: "POST", body: { overlap_seconds: 999_999_999 } }), ctx({ id: created.id }));
    expect(bad.status).toBe(400);
  });

  it("deliveries list + one delivery with attempts + replay", async () => {
    const { id } = await (await create()).json();
    const f = g.__whFake;
    f.enqueue({ projectId: P, env: "test" }, "connection.created");
    await f.store.fanOut(10);
    const d = f.deliveries[0];
    await f.store.recordAttempt(d.id, { statusCode: 500, error: "HTTP 500", durationMs: 9, responseBody: "oops", success: false, nextAttemptAt: null });

    const list = listResponseSchema(WebhookDeliverySchema).parse(
      await (await listDeliveries(req(`/api/v1/webhook_endpoints/${id}/deliveries`, sk), ctx({ id }))).json()
    );
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ status: "failed", attempt_count: 1, message_id: `msg_${d.id}`, event_type: "connection.created", next_attempt_at: null });
    expect(list.data[0].attempts).toBeUndefined();

    const one = WebhookDeliverySchema.parse(await (await getDelivery(req(`/api/v1/webhook_deliveries/${d.id}`, sk), ctx({ id: d.id }))).json());
    expect(one.attempts).toEqual([expect.objectContaining({ attempt: 1, status_code: 500, response_body: "oops", duration_ms: 9 })]);

    const r = await replay(req(`/api/v1/webhook_deliveries/${d.id}/replay`, sk, { method: "POST" }), ctx({ id: d.id }));
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ status: "pending", attempt_count: 0 });

    // Tenancy on deliveries.
    expect((await getDelivery(req(`/api/v1/webhook_deliveries/${d.id}`, skOther), ctx({ id: d.id }))).status).toBe(404);
    expect((await replay(req(`/api/v1/webhook_deliveries/${d.id}/replay`, skLive, { method: "POST" }), ctx({ id: d.id }))).status).toBe(404);
    expect((await listDeliveries(req(`/api/v1/webhook_endpoints/${id}/deliveries`, skOther), ctx({ id }))).status).toBe(404);

    // Replay refuses while the endpoint is disabled.
    await patchEndpoint(req(`/api/v1/webhook_endpoints/${id}`, sk, { method: "PATCH", body: { disabled: true } }), ctx({ id }));
    expect((await replay(req(`/api/v1/webhook_deliveries/${d.id}/replay`, sk, { method: "POST" }), ctx({ id: d.id }))).status).toBe(400);
  });
});
