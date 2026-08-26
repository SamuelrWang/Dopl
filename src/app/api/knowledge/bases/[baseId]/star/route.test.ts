/**
 * `PUT|DELETE /api/knowledge/bases/{baseId}/star`. Two properties:
 *   1. the star is the CALLER'S and no request shape can say otherwise — the user id comes off
 *      the auth wrapper into `KnowledgeContext` and the service takes no user parameter;
 *   2. both verbs are IDEMPOTENT and name the END STATE, so a retry after an ambiguous failure is
 *      safe — a `POST /star/toggle` would silently un-do a write that had landed.
 * Auth is mocked at the wrapper: what is under test is the composition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

/** Route params the mocked wrapper injects. Mutable so one test can take `baseId` away. */
let params: Record<string, string> = { baseId: "kb-1" };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "viewer",
  apiKeyWorkspaceId: null,
};

/** Captured so a test can assert the wrapper's config — `minRole` is part of the contract. */
const wrapperOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (
      handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
    (req: Request) => {
      wrapperOptions.push(options);
      return handler(req, { ...AUTH, params });
    },
}));

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  starBase: vi.fn(),
  unstarBase: vi.fn(),
}));

import { PUT, DELETE } from "./route";
import { starBase, unstarBase } from "@/features/knowledge/server/service";

const mockStar = vi.mocked(starBase);
const mockUnstar = vi.mocked(unstarBase);

const CTX = { workspaceId: "ws-1", userId: "user-1" };

function req(method: string): NextRequest {
  return new NextRequest("http://localhost/api/knowledge/bases/kb-1/star", {
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { baseId: "kb-1" };
  mockStar.mockResolvedValue(undefined);
  mockUnstar.mockResolvedValue(undefined);
});

describe("PUT /api/knowledge/bases/[baseId]/star", () => {
  it("stars the base FOR THE AUTHENTICATED CALLER", async () => {
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: true });
    // The service signature has no second place a user id could come from.
    expect(mockStar).toHaveBeenCalledWith(CTX, "kb-1");
  });

  it("is idempotent at the HTTP layer — a re-star is another 200", async () => {
    await PUT(req("PUT"), { params: Promise.resolve({}) });
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: true });
  });

  it("maps a hidden base through the knowledge error envelope, not a raw throw", async () => {
    // `starBase` gates on `getBaseById`: a foreign or hidden base arrives as a domain error and
    // must neither become a star nor leak its message.
    mockStar.mockRejectedValue(new Error("kb-1 belongs to ws-2"));

    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).not.toContain("ws-2");
  });

  it("400s a request with no baseId rather than starring nothing", async () => {
    params = {};
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockStar).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/knowledge/bases/[baseId]/star", () => {
  it("unstars for the authenticated caller", async () => {
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: false });
    expect(mockUnstar).toHaveBeenCalledWith(CTX, "kb-1");
  });

  it("answers the same for a row that was never there", async () => {
    // Not an oracle: "had no star" and "had one" are the same response.
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: false });
  });
});

describe("the wrapper it is mounted behind", () => {
  it("takes the DEFAULT minRole — starring is a personal bookmark", async () => {
    // A read-only member sees every base this sorts, and the write reaches their own row only.
    await PUT(req("PUT"), { params: Promise.resolve({}) });
    await DELETE(req("DELETE"), { params: Promise.resolve({}) });
    expect(wrapperOptions.every((o) => o?.minRole === undefined)).toBe(true);
    // Neither verb is `sessionOnly`/`writeScopeExempt` — default posture (INVARIANTS §3,
    // pinned by write-gate-coverage.test.ts).
    expect(wrapperOptions.every((o) => o?.sessionOnly === undefined)).toBe(true);
    expect(
      wrapperOptions.every((o) => o?.writeScopeExempt === undefined)
    ).toBe(true);
  });
});
