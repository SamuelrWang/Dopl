/**
 * `GET|PUT /api/knowledge/bases/{baseId}/channel-grants` — the scope-A grant
 * settings read and the three-state write.
 *
 * The properties under test are the FENCES AND THEIR ORDER, plus the two shapes
 * that carry meaning: `level:"none"` is a DELETE (and answers `grant: null`),
 * and a grant on a channel the caller cannot see is DROPPED from the read
 * rather than named. Auth is mocked at the wrapper — what is exercised is the
 * composition, not `withWorkspaceAuth`; the `sessionOnly` gate itself is pinned
 * by `shared/auth/write-gate-coverage.test.ts` and re-asserted here as SOURCE,
 * because a mocked wrapper cannot enforce it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    (req: Request, routeCtx: { params: Promise<Record<string, string>> }) =>
      routeCtx.params.then((params) => handler(req, { ...AUTH, params })),
}));

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
  }),
  getBaseById: vi.fn(),
}));

vi.mock("@/features/knowledge/server/service-channel-grants", () => ({
  canManageChannelGrants: vi.fn(),
  getBaseGrantMap: vi.fn(),
  setChannelKnowledgeGrant: vi.fn(),
}));

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  listChannels: vi.fn(),
}));

vi.mock("@/features/workspaces/server/service-overview", () => ({
  isChannelVisibleTo: vi.fn(),
}));

import { GET, PUT } from "./route";
import { getBaseById } from "@/features/knowledge/server/service";
import {
  canManageChannelGrants,
  getBaseGrantMap,
  setChannelKnowledgeGrant,
} from "@/features/knowledge/server/service-channel-grants";
import { listChannels } from "@/features/channels/server/service";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import { ScopeChangeForbiddenError } from "@/features/knowledge/server/errors";
import { ChannelGrantInvalidError } from "@/features/knowledge/server/errors";
import { KnowledgeBaseNotFoundError } from "@/features/knowledge/server/errors";

const mockGetBase = vi.mocked(getBaseById);
const mockCanManage = vi.mocked(canManageChannelGrants);
const mockBaseGrants = vi.mocked(getBaseGrantMap);
const mockSetGrant = vi.mocked(setChannelKnowledgeGrant);
const mockListChannels = vi.mocked(listChannels);
const mockChannelVisible = vi.mocked(isChannelVisibleTo);

const BASE = { id: "kb-1", workspaceId: "ws-1", createdBy: "user-1" } as KnowledgeBase;

function channel(id: string, name: string, isDirect = false) {
  return {
    id,
    name,
    isDirect,
    directPeer: isDirect ? { userId: "u9", displayName: "Dana Ortiz", avatarUrl: null } : null,
  } as unknown as Awaited<ReturnType<typeof listChannels>>[number];
}

const ROUTE_CTX = { params: Promise.resolve({ baseId: "kb-1" }) };

function putReq(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/knowledge/bases/kb-1/channel-grants",
    { method: "PUT", body: JSON.stringify(body) }
  );
}

function getReq(): NextRequest {
  return new NextRequest(
    "http://localhost/api/knowledge/bases/kb-1/channel-grants",
    { method: "GET" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBase.mockResolvedValue(BASE);
  mockCanManage.mockReturnValue(true);
  mockChannelVisible.mockResolvedValue(true);
  mockListChannels.mockResolvedValue([
    channel("chan-1", "engineering"),
    channel("chan-2", "design"),
  ]);
  mockBaseGrants.mockResolvedValue({});
});

describe("GET …/channel-grants", () => {
  it("returns the caller's fenced channels, this base's grants, and canManage", async () => {
    mockBaseGrants.mockResolvedValue({
      "chan-1": { level: "visible", guestWrite: true },
    });

    const res = await GET(getReq(), ROUTE_CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      canManage: true,
      channels: [
        { id: "chan-1", name: "engineering", isDirect: false },
        { id: "chan-2", name: "design", isDirect: false },
      ],
      // ABSENT, never `{level:"none"}` — the map mirrors storage.
      grants: { "chan-1": { level: "visible", guestWrite: true } },
    });
    // Archived channels are out of the fence read: `includeArchived` is false.
    expect(mockListChannels).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "user-1" },
      false
    );
  });

  it("DROPS a grant on a channel the caller cannot see, rather than naming it", async () => {
    // The KB owner shared into a private room they were later removed from.
    // The fail-safe direction is a shorter list, never a leaked channel id.
    mockBaseGrants.mockResolvedValue({
      "chan-1": { level: "visible", guestWrite: false },
      "chan-invisible": { level: "agent_only", guestWrite: false },
    });

    const body = (await (await GET(getReq(), ROUTE_CTX)).json()) as {
      grants: Record<string, unknown>;
    };
    expect(Object.keys(body.grants)).toEqual(["chan-1"]);
  });

  it("labels a DM by its peer, not by the channel's internal name", async () => {
    mockListChannels.mockResolvedValue([channel("dm-1", "dm-abc123", true)]);
    const body = (await (await GET(getReq(), ROUTE_CTX)).json()) as {
      channels: Array<{ name: string; isDirect: boolean }>;
    };
    expect(body.channels).toEqual([
      { id: "dm-1", name: "Dana Ortiz", isDirect: true },
    ]);
  });

  it("404s a base the caller cannot see, and reads no grants", async () => {
    mockGetBase.mockRejectedValue(new KnowledgeBaseNotFoundError("kb-1"));

    const res = await GET(getReq(), ROUTE_CTX);
    expect(res.status).toBe(404);
    expect(mockBaseGrants).not.toHaveBeenCalled();
    expect(mockListChannels).not.toHaveBeenCalled();
  });

  it("reports canManage false for a non-manager instead of hiding the section", async () => {
    mockCanManage.mockReturnValue(false);
    const body = (await (await GET(getReq(), ROUTE_CTX)).json()) as {
      canManage: boolean;
      channels: unknown[];
    };
    expect(body.canManage).toBe(false);
    // The read is still allowed — the summary line needs the count.
    expect(body.channels).toHaveLength(2);
  });
});

describe("PUT …/channel-grants", () => {
  it("writes a level and answers with the STORED grant", async () => {
    mockSetGrant.mockResolvedValue({ level: "visible", guestWrite: true });

    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "visible", guestWrite: true }),
      ROUTE_CTX
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channelId: "11111111-1111-4111-8111-111111111111",
      grant: { level: "visible", guestWrite: true },
    });
    expect(mockSetGrant).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "user-1", role: "member" },
      BASE,
      {
        channelId: "11111111-1111-4111-8111-111111111111",
        level: "visible",
        guestWrite: true,
      }
    );
  });

  it("carries `level:\"none\"` through as a DELETE and answers grant: null", async () => {
    mockSetGrant.mockResolvedValue(null);

    const body = (await (
      await PUT(
        putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "none" }),
        ROUTE_CTX
      )
    ).json()) as { grant: unknown };
    // `null` is the answer, never `{level:"none"}` — absence is the third state.
    expect(body.grant).toBeNull();
    expect(mockSetGrant).toHaveBeenCalledWith(expect.anything(), BASE, {
      channelId: "11111111-1111-4111-8111-111111111111",
      level: "none",
      // Omitted `guestWrite` defaults to FALSE rather than inheriting.
      guestWrite: false,
    });
  });

  it("403s a caller who may not manage sharing", async () => {
    mockSetGrant.mockRejectedValue(new ScopeChangeForbiddenError());

    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "visible" }),
      ROUTE_CTX
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SCOPE_CHANGE_FORBIDDEN");
  });

  it("404s a NON-VISIBLE channel and never reaches the grant write", async () => {
    mockChannelVisible.mockResolvedValue(false);

    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "visible" }),
      ROUTE_CTX
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CHANNEL_NOT_FOUND");
    // The fence runs BEFORE the service-role write.
    expect(mockSetGrant).not.toHaveBeenCalled();
  });

  it("404s an invisible BASE before it ever fences the channel", async () => {
    mockGetBase.mockRejectedValue(new KnowledgeBaseNotFoundError("kb-1"));

    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "visible" }),
      ROUTE_CTX
    );
    expect(res.status).toBe(404);
    expect(mockChannelVisible).not.toHaveBeenCalled();
    expect(mockSetGrant).not.toHaveBeenCalled();
  });

  it("surfaces the same-workspace TRIGGER RAISE as a 400, never a 500", async () => {
    mockSetGrant.mockRejectedValue(new ChannelGrantInvalidError());

    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "agent_only" }),
      ROUTE_CTX
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("CHANNEL_GRANT_INVALID");
    // ⚠ The trigger's own message names BOTH workspace ids; it must not ride out.
    expect(body.error.message).not.toMatch(/ws-|workspace mismatch/);
  });

  it("400s a body that is not one of the three states", async () => {
    const res = await PUT(
      putReq({ channelId: "11111111-1111-4111-8111-111111111111", level: "owner" }),
      ROUTE_CTX
    );
    expect(res.status).toBe(400);
    expect(mockSetGrant).not.toHaveBeenCalled();
  });

  it("400s a non-uuid channelId before any fence read", async () => {
    const res = await PUT(putReq({ channelId: "chan-1", level: "visible" }), ROUTE_CTX);
    expect(res.status).toBe(400);
    expect(mockChannelVisible).not.toHaveBeenCalled();
  });
});

describe("the gate options, read off the SOURCE", () => {
  // ⚠ The wrapper is mocked above, so no behavioural assertion in this file can
  // see `sessionOnly`. `write-gate-coverage.test.ts` pins the SET; this pins
  // that it is the PUT — and only the PUT — that carries it here.
  const src = readFileSync(resolve(__dirname, "route.ts"), "utf8");

  it("gates the PUT to interactive sessions and leaves the GET open", () => {
    expect(src).toMatch(
      /export const PUT = withWorkspaceAuth\(handlePut, \{[\s\S]*?sessionOnly: true,[\s\S]*?\}\)/
    );
    expect(src).toMatch(/export const GET = withWorkspaceAuth\(handleGet\);/);
  });

  it("floors the write at member+", () => {
    expect(src).toMatch(
      /export const PUT = withWorkspaceAuth\(handlePut, \{[\s\S]*?minRole: "member",/
    );
  });
});
