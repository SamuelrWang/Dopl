/**
 * THE THREE ONTOLOGY CHANGELOG ROUTES, as a contract (2026-09-09, part 2):
 *   1. both READS sit at `minRole: "guest"` — the floor the ontology reads and
 *      the object PATCH already carry since the home-ontology ruling, with the
 *      LEVEL ladder doing the real fencing in the service;
 *   2. the RESTORE sits at the same floor and is deliberately NOT `sessionOnly`:
 *      it destroys nothing, so agents may restore (the route file argues it);
 *   3. `?limit=` and `?cursor=` are VALIDATED, not clamped in silence.
 *
 * Auth is mocked at the wrapper: what is under test is the composition.
 *
 * ⚠ MUTATION-VERIFIED — three reverts, three failures: adding `sessionOnly` to
 * the restore route; raising the reads to `member` (a lent guest loses the
 * history of a board they can open); and clamping an over-max `limit` instead of
 * refusing it.
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
        params: { objectId: "obj-1", clusterId: "cl-1", revisionId: "rev-1" },
      });
    },
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  getSnapshot: vi.fn(async () => ({
    clusters: [],
    objects: { "obj-1": { id: "obj-1", name: "Acme" } },
  })),
}));

vi.mock("@/features/ontology/server/service-revisions-read", () => ({
  listObjectRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  listClusterRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  restoreObjectRevision: vi.fn(async () => {}),
}));

import { GET as GET_OBJECT } from "./route";
import { GET as GET_CLUSTER } from "../../../clusters/[clusterId]/revisions/route";
import { POST as POST_RESTORE } from "./[revisionId]/restore/route";
import {
  listClusterRevisions,
  listObjectRevisions,
  restoreObjectRevision,
} from "@/features/ontology/server/service-revisions-read";

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

describe("GET /api/ontology/objects/{objectId}/revisions", () => {
  it("answers the page verbatim and passes no page args when none were sent", async () => {
    const res = await GET_OBJECT(req("/api/ontology/objects/obj-1/revisions"), CTX_ARG);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revisions: [], nextCursor: null });
    expect(vi.mocked(listObjectRevisions).mock.calls[0][2]).toEqual({});
  });

  it("forwards `cursor` and `limit` when they are sent", async () => {
    await GET_OBJECT(
      req("/api/ontology/objects/obj-1/revisions?cursor=abc&limit=10"),
      CTX_ARG
    );
    expect(vi.mocked(listObjectRevisions).mock.calls[0][2]).toEqual({
      cursor: "abc",
      limit: 10,
    });
  });

  it("🔒 an over-max `limit` is a 400 — never a silent clamp", async () => {
    const res = await GET_OBJECT(
      req("/api/ontology/objects/obj-1/revisions?limit=5000"),
      CTX_ARG
    );
    expect(res.status).toBe(400);
    expect(listObjectRevisions).not.toHaveBeenCalled();
  });

  it("🔒 sits at the `guest` floor — the one the object PATCH already carries", async () => {
    await GET_OBJECT(req("/api/ontology/objects/obj-1/revisions"), CTX_ARG);
    expect(wrapperOptions[0]).toMatchObject({ minRole: "guest" });
  });
});

describe("GET /api/ontology/clusters/{clusterId}/revisions", () => {
  it("answers the cluster ROLL-UP at the guest floor", async () => {
    const res = await GET_CLUSTER(req("/api/ontology/clusters/cl-1/revisions"), CTX_ARG);
    expect(res.status).toBe(200);
    expect(vi.mocked(listClusterRevisions).mock.calls[0][1]).toBe("cl-1");
    expect(wrapperOptions[0]).toMatchObject({ minRole: "guest" });
  });
});

describe("POST .../revisions/{revisionId}/restore", () => {
  it("restores and answers the object as it now stands", async () => {
    const res = await POST_RESTORE(
      req("/api/ontology/objects/obj-1/revisions/rev-1/restore", "POST"),
      CTX_ARG
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      object: { id: "obj-1", name: "Acme" },
    });
    expect(restoreObjectRevision).toHaveBeenCalledWith(
      expect.anything(),
      "obj-1",
      "rev-1"
    );
  });

  it("🔒 is NOT sessionOnly — a restore destroys nothing, so agents may restore", async () => {
    await POST_RESTORE(
      req("/api/ontology/objects/obj-1/revisions/rev-1/restore", "POST"),
      CTX_ARG
    );
    expect(wrapperOptions[0]).not.toHaveProperty("sessionOnly", true);
  });
});
