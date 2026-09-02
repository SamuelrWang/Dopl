/**
 * `GET /api/knowledge/bases?shelf=` and `POST /api/knowledge/bases` — the SHELF
 * filter and the create-and-share branch.
 *
 * ⚠ **A SIBLING OF `route.test.ts`, SPLIT OFF AT THE 500-LINE CAP (2026-09-01,
 * §1).** That file was ONE line under it, and T81's `pinnedBaseIds` fold could
 * not be absorbed — §1's rule that a file at the cap cannot take a line, applied
 * to a test. The split is by QUESTION, not by size: `route.test.ts` keeps "what
 * does the GET fold onto the list", this file keeps "what does a PARAMETER
 * change" (the shelf filter) and "what does the POST fence" (the share branch).
 *
 * ⚠ **THE MOCK PREAMBLE IS DUPLICATED AND THAT IS FORCED, NOT SLOPPY.**
 * `vi.mock` is hoisted per FILE and cannot be imported from a shared module, so
 * a split test file must restate the module mocks it needs. What must NOT drift
 * is the service mock's COMPLETENESS: the route imports every one of those
 * exports, so an omission here rejects at property access and 500s every case —
 * the trap `listSharedIntoChannelBaseIds` and `listPinnedBaseIds` each record in
 * `route.test.ts`.
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
  createBase,
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listStarredBaseIds,
  listHomeScopedBaseIds,
  listPinnedBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";
import { listSharedIntoChannelBaseIds } from "@/features/knowledge/server/service-channel-grants";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";

const mockListBases = vi.mocked(listBases);
const mockCreateBase = vi.mocked(createBase);
const mockOwnerNames = vi.mocked(listBaseOwnerNames);
const mockBaseStats = vi.mocked(listBaseStats);
const mockStorageLimit = vi.mocked(resolveKbStorageLimit);
const mockStarred = vi.mocked(listStarredBaseIds);
const mockHomeScoped = vi.mocked(listHomeScopedBaseIds);
const mockPinned = vi.mocked(listPinnedBaseIds);
const mockShared = vi.mocked(listSharedIntoChannelBaseIds);
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
