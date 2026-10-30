/**
 * `POST /api/developers/playground`. Auth is mocked at the wrapper; the key check is REAL
 * (`mintApiKey` / `verifyApiKey` over the dev-db fake). The properties that fail quietly:
 *  - 🔒 only a verified `sk_test_` SECRET key of the selected project runs; a live key, another
 *    project's key, a publishable key or an unknown key is refused and no handler runs;
 *  - 🔒 the project must be one of the caller's (404 otherwise);
 *  - 🔒 the raw key never comes back: the response holds it masked only;
 *  - the run reaches the real handler with the filled path, the key as Bearer, a fresh
 *    idempotency key when the body has none, and the run reports the event row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { wrapperOptions } = vi.hoisted(() => ({ wrapperOptions: [] as Array<Record<string, unknown> | undefined> }));
vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (handler: (req: NextRequest, ctx: { userId: string }) => Promise<Response>, options?: Record<string, unknown>) => {
    wrapperOptions.push(options);
    return (req: NextRequest) => handler(req, { userId: "u1" });
  },
}));

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

const listPortalProjects = vi.fn();
const getPortalEvent = vi.fn();
vi.mock("@/features/device-sdk/server/portal", () => ({
  listPortalProjects: (...a: unknown[]) => listPortalProjects(...a),
  getPortalEvent: (...a: unknown[]) => getPortalEvent(...a),
}));

type Seen = { method: string; url: string; auth: string | null; idem: string | null; body: unknown; segments: unknown };
const { seen, fakeHandler, EVENT_ID } = vi.hoisted(() => {
  const EVENT_ID = "33333333-3333-4333-8333-333333333333";
  const seen: Seen[] = [];
  const fakeHandler = async (req: NextRequest, rc: { params: Promise<Record<string, string>> }) => {
    seen.push({
      method: req.method,
      url: req.nextUrl.pathname + req.nextUrl.search,
      auth: req.headers.get("authorization"),
      idem: req.headers.get("idempotency-key"),
      body: req.method === "GET" || req.method === "DELETE" ? null : await req.json(),
      segments: await rc.params,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { "Request-Id": EVENT_ID, "content-type": "application/json" },
    });
  };
  return { seen, fakeHandler, EVENT_ID };
});
vi.mock("./dispatch", async () => {
  const { PLAYGROUND_OPS } = await import("@/features/device-sdk/portal/playground-ops");
  const real = await vi.importActual<typeof import("./dispatch")>("./dispatch");
  return {
    PLAYGROUND_DISPATCH: Object.fromEntries(
      PLAYGROUND_OPS.map((op) => [op.id, { handler: fakeHandler, segments: real.PLAYGROUND_DISPATCH[op.id].segments }])
    ),
  };
});

import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import { POST } from "./route";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const run = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://x/api/developers/playground", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  });

const project = (id: string) => ({ id, name: id, apiVersion: "2026-10-27", org: { id: "o", name: "o", internal: false }, role: "developer" });

let testKey: string;

beforeEach(async () => {
  vi.clearAllMocks();
  seen.length = 0;
  resetFakeStore();
  for (const id of [P1, P2]) fakeStore.projects.set(id, { id, org_id: "org-1", api_version: "2026-10-27" });
  testKey = (await mintApiKey({ projectId: P1, env: "test", kind: "secret", scopes: ["actions:write"] })).secret;
  listPortalProjects.mockResolvedValue([project(P1)]);
  getPortalEvent.mockResolvedValue({ event_id: EVENT_ID, outcome: "ok" });
});

describe("POST /api/developers/playground", () => {
  it("🔒 is sessionOnly: an agent token never runs a call", () => {
    expect(wrapperOptions).toContainEqual(expect.objectContaining({ sessionOnly: true }));
  });

  it("runs the real handler with the key, path and a fresh idempotency key; masks the key", async () => {
    const res = await run({
      project_id: P1,
      key: testKey,
      operation: "deliver",
      path_params: { external_user_id: "usr_1" },
      body: { intent: "display", content: { text: "hi" } },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(testKey);
    const out = JSON.parse(text);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "/api/v1/users/usr_1/deliver",
      auth: `Bearer ${testKey}`,
      segments: { external_user_id: "usr_1" },
    });
    expect(seen[0].idem).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].body).toMatchObject({ intent: "display", idempotency_key: seen[0].idem });

    expect(out.request.authorization).toBe(`Bearer ${testKey.slice(0, 8)}…${testKey.slice(-4)}`);
    expect(out.response).toMatchObject({ status: 202, requestId: EVENT_ID, body: { ok: true } });
    expect(out.event).toEqual({ event_id: EVENT_ID, outcome: "ok" });
    expect(getPortalEvent).toHaveBeenCalledWith(EVENT_ID, [P1]);
  });

  it("maps getDevice's {id} onto the route folder's device_id and forwards query", async () => {
    await run({ project_id: P1, key: testKey, operation: "getDevice", path_params: { id: "dev_9" } });
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/v1/devices/dev_9", segments: { device_id: "dev_9" } });
    await run({ project_id: P1, key: testKey, operation: "listEvents", query: { limit: "5", outcome: "" } });
    expect(seen[1].url).toBe("/api/v1/events?limit=5");
  });

  it("🔒 refuses a live key, a publishable key, another project's key and an unknown key", async () => {
    const live = (await mintApiKey({ projectId: P1, env: "live", kind: "secret", scopes: ["actions:write"] })).secret;
    const other = (await mintApiKey({ projectId: P2, env: "test", kind: "secret", scopes: ["actions:write"] })).secret;
    const pk = (await mintApiKey({ projectId: P1, env: "test", kind: "publishable", scopes: ["connect"] })).secret;
    const cases: Array<[string, number]> = [
      [live, 400],
      [pk, 400],
      [other, 403],
      ["sk_test_" + "0".repeat(24), 403],
    ];
    for (const [key, status] of cases) {
      const res = await run({ project_id: P1, key, operation: "getContext", path_params: { external_user_id: "u" } });
      expect(res.status, key.slice(0, 8)).toBe(status);
      expect(await res.text()).not.toContain(key);
    }
    expect(seen).toEqual([]);
  });

  it("🔒 a project the caller cannot see is 404 and runs nothing", async () => {
    listPortalProjects.mockResolvedValue([project(P2)]);
    const res = await run({ project_id: P1, key: testKey, operation: "getContext", path_params: { external_user_id: "u" } });
    expect(res.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("refuses an unknown operation, a bad path value, an unoffered query and a non-object body", async () => {
    const base = { project_id: P1, key: testKey };
    for (const [body, status] of [
      [{ ...base, operation: "testReset" }, 400],
      [{ ...base, operation: "getDevice", path_params: { id: "../keys" } }, 400],
      [{ ...base, operation: "getDevice", path_params: { id: "d" }, query: { limit: "5" } }, 400],
      [{ ...base, operation: "deliver", path_params: { external_user_id: "u" }, body: [1] }, 400],
      [{ ...base, operation: "deliver", path_params: { external_user_id: "u" } }, 400],
    ] as const) {
      expect((await run(body as Record<string, unknown>)).status).toBe(status);
    }
    expect(seen).toEqual([]);
  });
});
