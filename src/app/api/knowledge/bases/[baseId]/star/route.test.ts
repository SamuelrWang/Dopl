/**
 * `PUT|DELETE /api/knowledge/bases/{baseId}/star`.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: the star is the CALLER'S, and there is no
 * shape of this request that can say otherwise. The user id is taken off the
 * auth wrapper into `KnowledgeContext` and the service takes no user
 * parameter, so the assertion below is that the context reaching it is built
 * from `auth` and nothing else.
 *
 * The second property is the pair of verbs. Both are IDEMPOTENT and both name
 * the END STATE, which is what makes a retry after an ambiguous failure safe —
 * a single `POST /star/toggle` would silently un-do a write that had actually
 * landed.
 *
 * Auth is mocked at the wrapper (mirroring `../../route.test.ts`) — what is
 * under test is the composition, not `withWorkspaceAuth`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

/** The route params the mocked wrapper injects. Mutable so one test can take
 *  `baseId` away — the real wrapper is what fills this in, so there is no
 *  request argument that could stand in for it. */
let params: Record<string, string> = { baseId: "kb-1" };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "viewer",
  apiKeyWorkspaceId: null,
};

/** Captured so a test can assert what the wrapper was configured WITH — the
 *  minRole is part of this route's contract, not an implementation detail. */
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
    const res = await PUT(req("PUT"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: true });
    // The user id is the auth context's, and the service signature has no
    // second place one could come from.
    expect(mockStar).toHaveBeenCalledWith(CTX, "kb-1");
  });

  it("is idempotent at the HTTP layer — a re-star is another 200", async () => {
    await PUT(req("PUT"));
    const res = await PUT(req("PUT"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: true });
  });

  it("maps a hidden base through the knowledge error envelope, not a raw throw", async () => {
    // `starBase` gates on `getBaseById`, so another workspace's base — or one
    // the private/teams gate hides — arrives here as a domain error. It must
    // not become a star and it must not leak the message.
    mockStar.mockRejectedValue(new Error("kb-1 belongs to ws-2"));

    const res = await PUT(req("PUT"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).not.toContain("ws-2");
  });

  it("400s a request with no baseId rather than starring nothing", async () => {
    params = {};
    const res = await PUT(req("PUT"));
    expect(res.status).toBe(400);
    expect(mockStar).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/knowledge/bases/[baseId]/star", () => {
  it("unstars for the authenticated caller", async () => {
    const res = await DELETE(req("DELETE"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: false });
    expect(mockUnstar).toHaveBeenCalledWith(CTX, "kb-1");
  });

  it("answers the same for a row that was never there", async () => {
    // Idempotent, and deliberately not an oracle: "you had no star" and "you
    // had one" are the same response, so the id reveals nothing.
    const res = await DELETE(req("DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ starred: false });
  });
});

describe("the wrapper it is mounted behind", () => {
  it("takes the DEFAULT minRole — starring is a personal bookmark", async () => {
    // A read-only member can see every base this sorts; refusing them the
    // ability to organise their own home grid would be a gate on nothing. The
    // write reaches the caller's own row, never workspace content.
    await PUT(req("PUT"));
    await DELETE(req("DELETE"));
    expect(wrapperOptions.every((o) => o?.minRole === undefined)).toBe(true);
    // And neither verb is `sessionOnly` / `writeScopeExempt` — the standard
    // OAuth write-scope gate applies, which is the default posture
    // (INVARIANTS §3, pinned by write-gate-coverage.test.ts).
    expect(wrapperOptions.every((o) => o?.sessionOnly === undefined)).toBe(true);
    expect(
      wrapperOptions.every((o) => o?.writeScopeExempt === undefined)
    ).toBe(true);
  });
});
