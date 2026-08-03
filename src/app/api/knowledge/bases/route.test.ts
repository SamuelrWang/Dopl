/**
 * `GET /api/knowledge/bases` — the base list, now carrying owner names.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: `ownerNames` was RSC-only
 * (`knowledge/page.tsx:51`), so the SPA's list pane had no attribution for
 * bases shared by other members. It was folded into this response rather than
 * given its own endpoint — which makes two things load-bearing:
 *
 *   1. **The fold is additive.** `bases` must keep its exact shape and stay
 *      the first-class key; existing readers (`features/knowledge/client/api.ts`,
 *      the workflow/ontology pick menus, and `@dopl/client`'s `kb_list_bases`)
 *      destructure `data.bases` and must not notice the change.
 *   2. **Owner names are scoped to the bases actually returned.** The lookup
 *      takes the post-visibility list as its input, so a base filtered out by
 *      the private/teams-mode gate can never leak its owner's display name
 *      through this key. Feeding `listBaseOwnerNames` anything other than the
 *      output of `listBases` would break that.
 *
 * Auth is mocked at the wrapper (mirroring `api/ontology/objects/route.test.ts`)
 * — what is under test is the composition, not `withWorkspaceAuth`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { KnowledgeBase } from "@/features/knowledge/types";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, AUTH),
}));

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  createBase: vi.fn(),
  listBases: vi.fn(),
  listBaseOwnerNames: vi.fn(),
}));

import { GET } from "./route";
import {
  listBaseOwnerNames,
  listBases,
} from "@/features/knowledge/server/service";

const mockListBases = vi.mocked(listBases);
const mockOwnerNames = vi.mocked(listBaseOwnerNames);

function base(id: string, createdBy: string | null): KnowledgeBase {
  return { id, createdBy } as unknown as KnowledgeBase;
}

const VISIBLE = [base("kb-1", "user-1"), base("kb-2", "user-2")];

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/knowledge/bases", { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBases.mockResolvedValue(VISIBLE);
  mockOwnerNames.mockResolvedValue({ "user-2": "Dana Ortiz" });
});

describe("GET /api/knowledge/bases", () => {
  it("returns the bases untouched alongside the owner-name map", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: VISIBLE,
      ownerNames: { "user-2": "Dana Ortiz" },
    });
  });

  it("looks names up for exactly the bases it is about to return", async () => {
    // Not the unfiltered set: a base hidden by the private/teams-mode gate
    // must not leak its owner through `ownerNames`.
    await GET(getReq());
    expect(mockOwnerNames).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "user-1" },
      VISIBLE
    );
  });

  it("returns an empty map (not a missing key) for the solo case", async () => {
    mockListBases.mockResolvedValue([base("kb-1", "user-1")]);
    mockOwnerNames.mockResolvedValue({});

    const body = (await (await GET(getReq())).json()) as Record<string, unknown>;
    expect(body.ownerNames).toEqual({});
    expect("ownerNames" in body).toBe(true);
  });

  it("still answers with an empty base list when the caller can see nothing", async () => {
    mockListBases.mockResolvedValue([]);
    mockOwnerNames.mockResolvedValue({});

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bases: [], ownerNames: {} });
  });

  it("maps a service failure through the knowledge error envelope, not a raw throw", async () => {
    mockListBases.mockRejectedValue(new Error("db down"));

    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    // The raw error never reaches the client (ENGINEERING §9).
    expect(body.error.message).not.toContain("db down");
  });
});
