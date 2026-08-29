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
  listHomeScopedBaseIds: vi.fn(),
  resolveKbStorageLimit: vi.fn(),
}));

vi.mock("@/features/knowledge/server/service-channel-grants", () => ({
  getChannelGrantMap: vi.fn(),
}));

vi.mock("@/features/workspaces/server/service-overview", () => ({
  isChannelVisibleTo: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  createBase,
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listStarredBaseIds,
  listHomeScopedBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";
import { getChannelGrantMap } from "@/features/knowledge/server/service-channel-grants";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";

const mockListBases = vi.mocked(listBases);
const mockCreateBase = vi.mocked(createBase);
const mockOwnerNames = vi.mocked(listBaseOwnerNames);
const mockBaseStats = vi.mocked(listBaseStats);
const mockStorageLimit = vi.mocked(resolveKbStorageLimit);
const mockStarred = vi.mocked(listStarredBaseIds);
const mockHomeScoped = vi.mocked(listHomeScopedBaseIds);
const mockGrantMap = vi.mocked(getChannelGrantMap);
const mockChannelVisible = vi.mocked(isChannelVisibleTo);

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

function shelfReq(shelf: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/knowledge/bases?shelf=${shelf}`,
    { method: "GET" }
  );
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/knowledge/bases", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function channelReq(channelId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/knowledge/bases?channelId=${channelId}`,
    { method: "GET" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBases.mockResolvedValue(VISIBLE);
  mockOwnerNames.mockResolvedValue({ "user-2": "Dana Ortiz" });
  mockBaseStats.mockResolvedValue(STATS);
  mockStorageLimit.mockResolvedValue(5_000_000);
  mockStarred.mockResolvedValue(["kb-2"]);
  mockHomeScoped.mockResolvedValue(["kb-1"]);
});

describe("GET /api/knowledge/bases", () => {
  it("returns the bases untouched alongside both folded maps", async () => {
    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: VISIBLE,
      ownerNames: { "user-2": "Dana Ortiz" },
      baseStats: STATS,
      kbStorageLimit: 5_000_000,
      starredBaseIds: ["kb-2"],
      homeScopedBaseIds: ["kb-1"],
    });
  });

  it("carries the per-base storage cap ONCE, not per card", async () => {
    // N bars against ONE limit — asking per card would be N+1.
    await GET(getReq(), { params: Promise.resolve({}) });
    expect(mockStorageLimit).toHaveBeenCalledTimes(1);
    expect(mockStorageLimit).toHaveBeenCalledWith("ws-1");
  });

  it("degrades an unresolvable cap to null — never to a guessed limit", async () => {
    // `null` reads as UNKNOWN and suppresses every bar; a fallback would draw bars against a
    // cap nobody enforces.
    mockStorageLimit.mockRejectedValue(new Error("billing down"));

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.kbStorageLimit).toBeNull();
    expect(body.bases).toHaveLength(2);
  });

  it("looks both maps up for exactly the bases it is about to return", async () => {
    // ⚠ Not the unfiltered set: a base hidden by the private/teams gate must not leak.
    await GET(getReq(), { params: Promise.resolve({}) });
    const ctx = { workspaceId: "ws-1", userId: "user-1" };
    expect(mockOwnerNames).toHaveBeenCalledWith(ctx, VISIBLE);
    expect(mockBaseStats).toHaveBeenCalledWith(ctx, VISIBLE);
    // Same fence; the USER comes from the context, never the request.
    expect(mockStarred).toHaveBeenCalledWith(ctx, VISIBLE);
  });

  it("degrades a stats failure to an empty map instead of 500ing the list", async () => {
    // Counters cosmetic, list is not — `kb_list_bases` over MCP rides this route.
    mockBaseStats.mockRejectedValue(new Error("entries table down"));

    const res = await GET(getReq(), { params: Promise.resolve({}) });
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

    const body = (await (await GET(getReq(), { params: Promise.resolve({}) })).json()) as Record<string, unknown>;
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
    mockHomeScoped.mockResolvedValue([]);

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: [],
      ownerNames: {},
      baseStats: {},
      kbStorageLimit: 5_000_000,
      starredBaseIds: [],
      homeScopedBaseIds: [],
    });
  });

  it("degrades a star failure to [] instead of 500ing the list", async () => {
    // Degraded value is REAL here: unknown and unstarred render identically.
    mockStarred.mockRejectedValue(new Error("stars table down"));

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bases).toHaveLength(2);
    expect(body.starredBaseIds).toEqual([]);
  });

  it("folds homeScopedBaseIds in as a SIBLING KEY, never onto the row", async () => {
    // 🔒 `home_scoped` is deliberately absent from `KNOWLEDGE_BASE_COLS` so no
    // client can re-implement the shelf FENCE from a projected column, and absent
    // from the SDK-mirrored `KnowledgeBase` so `check-knowledge-type-drift` has
    // nothing new to compare. The label rides BESIDE the rows.
    const body = (await (await GET(getReq(), { params: Promise.resolve({}) })).json()) as {
      bases: Array<Record<string, unknown>>;
      homeScopedBaseIds: string[];
    };
    expect(body.homeScopedBaseIds).toEqual(["kb-1"]);
    expect(mockHomeScoped).toHaveBeenCalledWith(expect.anything(), VISIBLE);
    for (const b of body.bases) {
      expect("homeScoped" in b).toBe(false);
      expect("home_scoped" in b).toBe(false);
      expect("shelf" in b).toBe(false);
    }
  });

  it("degrades a shelf-flag failure to [] — UNLABELLED, never mislabelled", async () => {
    // ⚠ THE SAFE DIRECTION. `[]` means no card carries a shelf label, which is
    // what every surface showed before this key existed; the unsafe direction
    // would be calling a workspace base personal, and no failure mode here
    // produces that.
    mockHomeScoped.mockRejectedValue(new Error("flag read down"));

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bases: unknown[];
      homeScopedBaseIds: string[];
    };
    expect(body.homeScopedBaseIds).toEqual([]);
    expect(body.bases).toHaveLength(2);
  });

  it("keeps the stars OFF the base rows — the SDK type must not widen", async () => {
    // ⚠ Sibling key: a per-user fact on `KnowledgeBase` would ride every MCP `kb_*` payload and
    // break `scripts/check-knowledge-type-drift.ts`.
    const body = (await (await GET(getReq(), { params: Promise.resolve({}) })).json()) as {
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

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).not.toContain("db down");
  });
});

describe("GET /api/knowledge/bases?channelId= — the scope-A grant map", () => {
  it("adds NO channelGrants key and reads NO fence when no channelId is sent", async () => {
    const body = (await (
      await GET(getReq(), { params: Promise.resolve({}) })
    ).json()) as Record<string, unknown>;
    // Absent param ⇒ absent key, never {} — the response was not channel-scoped.
    expect("channelGrants" in body).toBe(false);
    // The unscoped path must not pay the fence + grant queries.
    expect(mockChannelVisible).not.toHaveBeenCalled();
    expect(mockGrantMap).not.toHaveBeenCalled();
  });

  it("folds channelGrants in for a VISIBLE channel, fenced then read over the visible base ids", async () => {
    mockChannelVisible.mockResolvedValue(true);
    mockGrantMap.mockResolvedValue({
      "kb-1": { level: "visible", guestWrite: true },
      "kb-2": { level: "agent_only", guestWrite: false },
    });

    const res = await GET(channelReq("chan-9"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.channelGrants).toEqual({
      "kb-1": { level: "visible", guestWrite: true },
      "kb-2": { level: "agent_only", guestWrite: false },
    });
    // Fenced with the CONTEXT's workspace + user, never the request's.
    expect(mockChannelVisible).toHaveBeenCalledWith("ws-1", "user-1", "chan-9");
    // Bounded fan: the map is read over exactly the visible base ids.
    expect(mockGrantMap).toHaveBeenCalledWith("ws-1", "chan-9", ["kb-1", "kb-2"]);
  });

  it("404s a NON-VISIBLE channel and never reads the grant map (no existence oracle)", async () => {
    mockChannelVisible.mockResolvedValue(false);

    const res = await GET(channelReq("chan-hidden"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CHANNEL_NOT_FOUND");
    // The fence runs BEFORE any service-role grant read.
    expect(mockGrantMap).not.toHaveBeenCalled();
  });

  it("returns channelGrants {} for a visible-but-ungranted channel — asked, none granted", async () => {
    mockChannelVisible.mockResolvedValue(true);
    mockGrantMap.mockResolvedValue({});

    const body = (await (
      await GET(channelReq("chan-empty"), { params: Promise.resolve({}) })
    ).json()) as Record<string, unknown>;
    // The KEY is present (a channel was scoped) even though the map is empty —
    // distinct from the unscoped case, which omits the key entirely.
    expect("channelGrants" in body).toBe(true);
    expect(body.channelGrants).toEqual({});
  });
});

/**
 * 🔒 `?shelf=` — WHICH SHELF (Samuel's ruling 2026-08-26;
 * `features/knowledge/types.ts › KbShelf`).
 *
 * ⚠ THE MIXED-LIST QUESTION, ANSWERED AT THE ROUTE. A request that ASKED for a
 * shelf must never be answered with both — and the dangerous shape is not the
 * happy path, it is the misspelling. Absent means "no filter" for compatibility
 * (MCP `kb_list_bases`, workspace search), so a route that shrugged at
 * `?shelf=hom` would silently serve the WIDER list to a caller that was trying
 * to narrow, and it would look like it worked. There is no client-side fallback
 * filter to catch it: `home_scoped` is deliberately never projected.
 */
describe("GET /api/knowledge/bases?shelf=", () => {
  it("passes a recognised shelf DOWN to the service", async () => {
    await GET(shelfReq("home"), { params: Promise.resolve({}) });
    expect(mockListBases).toHaveBeenCalledWith(expect.anything(), {
      shelf: "home",
    });

    await GET(shelfReq("workspace"), { params: Promise.resolve({}) });
    expect(mockListBases).toHaveBeenLastCalledWith(expect.anything(), {
      shelf: "workspace",
    });
  });

  it("asks for BOTH shelves when the param is absent", async () => {
    // ⚠ Compatibility, not a default: every pre-shelf caller lands here.
    await GET(getReq(), { params: Promise.resolve({}) });
    expect(mockListBases).toHaveBeenCalledWith(expect.anything(), {
      shelf: undefined,
    });
  });

  it("🔒 400s an UNRECOGNISED shelf instead of widening to the mixed list", async () => {
    const res = await GET(shelfReq("hom"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    // And it never reached the service — no list was built, wide or narrow.
    expect(mockListBases).not.toHaveBeenCalled();
  });
});

/**
 * 🔒 `shareToChannelId` — CREATE AND SHARE IN ONE CALL (Samuel's ruling
 * 2026-08-27, the /home Shared section's button). The route owns ONE of the
 * fences; the rest live in `createBase` / `setChannelKnowledgeGrant`.
 */
describe("POST /api/knowledge/bases with shareToChannelId", () => {
  it("fences the channel BEFORE creating anything", async () => {
    mockChannelVisible.mockResolvedValue(false);

    const res = await POST(
      postReq({ name: "Handover", shareToChannelId: CHANNEL_UUID }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    // ⚠ The SAME answer an unknown channel gets — the field is not an oracle.
    expect(body.error.code).toBe("CHANNEL_NOT_FOUND");
    // 🔒 AND NOTHING WAS WRITTEN. A base created and then rolled back would
    // still have burned a slug and told the caller by TIMING what the 404
    // refuses to say in words.
    expect(mockCreateBase).not.toHaveBeenCalled();
  });

  it("creates once the channel is visible, and forwards the id", async () => {
    mockChannelVisible.mockResolvedValue(true);
    mockCreateBase.mockResolvedValue({ id: "kb-new" } as never);

    const res = await POST(
      postReq({ name: "Handover", shareToChannelId: CHANNEL_UUID }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(201);
    expect(mockChannelVisible).toHaveBeenCalledWith("ws-1", "user-1", CHANNEL_UUID);
    expect(mockCreateBase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shareToChannelId: CHANNEL_UUID })
    );
  });

  it("does not consult the channel fence when nothing is being shared", async () => {
    // ⚠ An ordinary create — MCP `kb_create_base` and the workspace Knowledge
    // page — must not pay a channel read it has no use for.
    mockCreateBase.mockResolvedValue({ id: "kb-new" } as never);

    const res = await POST(postReq({ name: "Ordinary" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    expect(mockChannelVisible).not.toHaveBeenCalled();
  });
});

const CHANNEL_UUID = "aaaaaaaa-0000-4000-8000-000000000001";
