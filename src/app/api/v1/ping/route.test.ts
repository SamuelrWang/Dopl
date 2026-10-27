/**
 * `GET /api/v1/ping` — the Device SDK route root (A1): any valid secret key → `{ ok, project_id, env }`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import { SELF_AUTH_ROUTES } from "@/shared/auth/public-routes";
import { GET } from "./route";

const ctx = { params: Promise.resolve({}) };
const ping = (key?: string) =>
  GET(new NextRequest("http://localhost/api/v1/ping", { headers: key ? { authorization: `Bearer ${key}` } : {} }), ctx);

beforeEach(() => {
  resetFakeStore();
  fakeStore.projects.set("proj-1", { id: "proj-1", org_id: "org-1", api_version: "2026-10-27" });
});

describe("GET /api/v1/ping", () => {
  it("answers the key's project and env", async () => {
    const test = await mintApiKey({ projectId: "proj-1", env: "test", kind: "secret", scopes: ["analytics:read"] });
    const res = await ping(test.secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, project_id: "proj-1", env: "test" });

    const live = await mintApiKey({ projectId: "proj-1", env: "live", kind: "secret" });
    expect(await (await ping(live.secret)).json()).toEqual({ ok: true, project_id: "proj-1", env: "live" });
  });

  it("refuses a publishable key (it may only create Connect sessions)", async () => {
    const pk = await mintApiKey({ projectId: "proj-1", env: "test", kind: "publishable" });
    const res = await ping(pk.secret);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient_scope");
  });

  it("answers a missing key in the C10 shape", async () => {
    const res = await ping();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatchObject({ type: "authentication_error", code: "unauthenticated" });
  });

  it("🔒 the proxy hands /api/v1/* to the route (so a missing key gets C10, not the proxy's 401)", () => {
    expect(SELF_AUTH_ROUTES.some((r) => "/api/v1/ping".startsWith(r))).toBe(true);
  });
});
