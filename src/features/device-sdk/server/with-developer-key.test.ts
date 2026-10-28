/**
 * `withDeveloperKey`: Bearer parse → verify → publishable gate → scopes, every refusal in the
 * C10 shape (validated against the contracts' own `ErrorResponseSchema`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ErrorResponseSchema } from "../types";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("./fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { fakeStore, resetFakeStore } from "./fake-dev-db";
import { mintApiKey, resetLastUsedThrottleForTests, revokeApiKey } from "./keys";
import { readBearer, withDeveloperKey } from "./with-developer-key";
import { devSdkError } from "./errors";
import { flushDevEvents, setDevEventSinkForTests } from "./events";
import type { DeviceEventRow } from "../types";

let events: DeviceEventRow[] = [];
const logged = async () => {
  await flushDevEvents();
  return events;
};

const PROJECT = "proj-1";
const ctx = { params: Promise.resolve({}) };
const req = (auth?: string) =>
  new NextRequest("http://localhost/api/v1/x", { headers: auth ? { authorization: auth } : {} });

const ok = vi.fn(async (_r: NextRequest, c: { projectId: string }) => NextResponse.json({ project: c.projectId }));

async function expectC10(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorResponseSchema.parse(body).error.code).toBe(code);
  return body;
}

beforeEach(() => {
  events = [];
  setDevEventSinkForTests({ write: async (rows) => void events.push(...rows) });
  resetFakeStore();
  resetLastUsedThrottleForTests();
  ok.mockClear();
  fakeStore.projects.set(PROJECT, { id: PROJECT, org_id: "org-1", api_version: "2026-10-27" });
});

describe("readBearer", () => {
  it("parses a Bearer header, case-insensitively, and nothing else", () => {
    expect(readBearer(req("Bearer sk_test_x"))).toBe("sk_test_x");
    expect(readBearer(req("bearer sk_test_x"))).toBe("sk_test_x");
    expect(readBearer(req("Basic abc"))).toBeNull();
    expect(readBearer(req("Bearer a b"))).toBeNull();
    expect(readBearer(req())).toBeNull();
  });
});

describe("withDeveloperKey", () => {
  it("401 unauthenticated (C10) with no key, and never reaches the handler", async () => {
    const res = await withDeveloperKey(ok, { scopes: [] })(req(), ctx);
    const body = await expectC10(res, 401, "unauthenticated");
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.doc_url).toBe("https://www.usedopl.com/docs/errors/unauthenticated");
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(ok).not.toHaveBeenCalled();
  });

  it("401 for an unknown key, without echoing it", async () => {
    const raw = "sk_live_" + "A".repeat(32);
    const res = await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${raw}`), ctx);
    const body = await expectC10(res, 401, "unauthenticated");
    expect(JSON.stringify(body)).not.toContain(raw);
  });

  it("401 for a revoked key", async () => {
    const { secret, key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    await revokeApiKey({ projectId: PROJECT, keyId: key.id });
    const body = await expectC10(await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${secret}`), ctx), 401, "unauthenticated");
    expect(body.error.message).toMatch(/revoked/);
  });

  it("401 for an expired key", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    fakeStore.keys[0].expires_at = new Date(Date.now() - 1).toISOString();
    const body = await expectC10(await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${secret}`), ctx), 401, "unauthenticated");
    expect(body.error.message).toMatch(/expired/);
  });

  it("403 insufficient_scope when the key lacks a required scope", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret", scopes: ["devices:read"] });
    const res = await withDeveloperKey(ok, { scopes: ["actions:write"] })(req(`Bearer ${secret}`), ctx);
    const body = await expectC10(res, 403, "insufficient_scope");
    expect(body.error.type).toBe("permission_error");
    expect(body.error.message).toContain("actions:write");
    expect(ok).not.toHaveBeenCalled();
  });

  it("passes a key that carries every required scope, with the resolved context", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret", scopes: ["devices:read", "actions:write"] });
    const res = await withDeveloperKey(ok, { scopes: ["devices:read", "actions:write"] })(req(`Bearer ${secret}`), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: PROJECT });
  });

  it("refuses a publishable key on a route that did not opt in", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "publishable" });
    await expectC10(await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${secret}`), ctx), 403, "insufficient_scope");
    await expectC10(await withDeveloperKey(ok, { scopes: ["connect"] })(req(`Bearer ${secret}`), ctx), 403, "insufficient_scope");
    expect(ok).not.toHaveBeenCalled();
  });

  it("admits a publishable key only on a `connect` route that opts in", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "live", kind: "publishable" });
    const res = await withDeveloperKey(ok, { scopes: ["connect"], publishable: true })(req(`Bearer ${secret}`), ctx);
    expect(res.status).toBe(200);
    expect(() => withDeveloperKey(ok, { scopes: ["devices:read"], publishable: true })).toThrow(/connect/);
    expect(() => withDeveloperKey(ok, { scopes: [], publishable: true })).toThrow(/connect/);
  });

  it("bumps last_used_at without awaiting it, at most once a minute per key", async () => {
    const { secret, key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    const handler = withDeveloperKey(ok, { scopes: [] });
    await handler(req(`Bearer ${secret}`), ctx);
    await handler(req(`Bearer ${secret}`), ctx);
    await new Promise((r) => setTimeout(r, 0));
    const touches = fakeStore.updates.filter((u) => "last_used_at" in u.patch);
    expect(touches).toHaveLength(1);
    expect(touches[0].filters).toEqual([["id", key.id]]);
  });
});

describe("withDeveloperKey — the C8 event row (A2)", () => {
  const secretKey = async () => (await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" })).secret;

  it("passes a handler's route_decision and annotations through to the one row", async () => {
    const secret = await secretKey();
    const decision = { target: "auto", reason: "only online device", candidates: ["dev-1", "dev-2"] };
    const handler = withDeveloperKey(
      async (_r, c) => {
        c.event.setRouteDecision(decision);
        c.event.annotate({ device_id: "dev-1", device_kind: "glasses", capability: "present.display", latency_ms: { device_delivery: 40 } });
        return NextResponse.json({ ok: true });
      },
      { scopes: [] }
    );
    expect((await handler(req(`Bearer ${secret}`), ctx)).status).toBe(200);
    const rows = await logged();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      route_decision: decision,
      device_id: "dev-1",
      device_kind: "glasses",
      capability: "present.display",
      outcome: "ok",
    });
    expect(rows[0].latency_ms.device_delivery).toBe(40);
    expect(rows[0].latency_ms.api).toBeGreaterThanOrEqual(0);
  });

  it("records a handler's own C10 error code, without reading the body", async () => {
    const secret = await secretKey();
    const handler = withDeveloperKey(async () => devSdkError("device_offline", "offline"), { scopes: [] });
    expect((await handler(req(`Bearer ${secret}`), ctx)).status).toBe(409);
    expect(await logged()).toEqual([expect.objectContaining({ outcome: "error", error_code: "device_offline" })]);
  });

  it("logs one `denied` row for a revoked key (its project is known) and one for a missing scope", async () => {
    const { secret, key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret", scopes: ["devices:read"] });
    await withDeveloperKey(ok, { scopes: ["actions:write"] })(req(`Bearer ${secret}`), ctx);
    await revokeApiKey({ projectId: PROJECT, keyId: key.id });
    await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${secret}`), ctx);
    const rows = await logged();
    expect(rows.map((r) => [r.outcome, r.error_code])).toEqual([
      ["denied", "insufficient_scope"],
      ["denied", "unauthenticated"],
    ]);
  });

  it("a handler that throws still logs exactly one `error` row, and the throw propagates", async () => {
    const secret = await secretKey();
    const handler = withDeveloperKey(async () => {
      throw new Error("kaboom");
    }, { scopes: [] });
    await expect(handler(req(`Bearer ${secret}`), ctx)).rejects.toThrow("kaboom");
    expect(await logged()).toEqual([expect.objectContaining({ outcome: "error", error_code: null })]);
  });

  it("a broken event sink never fails the call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setDevEventSinkForTests({ write: async () => Promise.reject(new Error("db down")) });
    const secret = await secretKey();
    const res = await withDeveloperKey(ok, { scopes: [] })(req(`Bearer ${secret}`), ctx);
    expect(res.status).toBe(200);
    await expect(flushDevEvents()).resolves.toBeUndefined();
  });
});
