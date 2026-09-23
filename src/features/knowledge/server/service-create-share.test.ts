/**
 * Create-and-share — one call, two writes, rolled back together (Samuel's ruling
 * 2026-08-27: the /home Shared section's create button).
 *
 * Atomicity is the feature: a container base reaches /home only through a channel
 * grant (INVARIANTS §5A), so a base that landed without its grant exists, bills
 * storage, is shared with nobody, is invisible on the surface that created it,
 * and owns the slug the retry needs.
 *
 * The grant service is MOCKED — this file is about the wiring and the
 * rollback. Its own gates are pinned in `service-channel-grants.test.ts`, and the
 * CHANNEL fence is at the route (`src/app/api/knowledge/bases/route.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

// The changelog capture is a real awaited write (`./service-revisions.ts`,
// 2026-09-09), so an unstubbed service test reaches `supabaseAdmin()` and fails
// on a missing service-role key. That the row is recorded once per path is
// `service-revisions.test.ts`'s subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

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

// ⚠ **`findWorkspaceById` ADDED 2026-09-18**: a private create now asks
// `workspaces/server/home-channel-destination.ts › assertHomeChannelRowIsShared`
// where the row is LANDING. Answered as a STANDARD workspace, which the rule
// leaves alone — every direction of it is
// `workspaces/server/home-channel-destination.test.ts`.
vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn(),
  findWorkspaceById: vi.fn(async () => ({ id: "ws-1", kind: "standard" })),
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
import { findWorkspaceById } from "@/features/workspaces/server/repository";
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
  // ⚠ RESET PER CASE, because two cases below point it at a `link` container:
  // a kind that leaked into the next test would refuse a create that is fine.
  vi.mocked(findWorkspaceById).mockResolvedValue(
    { id: WS, kind: "standard" } as never
  );
});

describe("createBase with shareToChannelId", () => {
  it("grants at `visible` with guestWrite OFF, reusing the sharing service", async () => {
    // not a forked write path: the same function the base's own sharing section
    // calls, so its gates are inherited rather than re-implemented.
    await createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL });

    expect(mockGrant).toHaveBeenCalledWith(CTX, CREATED, {
      channelId: CHANNEL,
      // `visible`, never `agent_only`: the button says "shared", and
      // `agent_only` is a different audience. `guestWrite` off: handing a guest
      // a pen is its own decision.
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

    // hard delete, not soft: a tombstone still owns the slug, so the operator's
    // retry would collide with a row they cannot see.
    expect(mockRepo.hardDeleteBase).toHaveBeenCalledWith(WS, CREATED.id);
  });

  it("surfaces the ORIGINAL failure even when the rollback itself fails", async () => {
    // the caller must be told why the SHARE failed; an orphan row is a smaller
    // problem than a cleanup error in place of the real explanation.
    const boom = new Error("grant refused");
    mockGrant.mockRejectedValue(boom);
    mockRepo.hardDeleteBase.mockRejectedValue(new Error("delete failed"));

    await expect(
      createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL })
    ).rejects.toBe(boom);
  });

  it("🔒 A HOME CHANNEL REFUSES AN UNSHARED PRIVATE CREATE — the destination fence", async () => {
    // 🔒 Samuel's ruling, 2026-09-18: a `kind='link'` container holds only what
    // is shared into it, so `private` with no `shareToChannelId` names the
    // destination he deleted. ⚠ THE WIRING CASE — this feature answers "shared"
    // with the GRANT where the identity lane answers with the audience column;
    // the rule itself is `workspaces/server/home-channel-destination.test.ts`.
    vi.mocked(findWorkspaceById).mockResolvedValue(
      { id: WS, kind: "link" } as never
    );
    await expect(createBase(CTX, { name: "Orphan" })).rejects.toMatchObject({
      code: "HOME_CHANNEL_ROW_NOT_SHARED",
    });
    // ⚠ NOTHING LANDED. The fence runs with the other pre-write gates, above
    // the slug read, so a refusal costs no slug and cannot half-land.
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });

  it("…and the create-AND-SHARE in that same channel is allowed", async () => {
    // ⚠ THE OTHER DIRECTION, which is the whole point: destination 2 exists and
    // this is the only call shape that reaches it.
    vi.mocked(findWorkspaceById).mockResolvedValue(
      { id: WS, kind: "link" } as never
    );
    await expect(
      createBase(CTX, { name: "Handover", shareToChannelId: CHANNEL })
    ).resolves.toBeTruthy();
  });

  it("leaves an ordinary create untouched — no grant, no rollback path", async () => {
    // MCP `kb_create_base`, the workspace Knowledge page and the /home PERSONAL
    // button all land here.
    const base = await createBase(CTX, { name: "Ordinary" });

    expect(base).toBe(CREATED);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteBase).not.toHaveBeenCalled();
  });
});
