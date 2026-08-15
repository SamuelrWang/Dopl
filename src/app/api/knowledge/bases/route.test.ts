/**
 * `GET /api/knowledge/bases` — the base list plus the maps folded onto it. Two properties:
 *   1. THE FOLD IS ADDITIVE. `bases` keeps its exact shape and stays first-class; existing
 *      readers (`features/knowledge/client/api.ts`, ontology pick menus, `@dopl/client`'s
 *      `kb_list_bases`) destructure `data.bases` and must not notice.
 *   2. EVERY MAP IS SCOPED TO THE BASES RETURNED — each takes the post-visibility list as input,
 *      so a base hidden by the private/teams gate cannot leak its owner or count through them.
 * Auth is mocked at the wrapper: what is under test is the composition, not `withWorkspaceAuth`.
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
  listBaseStats: vi.fn(),
  listStarredBaseIds: vi.fn(),
  resolveKbStorageLimit: vi.fn(),
}));

import { GET } from "./route";
import {
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listStarredBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";

const mockListBases = vi.mocked(listBases);
const mockOwnerNames = vi.mocked(listBaseOwnerNames);
const mockBaseStats = vi.mocked(listBaseStats);
const mockStorageLimit = vi.mocked(resolveKbStorageLimit);
const mockStarred = vi.mocked(listStarredBaseIds);

function base(id: string, createdBy: string | null): KnowledgeBase {
  return { id, createdBy } as unknown as KnowledgeBase;
}

const VISIBLE = [base("kb-1", "user-1"), base("kb-2", "user-2")];

const STATS = {
  "kb-1": {
    entryCount: 3,
    lastEntryUpdatedAt: "2026-08-01T00:00:00Z",
    storageBytes: 4_231_000,
  },
  "kb-2": { entryCount: 0, lastEntryUpdatedAt: null, storageBytes: 0 },
};

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/knowledge/bases", { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBases.mockResolvedValue(VISIBLE);
  mockOwnerNames.mockResolvedValue({ "user-2": "Dana Ortiz" });
  mockBaseStats.mockResolvedValue(STATS);
  mockStorageLimit.mockResolvedValue(5_000_000);
  mockStarred.mockResolvedValue(["kb-2"]);
});

describe("GET /api/knowledge/bases", () => {
  it("returns the bases untouched alongside both folded maps", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: VISIBLE,
      ownerNames: { "user-2": "Dana Ortiz" },
      baseStats: STATS,
      kbStorageLimit: 5_000_000,
      starredBaseIds: ["kb-2"],
    });
  });

  it("carries the per-base storage cap ONCE, not per card", async () => {
    // N bars against ONE limit — asking per card would be N+1.
    await GET(getReq());
    expect(mockStorageLimit).toHaveBeenCalledTimes(1);
    expect(mockStorageLimit).toHaveBeenCalledWith("ws-1");
  });

  it("degrades an unresolvable cap to null — never to a guessed limit", async () => {
    // `null` reads as UNKNOWN and suppresses every bar; a fallback would draw bars against a
    // cap nobody enforces.
    mockStorageLimit.mockRejectedValue(new Error("billing down"));

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.kbStorageLimit).toBeNull();
    expect(body.bases).toHaveLength(2);
  });

  it("looks both maps up for exactly the bases it is about to return", async () => {
    // ⚠ Not the unfiltered set: a base hidden by the private/teams gate must not leak.
    await GET(getReq());
    const ctx = { workspaceId: "ws-1", userId: "user-1" };
    expect(mockOwnerNames).toHaveBeenCalledWith(ctx, VISIBLE);
    expect(mockBaseStats).toHaveBeenCalledWith(ctx, VISIBLE);
    // Same fence; the USER comes from the context, never the request.
    expect(mockStarred).toHaveBeenCalledWith(ctx, VISIBLE);
  });

  it("degrades a stats failure to an empty map instead of 500ing the list", async () => {
    // Counters cosmetic, list is not — `kb_list_bases` over MCP rides this route.
    mockBaseStats.mockRejectedValue(new Error("entries table down"));

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bases).toHaveLength(2);
    expect(body.baseStats).toEqual({});
  });

  it("returns an empty map (not a missing key) for the solo case", async () => {
    mockListBases.mockResolvedValue([base("kb-1", "user-1")]);
    mockOwnerNames.mockResolvedValue({});
    mockStarred.mockResolvedValue([]);

    mockBaseStats.mockResolvedValue({
      "kb-1": { entryCount: 0, lastEntryUpdatedAt: null, storageBytes: 0 },
    });

    const body = (await (await GET(getReq())).json()) as Record<string, unknown>;
    expect(body.ownerNames).toEqual({});
    expect("ownerNames" in body).toBe(true);
    // A base with no entries is a ZEROED entry, never a missing key (which means "unknown").
    expect(body.baseStats).toEqual({
      "kb-1": { entryCount: 0, lastEntryUpdatedAt: null, storageBytes: 0 },
    });
  });

  it("still answers with an empty base list when the caller can see nothing", async () => {
    mockListBases.mockResolvedValue([]);
    mockOwnerNames.mockResolvedValue({});
    mockBaseStats.mockResolvedValue({});

    mockStarred.mockResolvedValue([]);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: [],
      ownerNames: {},
      baseStats: {},
      kbStorageLimit: 5_000_000,
      starredBaseIds: [],
    });
  });

  it("degrades a star failure to [] instead of 500ing the list", async () => {
    // Degraded value is REAL here: unknown and unstarred render identically.
    mockStarred.mockRejectedValue(new Error("stars table down"));

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bases).toHaveLength(2);
    expect(body.starredBaseIds).toEqual([]);
  });

  it("keeps the stars OFF the base rows — the SDK type must not widen", async () => {
    // ⚠ Sibling key: a per-user fact on `KnowledgeBase` would ride every MCP `kb_*` payload and
    // break `scripts/check-knowledge-type-drift.ts`.
    const body = (await (await GET(getReq())).json()) as {
      bases: Array<Record<string, unknown>>;
      starredBaseIds: string[];
    };
    expect(body.starredBaseIds).toEqual(["kb-2"]);
    for (const b of body.bases) {
      expect("starred" in b).toBe(false);
      expect("starredAt" in b).toBe(false);
    }
  });

  it("maps a service failure through the knowledge error envelope, not a raw throw", async () => {
    mockListBases.mockRejectedValue(new Error("db down"));

    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).not.toContain("db down");
  });
});
