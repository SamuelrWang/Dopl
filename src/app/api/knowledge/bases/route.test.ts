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
  credentialSubjectUserId: "user-1",
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
  // 🔒 THE CREATE'S GATE CHAIN WITHOUT ITS WRITE — what `?dryRun=1` runs, so the
  // MCP preview is answered by the gates the confirmed call passes (2026-09-06).
  // ⚠ AN UNMOCKED EXPORT HERE IS THE TRAP THIS FILE ALREADY RECORDS TWICE: the
  // route BINDS it at import, so vitest throws before any case runs, not on the
  // one path that calls it.
  assertCreateBaseAllowed: vi.fn(),
  listBases: vi.fn(),
  listBaseOwnerNames: vi.fn(),
  listBaseStats: vi.fn(),
  listStarredBaseIds: vi.fn(),
  listHomeScopedBaseIds: vi.fn(),
  // ⚠ THE PINNED-BASE READ (2026-09-01, T81). It rides the same `Promise.all`
  // as the other folded maps, so an UNMOCKED export here is not a missing
  // assertion — vitest throws on the property access BEFORE the route's own
  // `.catch` can attach, and every case in this file 500s. Same trap
  // `listSharedIntoChannelBaseIds` records one mock down.
  listPinnedBaseIds: vi.fn(),
  resolveKbStorageLimit: vi.fn(),
}));

vi.mock("@/features/knowledge/server/service-channel-grants", () => ({
  getChannelGrantMap: vi.fn(),
  // ⚠ THE `Shared` PILL'S READ (2026-09-01). It rides the same `Promise.all` as
  // the four folded maps, so an UNMOCKED export here is not a missing assertion
  // — it rejects and the whole list 500s, which is how twelve cases in this file
  // went red at once.
  listSharedIntoChannelBaseIds: vi.fn(),
}));

vi.mock("@/features/workspaces/server/service-overview", () => ({
  isChannelVisibleTo: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  assertCreateBaseAllowed,
  createBase,
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listStarredBaseIds,
  listHomeScopedBaseIds,
  listPinnedBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";
import {
  getChannelGrantMap,
  listSharedIntoChannelBaseIds,
} from "@/features/knowledge/server/service-channel-grants";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";

const mockListBases = vi.mocked(listBases);
const mockOwnerNames = vi.mocked(listBaseOwnerNames);
const mockBaseStats = vi.mocked(listBaseStats);
const mockStorageLimit = vi.mocked(resolveKbStorageLimit);
const mockStarred = vi.mocked(listStarredBaseIds);
const mockHomeScoped = vi.mocked(listHomeScopedBaseIds);
const mockPinned = vi.mocked(listPinnedBaseIds);
const mockGrantMap = vi.mocked(getChannelGrantMap);
const mockShared = vi.mocked(listSharedIntoChannelBaseIds);
const mockChannelVisible = vi.mocked(isChannelVisibleTo);
const mockGate = vi.mocked(assertCreateBaseAllowed);
const mockCreate = vi.mocked(createBase);

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
  mockPinned.mockResolvedValue([]);
  // ⚠ NOT the shelf flag's base: two keys always naming the same row would pass
  // whichever one the route dropped.
  mockShared.mockResolvedValue(["kb-2"]);
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
      sharedBaseIds: ["kb-2"],
      pinnedBaseIds: [],
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
    // What the REAL read answers for an empty id list: it short-circuits with no
    // query (`repository-channel-grants.ts › listSharedBaseIds`).
    mockShared.mockResolvedValue([]);

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bases: [],
      ownerNames: {},
      baseStats: {},
      kbStorageLimit: 5_000_000,
      starredBaseIds: [],
      homeScopedBaseIds: [],
      sharedBaseIds: [],
      pinnedBaseIds: [],
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

  /**
   * 🔒 **`sharedBaseIds` IS A SIBLING KEY FOR THE SAME REASON `homeScopedBaseIds`
   * IS (2026-09-01).** "Is this base granted into any channel" is a fact about
   * GRANTS, not a column on the base, so folding it onto the row would widen
   * `KnowledgeBase` — the type `check-knowledge-type-drift` mirrors into the SDK.
   * ⚠ **A SET, NEVER A CHANNEL LIST**, fenced to the ids about to be returned:
   * the pill asks one boolean per base, and anything richer would put the
   * identity of channels the caller may not see on the wire.
   */
  it("folds sharedBaseIds in as a SIBLING KEY, over exactly the visible ids", async () => {
    const body = (await (await GET(getReq(), { params: Promise.resolve({}) })).json()) as {
      bases: Array<Record<string, unknown>>;
      sharedBaseIds: string[];
    };
    expect(body.sharedBaseIds).toEqual(["kb-2"]);
    expect(mockShared).toHaveBeenCalledWith("ws-1", ["kb-1", "kb-2"]);
    for (const b of body.bases) {
      expect("shared" in b).toBe(false);
      expect("sharedBaseIds" in b).toBe(false);
    }
  });

  it("degrades a shared-grant failure to [] — every card keeps its scope word", async () => {
    // ⚠ THE DIRECTION IS STATED, NOT CALLED SAFE: `[]` reproduces what shipped
    // before this key existed (every private base labelled "Private"), which
    // UNDER-states a base's exposure to its own owner. Failing the whole list is
    // worse — `kb_list_bases` over MCP rides this route.
    mockShared.mockRejectedValue(new Error("grants table down"));

    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sharedBaseIds).toEqual([]);
    expect(body.bases).toHaveLength(2);
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

/**
 * 🔒 **`POST …?dryRun=1` — THE CREATE'S GATES, RUN WITHOUT THE CREATE**
 * (2026-09-06, task 11's missing preview-parity pin).
 *
 * ⚠ **WHY THE ROUTE OWNS A TEST FOR THIS.** The MCP confirm class previews an
 * audience-changing create in a DIFFERENT PROCESS from the gates, so it was
 * minting a `confirm_token` for a create the confirmed call then refused. The
 * repair is that the preview asks the server, and this is the door it asks
 * through: the arm must run the gate, must NOT write, and must not become a
 * second create path that drifts from the first.
 */
describe("POST /api/knowledge/bases?dryRun=1", () => {
  function postReq(query = ""): NextRequest {
    return new NextRequest(`http://localhost/api/knowledge/bases${query}`, {
      method: "POST",
      body: JSON.stringify({ name: "Notes" }),
      headers: { "content-type": "application/json" },
    });
  }

  it("runs the GATE and creates NOTHING", async () => {
    mockGate.mockResolvedValue({
      destination: { homeScoped: true, workspaceId: "ws-personal" },
      visibility: "private",
      teamGrants: [],
    });

    const res = await POST(postReq("?dryRun=1"), { params: Promise.resolve({}) });

    // 200, never 201 — nothing was created, and a created-shaped status is how
    // a caller learns the wrong lesson from a dry run.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dryRun: true });
    expect(mockGate).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("answers the create's OWN refusal, through the same envelope", async () => {
    // ⚠ The preview must be refused in the SERVER'S words: that sentence names
    // the room, the cause and the remedy, and the MCP renders it verbatim.
    mockGate.mockRejectedValue(new Error("gate says no"));

    const res = await POST(postReq("?dryRun=1"), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("without the param it CREATES, exactly as before", async () => {
    mockCreate.mockResolvedValue(base("kb-new", "user-1"));

    const res = await POST(postReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
    // ⚠ The gate still runs — inside `createBase`, which is the whole point of
    // the parity. This arm just does not run it twice.
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("🔒 400s an unrecognised value instead of falling through to the WRITE", async () => {
    // ⚠ THE DIRECTION IS THE OPPOSITE OF `?shelf=`'s AND FOR A HARDER REASON: a
    // silently dropped `?dryRun=yes` would CREATE the base the caller was only
    // asking about. Fail loud, and never toward the write.
    const res = await POST(postReq("?dryRun=yes"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGate).not.toHaveBeenCalled();
  });
});
