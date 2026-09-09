/**
 * THE THREE CHANGELOG ROUTES, as a contract:
 *   1. both READS sit at the VIEWER default — history is a read of a resource
 *      you can already read, and its service re-asks that resource's own gate;
 *   2. the RESTORE sits at `member`, the entry WRITE floor, and is deliberately
 *      NOT `sessionOnly`: it destroys nothing, so agents may restore (the route
 *      file carries the argument);
 *   3. `?limit=` and `?cursor=` are VALIDATED, not clamped in silence — an
 *      over-max limit is a 400, and a MISSING one is the service's default.
 *
 * Auth is mocked at the wrapper: what is under test is the composition.
 *
 * ⚠ MUTATION-VERIFIED — three reverts, three failures: adding `sessionOnly` to
 * the restore route; dropping `minRole: "member"` from it; and clamping an
 * over-max `limit` instead of refusing it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

/** Captured so a test can assert the wrapper's config — the floors ARE the contract. */
const wrapperOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (
      handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
    (req: Request) => {
      wrapperOptions.push(options);
      return handler(req, {
        ...AUTH,
        params: { entryId: "e-1", baseId: "kb-1", revisionId: "rev-1" },
      });
    },
}));

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  listEntryRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  listBaseRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  restoreEntryRevision: vi.fn(async () => {}),
  readEntry: vi.fn(async () => ({ id: "e-1" })),
}));

import { GET as GET_ENTRY } from "./route";
import { GET as GET_BASE } from "../../../bases/[baseId]/revisions/route";
import { POST as POST_RESTORE } from "./[revisionId]/restore/route";
import {
  listBaseRevisions,
  listEntryRevisions,
  restoreEntryRevision,
} from "@/features/knowledge/server/service";

function req(url: string, method = "GET") {
  return new NextRequest(new URL(url, "http://localhost"), { method });
}

/** Next's second handler argument. The mocked wrapper ignores it — the real
 *  params reach the handler through `WorkspaceAuthContext.params`. */
const CTX_ARG = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
});

describe("GET /api/knowledge/entries/{entryId}/revisions", () => {
  it("answers the page verbatim and passes no page args when none were sent", async () => {
    const res = await GET_ENTRY(req("/api/knowledge/entries/e-1/revisions"), CTX_ARG);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revisions: [], nextCursor: null });
    expect(vi.mocked(listEntryRevisions).mock.calls[0][2]).toEqual({});
  });

  it("forwards `cursor` and `limit` when they are sent", async () => {
    await GET_ENTRY(req("/api/knowledge/entries/e-1/revisions?cursor=abc&limit=10"), CTX_ARG);
    expect(vi.mocked(listEntryRevisions).mock.calls[0][2]).toEqual({
      cursor: "abc",
      limit: 10,
    });
  });

  it("🔒 an over-max `limit` is a 400 — never a silent clamp", async () => {
    const res = await GET_ENTRY(req("/api/knowledge/entries/e-1/revisions?limit=5000"), CTX_ARG);
    expect(res.status).toBe(400);
    expect(listEntryRevisions).not.toHaveBeenCalled();
  });

  it("a non-numeric `limit` is a 400", async () => {
    const res = await GET_ENTRY(req("/api/knowledge/entries/e-1/revisions?limit=all"), CTX_ARG);
    expect(res.status).toBe(400);
  });

  it("stays at the VIEWER default — a history read is a read", async () => {
    await GET_ENTRY(req("/api/knowledge/entries/e-1/revisions"), CTX_ARG);
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("GET /api/knowledge/bases/{baseId}/revisions", () => {
  it("answers the base ROLL-UP at the viewer default", async () => {
    const res = await GET_BASE(req("/api/knowledge/bases/kb-1/revisions"), CTX_ARG);
    expect(res.status).toBe(200);
    expect(vi.mocked(listBaseRevisions).mock.calls[0][1]).toBe("kb-1");
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("POST .../revisions/{revisionId}/restore", () => {
  it("restores and answers the entry as it now stands", async () => {
    const res = await POST_RESTORE(
      req("/api/knowledge/entries/e-1/revisions/rev-1/restore", "POST"),
      CTX_ARG
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ entry: { id: "e-1" } });
    expect(restoreEntryRevision).toHaveBeenCalledWith(
      expect.anything(),
      "e-1",
      "rev-1"
    );
  });

  it("🔒 sits at the `member` write floor", async () => {
    await POST_RESTORE(req("/api/knowledge/entries/e-1/revisions/rev-1/restore", "POST"), CTX_ARG);
    expect(wrapperOptions[0]).toMatchObject({ minRole: "member" });
  });

  it("🔒 is NOT sessionOnly — a restore destroys nothing, so agents may restore", async () => {
    await POST_RESTORE(req("/api/knowledge/entries/e-1/revisions/rev-1/restore", "POST"), CTX_ARG);
    expect(wrapperOptions[0]).not.toHaveProperty("sessionOnly", true);
  });
});
