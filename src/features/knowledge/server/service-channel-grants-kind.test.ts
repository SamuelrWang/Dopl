/**
 * `setChannelKnowledgeGrant` and the TWO container-kind fences on its door.
 *
 *  1. **CHANNEL SCOPE IS A HOME-CHANNEL MECHANISM** — Samuel's ruling 2026-09-17:
 *     in workspaces, resource access is scoped by teams, not channels. The fence
 *     is stubbed here and its own behaviour is pinned in
 *     `src/shared/tenancy/channel-scope.test.ts`.
 *  2. 🔒 **A HOME CHANNEL HOLDS ONLY WHAT IS SHARED INTO IT** — Samuel's ruling
 *     2026-09-18, on the REVOKE verb. Dropping the last channel grant on a
 *     `private` base inside a `kind='link'` container re-mints the orphan the
 *     create fence exists to prevent, so the `"none"` branch refuses. The rule's
 *     own kind axis is pinned by
 *     `workspaces/server/home-channel-destination.test.ts`; what THIS file pins
 *     is the WIRING — which state the knowledge lane calls "shared".
 *
 * Both read the same door: `PUT /api/knowledge/bases/{id}/channel-grants` and
 * `POST /api/knowledge/bases`'s `shareToChannelId` branch land here, and what
 * this file pins about each fence is that the door ASKS, about the right
 * container, and in the right ORDER.
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

// ⚠ **ADDED 2026-09-18 WITH THE REVOKE FENCE**: the `"none"` branch now asks
// `workspaces/server/home-channel-destination.ts › isHomeChannelContainer`
// which container the BASE lives in. Answered as a STANDARD workspace by
// default, which the rule leaves alone — every direction of the kind axis is
// `workspaces/server/home-channel-destination.test.ts`'s subject, not this
// file's.
vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(async () => ({ id: "ws-1", kind: "standard" })),
}));

import {
  deleteChannelKnowledgeGrant,
  listChannelGrantsForBase,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";
import { assertChannelScopeAllowedInContainer } from "@/shared/tenancy/channel-scope";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { setChannelKnowledgeGrant } from "./service-channel-grants";
import { ScopeChangeForbiddenError } from "./errors";
import { HttpError } from "@/shared/lib/http-error";
import { HomeChannelRowNotSharedError } from "@/features/workspaces/server/home-channel-destination";
import type { KnowledgeBase, KnowledgeContext } from "../types";

const mockUpsert = vi.mocked(upsertChannelKnowledgeGrant);
const mockDelete = vi.mocked(deleteChannelKnowledgeGrant);
const mockFence = vi.mocked(assertChannelScopeAllowedInContainer);
const mockGrantsForBase = vi.mocked(listChannelGrantsForBase);
const mockWorkspace = vi.mocked(findWorkspaceById);

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

// ── Fixtures for fence 2, the 2026-09-18 revoke twin ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asWorkspace = (kind: string) => ({ id: "ws-1", kind }) as any;

/** A base as the create-and-share branch leaves it: the row is `private` and
 *  the GRANT carries the audience (INVARIANTS §4A destination 2). */
const SHARED_BASE = {
  ...BASE,
  workspaceId: "ws-1",
  visibility: "private",
} as KnowledgeBase;

/** One `resource_grants` row for `SHARED_BASE`, on whichever channel. */
function grantOn(channelId: string) {
  return { ...STORED, channel_id: channelId };
}

function revoke(base: KnowledgeBase) {
  return setChannelKnowledgeGrant(OWNER, base, {
    channelId: "chan-1",
    level: "none",
    guestWrite: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Admits by default — a home container. Each refusal case says so itself.
  mockFence.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(STORED);
  // A STANDARD container and no other grant: the two defaults the 2026-09-18
  // revoke fence leaves alone, so every case above stays about fence 1.
  mockWorkspace.mockResolvedValue(asWorkspace("standard"));
  mockGrantsForBase.mockResolvedValue([]);
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

describe("🔒 the REVOKE twin of the home-channel destination fence (2026-09-18)", () => {
  it("🚫 REFUSES the LAST grant's removal on a private base in a `kind='link'` container", async () => {
    // The orphan this refuses is the exact row
    // `service-base-gates.ts › assertCreateBaseAllowed` refuses to CREATE: a
    // `private`, ungranted base inside a home channel, listed by nothing.
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    await expect(revoke(SHARED_BASE)).rejects.toMatchObject({
      status: 400,
      code: "HOME_CHANNEL_ROW_NOT_SHARED",
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("the refusal names BOTH remedies, and says the grant is still there", async () => {
    // ⚠ A refusal an agent reads as a partial write is a refusal it retries
    // against a state that never changed — the same rule
    // `home-channel-destination.test.ts` pins for the CREATE's "was not
    // created". The remedy is the pair Samuel named: move it, or delete it.
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    const err = await revoke(SHARED_BASE).catch((e) => e);
    expect(err.message).toContain("was not removed");
    expect(err.message).toContain("move it to your home space, or delete it");
  });

  it("✅ ALLOWS the revoke while ANOTHER channel grant survives it", async () => {
    // The base is still shared after the delete, so no orphan forms and the
    // three-state control the caller was given keeps working.
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([
      grantOn("chan-1"),
      grantOn("chan-2"),
    ]);
    await expect(revoke(SHARED_BASE)).resolves.toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("✅ ALLOWS it for a base that is NOT `private`, and asks nothing to find out", async () => {
    // 🔒 THE CREATE'S OWN `shared` EXPRESSION, READ BACKWARDS —
    // `visibility !== "private"` is shared there, so a revoke that refused here
    // would refuse its way out of a state the create hands out. And the early
    // return is the cost story: no workspace read, no grant read.
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    await expect(
      revoke({ ...SHARED_BASE, visibility: "public" } as KnowledgeBase)
    ).resolves.toBeNull();
    expect(mockWorkspace).not.toHaveBeenCalled();
    expect(mockGrantsForBase).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("✅ ALLOWS it in the caller's PERSONAL container — that IS destination 1", async () => {
    // 🔒 The case a negative predicate (`!isStandardWorkspace`) would have
    // broken; the kind axis itself is `home-channel-destination.test.ts`'s.
    mockWorkspace.mockResolvedValue(asWorkspace("personal"));
    await expect(revoke(SHARED_BASE)).resolves.toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    // ⚠ And it stops at the kind: a container the rule does not cover never
    // pays the grant read.
    expect(mockGrantsForBase).not.toHaveBeenCalled();
  });

  it("✅ WORKSPACES ARE OUT OF SCOPE — a `kind='standard'` revoke is untouched", async () => {
    await expect(revoke(SHARED_BASE)).resolves.toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("asks about the container the ROW lives in, not the room the call stands in", async () => {
    // ⚠ The correction both create gates carry. `getBaseById`'s
    // `assertSameWorkspace` makes the two equal on today's only door; naming the
    // row's own container is what stops them drifting if a second one opens.
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    // ⚠ A SECOND GRANT so this case is about WHICH container was asked about and
    // not about the refusal — that is the neighbouring test's subject.
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1"), grantOn("chan-2")]);
    await revoke({ ...SHARED_BASE, workspaceId: "ws-elsewhere" } as KnowledgeBase);
    expect(mockWorkspace).toHaveBeenCalledWith("ws-elsewhere");
  });

  it("🔒 does NOT run on the upsert lane — a GRANT can never orphan a row", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    await setChannelKnowledgeGrant(OWNER, SHARED_BASE, {
      channelId: "chan-1",
      level: "visible",
      guestWrite: false,
    });
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  /**
   * 🔒 **ORDER IS THE WHOLE SUBJECT.** A caller who may not administer this base
   * must not learn which container it lives in, and a STANDARD container is
   * refused by fence 1 before fence 2 has an opinion. Both are asserted by what
   * the revoke fence NEVER ASKED — `findWorkspaceById` is its first act, so an
   * unasked probe is proof it was never reached.
   */
  it("🔒 runs BELOW the manage gate — a stranger never learns the container kind", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    await expect(
      setChannelKnowledgeGrant({ ...OWNER, userId: "someone-else" }, SHARED_BASE, {
        channelId: "chan-1",
        level: "none",
        guestWrite: false,
      })
    ).rejects.toBeInstanceOf(ScopeChangeForbiddenError);
    expect(mockWorkspace).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("🔒 runs BELOW the channel-scope fence — a workspace is refused first", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockFence.mockRejectedValue(REFUSAL);
    await expect(revoke(SHARED_BASE)).rejects.toMatchObject({
      code: "SCOPE_NOT_ALLOWED_IN_WORKSPACE",
    });
    expect(mockWorkspace).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  /**
   * 🔒 **THE BUG ITSELF** — the create fence refuses a `private`, ungranted base
   * landing in a `kind='link'` container, and until 2026-09-18 dropping that
   * base's LAST channel grant re-minted exactly that row in place, with no
   * refusal anywhere.
   */
  it("🔒 REFUSES the last grant's revoke, and removes nothing", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    await expect(revoke(SHARED_BASE)).rejects.toBeInstanceOf(
      HomeChannelRowNotSharedError
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("the refusal carries the wire code the MCP layer already maps", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    // ⚠ ONE SPELLING, shared with the create: `container-destination.ts ›
    // HOME_CHANNEL_ROW_NOT_SHARED_CODE` is what `homeChannelRowNotShared()`
    // matches on, so a second code would be a second mapper that stops agreeing
    // about the remedy.
    await expect(revoke(SHARED_BASE)).rejects.toMatchObject({
      status: 400,
      code: "HOME_CHANNEL_ROW_NOT_SHARED",
    });
  });

  it("names the remedy, and it is NOT the create's", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    // A revoke and a create share a RULE and not a REMEDY: "share it into the
    // channel" is the act this caller is trying to undo.
    await expect(revoke(SHARED_BASE)).rejects.toThrow(/move it to your home space/);
  });

  /**
   * ⚠ **A SECOND ROOM MEANS NO ORPHAN FORMS.** A base lent into two channels is
   * still shared after this delete, so the caller keeps the three-state control
   * they were given. A revoke stricter than the create would refuse its way out
   * of a state the create hands out.
   */
  it("✅ ALLOWS the revoke when another channel still holds a grant", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1"), grantOn("chan-2")]);
    await expect(revoke(SHARED_BASE)).resolves.toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("✅ ALLOWS a revoke of a grant that was not there — nothing is orphaned", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-2")]);
    await expect(revoke(SHARED_BASE)).resolves.toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠ **THE THREE EARLY RETURNS ARE THE CREATE'S OWN `shared` EXPRESSION READ
   * BACKWARDS**, and each one is a read this lane does not pay for.
   */
  it("✅ a PUBLIC base is shared by its visibility — no workspace read at all", async () => {
    mockWorkspace.mockResolvedValue(asWorkspace("link"));
    mockGrantsForBase.mockResolvedValue([grantOn("chan-1")]);
    await expect(
      revoke({ ...SHARED_BASE, visibility: "public" } as KnowledgeBase)
    ).resolves.toBeNull();
    expect(mockWorkspace).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
