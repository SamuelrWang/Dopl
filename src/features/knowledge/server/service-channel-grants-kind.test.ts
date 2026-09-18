/**
 * `setChannelKnowledgeGrant` and the container-kind fence — Samuel's ruling
 * 2026-09-17: in workspaces, resource access is scoped by teams, not channels.
 *
 * The one door both knowledge write paths pass through:
 * `PUT /api/knowledge/bases/{id}/channel-grants` and
 * `POST /api/knowledge/bases`'s `shareToChannelId` branch both land here.
 *
 * The fence itself is stubbed and its own behaviour is pinned in
 * `src/shared/tenancy/channel-scope.test.ts`. What THIS file pins is that the
 * door ASKS, about the right container, AFTER the manage gate, and that all
 * three levels — including `"none"` — are refused.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/shared/tenancy/channel-scope", () => ({
  assertChannelScopeAllowedInContainer: vi.fn(),
}));

vi.mock("./repository-channel-grants", () => ({
  listChannelKnowledgeGrants: vi.fn(),
  listChannelGrantsForBase: vi.fn(),
  upsertChannelKnowledgeGrant: vi.fn(),
  deleteChannelKnowledgeGrant: vi.fn(),
  listSharedBaseIds: vi.fn(),
}));

import {
  deleteChannelKnowledgeGrant,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";
import { assertChannelScopeAllowedInContainer } from "@/shared/tenancy/channel-scope";
import { setChannelKnowledgeGrant } from "./service-channel-grants";
import { ScopeChangeForbiddenError } from "./errors";
import { HttpError } from "@/shared/lib/http-error";
import type { KnowledgeBase, KnowledgeContext } from "../types";

const mockUpsert = vi.mocked(upsertChannelKnowledgeGrant);
const mockDelete = vi.mocked(deleteChannelKnowledgeGrant);
const mockFence = vi.mocked(assertChannelScopeAllowedInContainer);

const OWNER: KnowledgeContext = {
  workspaceId: "ws-1",
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  role: "member",
  source: "user",
  apiKeyWorkspaceId: null,
};
const BASE = { id: "kb-1", slug: "notes", createdBy: "user-1" } as KnowledgeBase;

const STORED = {
  channel_id: "chan-1",
  resource_type: "knowledge_base",
  resource_id: "kb-1",
  workspace_id: "ws-1",
  level: "visible" as const,
  guest_write: false,
  created_by: "user-1",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z",
};

function write(level: "none" | "agent_only" | "visible") {
  return setChannelKnowledgeGrant(OWNER, BASE, {
    channelId: "chan-1",
    level,
    guestWrite: false,
  });
}

const REFUSAL = new HttpError(
  400,
  "SCOPE_NOT_ALLOWED_IN_WORKSPACE",
  "refused"
);

beforeEach(() => {
  vi.clearAllMocks();
  // Admits by default — a home container. Each refusal case says so itself.
  mockFence.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(STORED);
});

describe("🔒 the container-KIND fence on the knowledge write door", () => {
  it("refuses `visible` in a STANDARD workspace and writes nothing", async () => {
    mockFence.mockRejectedValue(REFUSAL);
    await expect(write("visible")).rejects.toMatchObject({
      status: 400,
      code: "SCOPE_NOT_ALLOWED_IN_WORKSPACE",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses `agent_only` too — both audiences, one rule", async () => {
    mockFence.mockRejectedValue(REFUSAL);
    await expect(write("agent_only")).rejects.toMatchObject({
      code: "SCOPE_NOT_ALLOWED_IN_WORKSPACE",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("🔒 refuses `none` as well — the DELETE is not a way round the rule", async () => {
    // There is nothing to remove there, and a delete that quietly succeeded
    // would teach a client that the three-state control still works in a
    // workspace.
    mockFence.mockRejectedValue(REFUSAL);
    await expect(write("none")).rejects.toMatchObject({
      code: "SCOPE_NOT_ALLOWED_IN_WORKSPACE",
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("asks about the CALLER's container, which is the channel's", async () => {
    // The route fenced `channelId` with `isChannelVisibleTo(ctx.workspaceId, …)`
    // and the create branch fences it the same way, so the two are the same
    // container by the time this runs.
    await write("visible");
    expect(mockFence).toHaveBeenCalledWith("ws-1");
  });

  it("writes normally when the container admits channel scope", async () => {
    await expect(write("visible")).resolves.toEqual({
      level: "visible",
      guestWrite: false,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("🔒 runs AFTER the manage gate — a non-manager never learns the kind", async () => {
    const stranger = { ...OWNER, userId: "someone-else" };
    await expect(
      setChannelKnowledgeGrant(stranger, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toBeInstanceOf(ScopeChangeForbiddenError);
    expect(mockFence).not.toHaveBeenCalled();
  });

  it("🔒 …and AFTER the agent refusal, which is older and narrower", async () => {
    const agent = { ...OWNER, source: "agent" as const };
    await expect(
      setChannelKnowledgeGrant(agent, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toMatchObject({ name: "AgentWriteDisabledError" });
    expect(mockFence).not.toHaveBeenCalled();
  });
});
