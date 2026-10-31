import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { wrapperOptions } = vi.hoisted(() => ({ wrapperOptions: [] as Array<Record<string, unknown> | undefined> }));
vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (handler: (req: NextRequest, ctx: { userId: string }) => Promise<Response>, options?: Record<string, unknown>) => {
    wrapperOptions.push(options);
    return (req: NextRequest) => handler(req, { userId: "u1" });
  },
}));
const readCalls = vi.fn();
const listPortalProjects = vi.fn();
vi.mock("@/features/device-sdk/server/portal-activity", () => ({ FEED_LIMIT: 300, readCalls: (...a: unknown[]) => readCalls(...a) }));
vi.mock("@/features/device-sdk/server/portal", () => ({ listPortalProjects: (...a: unknown[]) => listPortalProjects(...a) }));
vi.mock("@/features/device-sdk/server/portal-http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    UUID: /^[0-9a-f-]{36}$/,
    noStore: (body: unknown) => NextResponse.json(body, { headers: { "Cache-Control": "no-store" } }),
    portalErrorResponse: (_: string, err: { status?: number }) => NextResponse.json({}, { status: err.status ?? 500 }),
  };
});

import { GET } from "./route";

const P = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const get = (query: string) => (GET as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest(`https://dopl.test/api/developers/activity?${query}`));

beforeEach(() => {
  readCalls.mockReset().mockResolvedValue([]);
  listPortalProjects.mockReset().mockResolvedValue([{ id: P, org: { internal: true } }]);
});

describe("GET /api/developers/activity", () => {
  it("🔒 is session only, and a project the caller cannot see reads 404 with nothing read", async () => {
    expect(wrapperOptions[0]).toEqual({ sessionOnly: true });
    expect((await get(`project=${ID}&env=live`)).status).toBe(404);
    expect(readCalls).not.toHaveBeenCalled();
  });

  it("refuses an unknown env or time", async () => {
    expect((await get(`project=${P}&env=prod`)).status).toBe(400);
    expect((await get(`project=${P}&env=live&since=soon`)).status).toBe(400);
  });

  it("reads under the checked project, with a capped limit, and only real ids for the moving rows", async () => {
    const res = await get(`project=${P}&env=live&limit=99999&since=2026-10-31T00:00:00Z&open=${ID},not-an-id`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(readCalls).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, env: "live", internal: true, limit: 300, since: "2026-10-31T00:00:00.000Z" }));
    expect(readCalls).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, ids: [ID] }));
  });
});
