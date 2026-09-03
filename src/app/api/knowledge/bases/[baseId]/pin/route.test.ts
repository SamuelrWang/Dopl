/**
 * `PUT|DELETE /api/knowledge/bases/{baseId}/pin`. Three properties:
 *   1. both verbs are IDEMPOTENT and state the END STATE, so a retry after an
 *      ambiguous failure re-asserts it — a toggle would silently un-do a write
 *      that had landed, and on WORKSPACE-wide state that changes what every
 *      session launched afterwards starts with;
 *   2. the `member` FLOOR, which is where this route parts company with its
 *      neighbour `star` (a personal bookmark at the viewer default): deciding
 *      what every agent here is handed is an edit to shared state;
 *   3. 🔒 BOTH verbs are `sessionOnly` (R4, 2026-09-02). They were not, on the
 *      argument that a pin "reaches no person and changes no audience" — true of
 *      the WRITE and beside the point of the DECISION, which settles what every
 *      agent session launched here afterwards is HANDED at startup. That is the
 *      shape `bases/{baseId}/channel-grants` is `sessionOnly` for.
 * Auth is mocked at the wrapper: what is under test is the composition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

/** Route params the mocked wrapper injects. Mutable so one test can take `baseId` away. */
let params: Record<string, string> = { baseId: "kb-1" };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
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
  pinBase: vi.fn(),
}));

import { PUT, DELETE } from "./route";
import { pinBase } from "@/features/knowledge/server/service";

const mockPin = vi.mocked(pinBase);

const CTX = { workspaceId: "ws-1", userId: "user-1" };

function req(method: string): NextRequest {
  return new NextRequest("http://localhost/api/knowledge/bases/kb-1/pin", {
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
  params = { baseId: "kb-1" };
  mockPin.mockResolvedValue(undefined);
});

describe("PUT /api/knowledge/bases/[baseId]/pin", () => {
  it("pins the base for the WORKSPACE and echoes the end state", async () => {
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: true });
    // The service signature has no place a subject could be smuggled in.
    expect(mockPin).toHaveBeenCalledWith(CTX, "kb-1", true);
  });

  it("is idempotent at the HTTP layer — a re-pin is another 200 with the same body", async () => {
    await PUT(req("PUT"), { params: Promise.resolve({}) });
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: true });
    expect(mockPin.mock.calls.map((c) => c[2])).toEqual([true, true]);
  });

  it("maps a hidden base through the knowledge error envelope, not a raw throw", async () => {
    // `pinBase` gates on `getBaseById`: a foreign or hidden base arrives as a
    // domain error and must neither become a pin nor leak its message.
    mockPin.mockRejectedValue(new Error("kb-1 belongs to ws-2"));

    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).not.toContain("ws-2");
  });

  it("400s a request with no baseId rather than pinning nothing", async () => {
    params = {};
    const res = await PUT(req("PUT"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockPin).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/knowledge/bases[baseId]/pin", () => {
  it("unpins and states the end state rather than a delta", async () => {
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: false });
    expect(mockPin).toHaveBeenCalledWith(CTX, "kb-1", false);
  });

  it("answers the same for a base that was never pinned", async () => {
    // Not an oracle, and not a toggle: "was pinned" and "was not" are one
    // response, so a retry cannot flip the row back on.
    await DELETE(req("DELETE"), { params: Promise.resolve({}) });
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: false });
    expect(mockPin.mock.calls.map((c) => c[2])).toEqual([false, false]);
  });

  it("400s with no baseId, like the PUT", async () => {
    params = {};
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockPin).not.toHaveBeenCalled();
  });
});

describe("the wrapper it is mounted behind", () => {
  it("takes the `member` FLOOR on BOTH verbs, where `star` takes the viewer default", async () => {
    // A viewer may READ this base and bookmark it for themselves; deciding what
    // every agent in the workspace starts its session with is shared state, and
    // removing somebody else's launch context is as much a write as adding one.
    await PUT(req("PUT"), { params: Promise.resolve({}) });
    await DELETE(req("DELETE"), { params: Promise.resolve({}) });

    expect(wrapperOptions).toHaveLength(2);
    expect(wrapperOptions.every((o) => o?.minRole === "member")).toBe(true);
  });

  it("🔒 is sessionOnly on BOTH verbs — an agent token cannot edit startup context (R4)", async () => {
    // ⚠ MUTATION CHECK. Drop either flag and an agent token settles what every
    // agent launched in this workspace afterwards is handed at startup — a
    // machine editing its own standing context, with no operator at the keyboard.
    // `write-gate-coverage.test.ts` pins the sessionOnly set file-by-file.
    await PUT(req("PUT"), { params: Promise.resolve({}) });
    await DELETE(req("DELETE"), { params: Promise.resolve({}) });

    expect(wrapperOptions.every((o) => o?.sessionOnly === true)).toBe(true);
    // ⚠ AND STILL NOT `writeScopeExempt`: a pin is an ordinary write and pays
    // the ordinary write scope.
    expect(wrapperOptions.every((o) => o?.writeScopeExempt === undefined)).toBe(
      true
    );
  });
});
