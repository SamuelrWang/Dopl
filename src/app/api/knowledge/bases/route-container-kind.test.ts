/**
 * 🔒 **`GET /api/knowledge/bases` IN A STANDARD WORKSPACE** — Samuel's ruling
 * 2026-09-17: *"In workspaces, resource access is not scoped by channels. It's
 * instead scoped by teams."*
 *
 * Neither channel-shaped key on this route means anything there, so the reads
 * behind them are NOT SPENT: `sharedBaseIds` answers `[]` without asking the
 * grants table, and `channelGrants` is omitted without asking for the map.
 *
 * ⚠ **ITS OWN FILE BECAUSE `AUTH` IS A MODULE CONSTANT THE WRAPPER MOCK CLOSES
 * OVER.** `route.test.ts` pins the HOME (`kind='link'`) behaviour of the same
 * two keys, and a file that mutated one context between describes would make
 * every case in it order-dependent. Two kinds, two files, one route.
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
  // 🔒 THE WHOLE FILE. ⚠ An ABSENT `workspaceKind` would read as `standard`
  // too (§4A's positive predicate) — it is spelled out so the case is a
  // statement rather than a default nobody set.
  workspaceKind: "standard",
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
  assertCreateBaseAllowed: vi.fn(),
  listBases: vi.fn(),
  listBaseOwnerNames: vi.fn(),
  listBaseStats: vi.fn(),
  listStarredBaseIds: vi.fn(),
  listHomeScopedBaseIds: vi.fn(),
  listPinnedBaseIds: vi.fn(),
  resolveKbStorageLimit: vi.fn(),
}));

vi.mock("@/features/knowledge/server/service-channel-grants", () => ({
  getChannelGrantMap: vi.fn(),
  listSharedIntoChannelBaseIds: vi.fn(),
}));

vi.mock("@/features/workspaces/server/service-overview", () => ({
  isChannelVisibleTo: vi.fn(),
}));

import { GET } from "./route";
import {
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

const mockGrantMap = vi.mocked(getChannelGrantMap);
const mockShared = vi.mocked(listSharedIntoChannelBaseIds);
const mockChannelVisible = vi.mocked(isChannelVisibleTo);

const VISIBLE = [
  { id: "kb-1", createdBy: "user-1" } as unknown as KnowledgeBase,
];

function getReq(channelId?: string): NextRequest {
  const url = channelId
    ? `http://localhost/api/knowledge/bases?channelId=${channelId}`
    : "http://localhost/api/knowledge/bases";
  return new NextRequest(url, { method: "GET" });
}

const ROUTE_CTX = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listBases).mockResolvedValue(VISIBLE);
  vi.mocked(listBaseOwnerNames).mockResolvedValue({});
  vi.mocked(listBaseStats).mockResolvedValue({});
  vi.mocked(resolveKbStorageLimit).mockResolvedValue(null);
  vi.mocked(listStarredBaseIds).mockResolvedValue([]);
  vi.mocked(listHomeScopedBaseIds).mockResolvedValue([]);
  vi.mocked(listPinnedBaseIds).mockResolvedValue([]);
  mockShared.mockResolvedValue(["kb-1"]);
  mockGrantMap.mockResolvedValue({ "kb-1": { level: "visible", guestWrite: false } });
});

describe("🔒 GET /api/knowledge/bases in a STANDARD workspace", () => {
  it("answers sharedBaseIds [] and never asks the grants table", async () => {
    const body = (await (await GET(getReq(), ROUTE_CTX)).json()) as {
      sharedBaseIds: string[];
    };
    expect(body.sharedBaseIds).toEqual([]);
    expect(mockShared).not.toHaveBeenCalled();
  });

  it("omits channelGrants even for a VISIBLE channel", async () => {
    mockChannelVisible.mockResolvedValue(true);
    const body = (await (await GET(getReq("chan-1"), ROUTE_CTX)).json()) as Record<
      string,
      unknown
    >;
    expect("channelGrants" in body).toBe(false);
    expect(mockGrantMap).not.toHaveBeenCalled();
  });

  it("🔒 still 404s an INVISIBLE channel — the fence runs BEFORE the skip", async () => {
    // ⚠ THE MUTATION THIS CATCHES is moving the kind check above
    // `isChannelVisibleTo`: a bad `channelId` would then answer 200 in one
    // container kind and 404 in another, which is a cheaper oracle than the one
    // the fence exists to close.
    mockChannelVisible.mockResolvedValue(false);
    const res = await GET(getReq("chan-1"), ROUTE_CTX);
    expect(res.status).toBe(404);
    expect(mockChannelVisible).toHaveBeenCalled();
  });

  it("still folds every NON-channel sibling key", async () => {
    const body = (await (await GET(getReq(), ROUTE_CTX)).json()) as Record<
      string,
      unknown
    >;
    for (const key of [
      "bases",
      "ownerNames",
      "baseStats",
      "starredBaseIds",
      "homeScopedBaseIds",
      "pinnedBaseIds",
    ]) {
      expect(key in body, key).toBe(true);
    }
  });
});
