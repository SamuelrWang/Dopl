/**
 * 🔒 CREATE-AND-SHARE — one call, two writes, rolled back together (Samuel's
 * ruling 2026-08-27: the /home Shared section's create button).
 *
 * WHY ATOMICITY IS THE WHOLE FEATURE HERE, and not a nicety. The same ruling
 * deleted the /home pane's per-channel PRIVATE scope, so **a container base
 * reaches /home only through a channel grant** (INVARIANTS §5A). A create whose
 * base landed and whose grant did not therefore produces a row that:
 *   - exists, and bills against the workspace's storage;
 *   - is shared with nobody;
 *   - is INVISIBLE on the surface that just created it, with no error shown;
 *   - and owns the slug, so the operator's second attempt collides with it.
 * That is four bad outcomes from one missing `catch`, and none of them look
 * like a failure from the outside.
 *
 * ⚠ THE GRANT SERVICE IS MOCKED HERE — this file is about the WIRING and the
 * ROLLBACK, not about what a grant row contains. Its own gates (the agent
 * refusal, `canManageChannelGrants`, the same-workspace trigger) are pinned in
 * `service-channel-grants.test.ts`, and the CHANNEL fence is at the route
 * (`src/app/api/knowledge/bases/route.test.ts`). Three files, three questions.
 *
 * ⚠ MUTATION-VERIFIED; counts in this change's report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", () => ({
  listBaseSlugsForWorkspace: vi.fn(),
  insertBase: vi.fn(),
  hardDeleteBase: vi.fn(),
  findBaseById: vi.fn(),
  findBaseBySlug: vi.fn(),
  listBasesForWorkspace: vi.fn(),
}));

vi.mock("./service-channel-grants", () => ({
  setChannelKnowledgeGrant: vi.fn(),
}));

vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn(),
}));

vi.mock("@/features/teams/server/repository", () => ({
  deleteGrantRow: vi.fn(),
  deleteGrantsForResource: vi.fn(),
  listGrantsForResource: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  upsertGrant: vi.fn(),
}));

import * as repo from "./repository";
import { setChannelKnowledgeGrant } from "./service-channel-grants";
import { createBase } from "./service-base-writes";

const mockRepo = vi.mocked(repo);
const mockGrant = vi.mocked(setChannelKnowledgeGrant);

const WS = "ws-container";
const CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";

const CTX: KnowledgeContext = {
  workspaceId: WS,
  userId: "u-operator",
  role: "owner",
  source: "user",
  apiKeyWorkspaceId: null,
  credentialSubjectUserId: "u-operator",
  sessionId: null,
};

const CREATED = {
  id: "kb-new",
  workspaceId: WS,
  slug: "handover",
} as KnowledgeBase;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listBaseSlugsForWorkspace.mockResolvedValue([]);
  mockRepo.insertBase.mockResolvedValue(CREATED);
  mockRepo.hardDeleteBase.mockResolvedValue(undefined as never);
  mockGrant.mockResolvedValue({ level: "visible", guestWrite: false });
});

describe("createBase with shareToChannelId", () => {
  it("grants at `visible` with guestWrite OFF, reusing the sharing service", async () => {
    // ⚠ NOT A FORKED WRITE PATH. The same function the base's own sharing
    // section calls — so the agent refusal, `canManageChannelGrants` and the
    // trigger translation are inherited rather than re-implemented.
    await createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL });

    expect(mockGrant).toHaveBeenCalledWith(CTX, CREATED, {
      channelId: CHANNEL,
      // ⚠ `visible`, NEVER `agent_only`: the button says "shared", and
      // `agent_only` is a different audience (the operator's agent, not the
      // person in the room). ⚠ `guestWrite` OFF: handing a guest a pen is its
      // own decision, taken later and deliberately.
      level: "visible",
      guestWrite: false,
    });
  });

  it("🔒 HARD-DELETES the base when the grant fails, and re-throws", async () => {
    const boom = new Error("grant refused");
    mockGrant.mockRejectedValue(boom);

    await expect(
      createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL })
    ).rejects.toBe(boom);

    // ⚠ HARD delete, not soft: a tombstone still owns the slug, so the
    // operator's retry would collide with a row they cannot see.
    expect(mockRepo.hardDeleteBase).toHaveBeenCalledWith(WS, CREATED.id);
  });

  it("surfaces the ORIGINAL failure even when the rollback itself fails", async () => {
    // ⚠ The caller must be told why the SHARE failed. A rollback error thrown
    // in its place would replace a real explanation with a cleanup detail —
    // and the orphan row is a smaller problem than a misleading message.
    const boom = new Error("grant refused");
    mockGrant.mockRejectedValue(boom);
    mockRepo.hardDeleteBase.mockRejectedValue(new Error("delete failed"));

    await expect(
      createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL })
    ).rejects.toBe(boom);
  });

  it("leaves an ordinary create untouched — no grant, no rollback path", async () => {
    // MCP `kb_create_base`, the workspace Knowledge page, and the /home
    // PERSONAL button all land here.
    const base = await createBase(CTX, { name: "Ordinary" });

    expect(base).toBe(CREATED);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteBase).not.toHaveBeenCalled();
  });
});
