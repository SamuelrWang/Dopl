/**
 * `GET /v1/events` (spec `listEvents`): the key's own project + env, scope `analytics:read`,
 * rate limited per key (fails closed), bad query → `invalid_request`, and 🔒 NO `dev_events` row
 * for any call to it (success or refusal), unlike every other `/v1` route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

const limiter = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/shared/auth/mcp-session", () => ({ checkAndRecordRateLimitSubject: (...a: unknown[]) => limiter(...a) }));

const list = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ data: [], next_cursor: null, has_more: false }));
vi.mock("@/features/device-sdk/server/public-events", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/device-sdk/server/public-events")>();
  return { ...real, listPublicEvents: (...a: unknown[]) => list(...a) };
});

import { ErrorResponseSchema, EventListResponseSchema } from "@dopl/device-contracts";
import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { flushDevEvents, setDevEventSinkForTests } from "@/features/device-sdk/server/events";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import type { DeviceEventRow } from "@/features/device-sdk/types";
import { GET } from "./route";

const P1 = "proj-1";
let events: DeviceEventRow[];

const get = (qs: string, bearer: string) =>
  GET(new NextRequest(`http://localhost/api/v1/events${qs}`, { headers: { authorization: `Bearer ${bearer}` } }), {
    params: Promise.resolve({}),
  });

async function code(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error.code;
}

beforeEach(() => {
  events = [];
  setDevEventSinkForTests({ write: async (rows) => void events.push(...rows) });
  resetFakeStore();
  fakeStore.projects.set(P1, { id: P1, org_id: "org-1", api_version: "2026-10-27" });
  limiter.mockReset().mockResolvedValue(true);
  list.mockClear();
});

const key = async (scopes: Array<"analytics:read" | "devices:read">, env: "test" | "live" = "test") =>
  (await mintApiKey({ projectId: P1, env, kind: "secret", scopes })).secret;

describe("GET /v1/events", () => {
  it("reads the key's own project and env; envelope; no-store; no event row", async () => {
    const res = await get("?limit=5&outcome=error", await key(["analytics:read"], "live"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(EventListResponseSchema.parse(await res.json())).toEqual({ data: [], next_cursor: null, has_more: false });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toMatchObject({ projectId: P1, env: "live", query: { limit: 5, outcome: "error" } });
    await flushDevEvents();
    expect(events).toEqual([]);
  });

  it("limits per key id and fails closed", async () => {
    const k = await key(["analytics:read"]);
    limiter.mockResolvedValue(false);
    const res = await get("", k);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await code(res)).toBe("rate_limited");
    expect(list).not.toHaveBeenCalled();
    const [subject, rpm] = limiter.mock.calls[0] as [string, number];
    expect(subject).toMatch(/^devsdk-events:/);
    expect(rpm).toBe(60);
  });

  it("a bad query is invalid_request and reads nothing", async () => {
    const res = await get("?cursor=not+base64", await key(["analytics:read"]));
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("invalid_request");
    expect(list).not.toHaveBeenCalled();
  });

  it("needs analytics:read; refusals write no event row either", async () => {
    const res = await get("", await key(["devices:read"]));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("insufficient_scope");
    const anon = await get("", "sk_test_unknownunknownunknown");
    expect(anon.status).toBe(401);
    await flushDevEvents();
    expect(events).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
