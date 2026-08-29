/**
 * 🔒 THE TWO SHELVES — Samuel's ruling, 2026-08-26 ("home-only shelf"), schema
 * in `20260831120000_knowledge_base_home_scoped.sql`.
 *
 * WHAT THIS SUITE IS FOR, in one sentence: the /home Knowledge pane's "across
 * all channels" and the workspace Knowledge page are two PLACES over one table,
 * and each of the four properties that makes that true has a fence somebody
 * could delete without any other test noticing.
 *
 * ⚠ IT IS NOT A CROSS-WORKSPACE LEAK SUITE, and the distinction is the whole
 * history of this wave. Measured against production on 2026-08-26: the bases
 * Samuel saw under "across all channels" really did live in his own default
 * standard workspace, the request really did carry `x-workspace-id`, and
 * `listBasesForWorkspace` really did `.eq("workspace_id", …)`. Nothing leaked.
 * The RANGE was wrong — a whole workspace shelf behind a pill labelled "across
 * all channels" — so the fix was a noun, not a gate. Do not "restore" a
 * workspace-scoping assertion here; `service-audience.test.ts` owns that axis.
 *
 * THE READ HALF
 *   1. a shelf reaches the QUERY, not a post-filter — the rows must not arrive
 *      (INVARIANTS §11: viewer filtering is server-side by principle);
 *   2. absent shelf means BOTH, because MCP `kb_list_bases` and workspace
 *      search ride the unfiltered path and must keep seeing the workspace;
 *   3. a narrowed read never SEEDS — "no bases on this shelf" is the normal
 *      state of a young workspace whose content is all on the other one, and
 *      the seed gate reads it as "no bases at all".
 *
 * THE WRITE HALF — `resolveHomeScope`'s three conditions, each refused
 * separately, plus the default that keeps every existing caller unmarked.
 *
 * ⚠ MUTATION-VERIFIED, WITH ONE STATED EXCEPTION. Each fence was confirmed red
 * with that fence removed — except "never SEEDS off an empty shelf", which is a
 * tripwire for a branch a demo flag currently short-circuits and says so at its
 * own site. Counts in this change's report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository-audience", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listGrantedBaseIdsForChannels: vi.fn(),
}));

vi.mock("./repository", () => ({
  listBasesForWorkspace: vi.fn(),
  listBaseSlugsForWorkspace: vi.fn(),
  insertBase: vi.fn(),
  findBaseById: vi.fn(),
  findBaseBySlug: vi.fn(),
}));

vi.mock("./service-seed", () => ({ seedWorkspace: vi.fn() }));

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

import { findWorkspaceKind } from "./repository-audience";
import { findDefaultWorkspaceForUser } from "@/features/workspaces/server/repository";
import * as repo from "./repository";
import { listBases } from "./service-bases";
import { createBase } from "./service-base-writes";
import { seedWorkspace } from "./service-seed";
import { HomeScopeForbiddenError } from "./errors";

const mockRepo = vi.mocked(repo);
const mockDefaultWorkspace = vi.mocked(findDefaultWorkspaceForUser);
const mockSeed = vi.mocked(seedWorkspace);

const HOME_WS = "ws-home";
const OTHER_WS = "ws-other";
const USER = "u-operator";

/** A signed-in person in their own default standard workspace. */
function personCtx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: HOME_WS,
    userId: USER,
    role: "owner",
    source: "user",
    apiKeyWorkspaceId: null,
    apiKeyWorkspaceLockKind: null,
    sessionId: null,
    ...over,
  };
}

function baseRow(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    workspaceId: HOME_WS,
    name: "Notes",
    slug: "notes",
    publicId: "aaaaaaaaaaaa",
    description: null,
    agentWriteEnabled: true,
    visibility: "private",
    accessMode: "workspace",
    createdBy: USER,
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Not a container: the audience ceiling admits everything, so nothing below
  // is measuring `resolveAgentAudience` by accident.
  vi.mocked(findWorkspaceKind).mockResolvedValue("standard");
  mockRepo.listBasesForWorkspace.mockResolvedValue([]);
  mockRepo.listBaseSlugsForWorkspace.mockResolvedValue([]);
  mockDefaultWorkspace.mockResolvedValue({ id: HOME_WS } as never);
  mockRepo.insertBase.mockImplementation(
    (args) => Promise.resolve(baseRow({ name: args.name, slug: args.slug })) as never
  );
});

describe("listing one shelf", () => {
  it("pushes the shelf DOWN to the query instead of filtering the answer", async () => {
    // 🔒 The point is the third argument, not the returned array. A service
    // that fetched everything and filtered in JS would satisfy any
    // rendered-output assertion while putting the other shelf on the wire.
    mockRepo.listBasesForWorkspace.mockResolvedValue([baseRow()]);

    await listBases(personCtx(), { shelf: "home" });

    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      false,
      "home"
    );
  });

  it("asks for BOTH shelves when no shelf is named", async () => {
    // ⚠ MCP `kb_list_bases` and workspace SEARCH ride this path. "Absent" is
    // not a defaulted shelf; making it default to `workspace` would hide the
    // operator's own home shelf from their own agent.
    await listBases(personCtx());

    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      false,
      undefined
    );
  });

  it("never SEEDS off an empty shelf", async () => {
    // 🔒 The seed gate below `listBases` reads "this workspace has no bases at
    // all". Asked of ONE shelf that becomes "none on this shelf" — the normal
    // state of a workspace whose content is on the other one — and a <24h-old
    // workspace would be re-seeded by every visit to the /home pane.
    //
    // 🔴 ⚠ THIS ONE IS VACUOUS TODAY AND IS KEPT ANYWAY — SAYING SO IS THE
    // POINT. `service-bases.ts › listBases` carries `DEMO_DISABLE_AUTO_SEED =
    // true`, so NOTHING seeds right now and this passes with the shelf guard
    // deleted (confirmed by mutation, 2026-08-26 — it was the one assertion
    // that stayed green). It is a tripwire armed for the day that flag flips,
    // which is exactly when the hazard becomes live and nobody will be thinking
    // about shelves. **Do not read it as coverage of the guard.**
    mockRepo.listBasesForWorkspace.mockResolvedValue([]);

    const out = await listBases(personCtx(), { shelf: "home" });

    expect(out).toEqual([]);
    expect(mockSeed).not.toHaveBeenCalled();
    // One read, not two: the narrowed path returns before the seed branch's
    // second `listBasesForWorkspace`.
    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("creating onto the home shelf", () => {
  it("marks the row when a person creates a PRIVATE base in their own home workspace", async () => {
    await createBase(personCtx(), { name: "Shelf note", homeScoped: true });

    expect(mockRepo.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({ homeScoped: true, visibility: "private" })
    );
  });

  it("leaves the row UNMARKED when nobody asked — every pre-existing caller", async () => {
    // ⚠ MCP `kb_create_base` is this case. The flag is opt-in and silent;
    // widening the default would move every agent-created base onto a shelf
    // no agent surface reads.
    await createBase(personCtx(), { name: "Ordinary" });

    expect(mockRepo.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({ homeScoped: false })
    );
  });

  it("REFUSES when the target is not the caller's own default standard workspace", async () => {
    // A link container fails this, and so does a second workspace the caller
    // owns. `findDefaultWorkspaceForUser` is the same lookup `POST /api/boot`
    // runs, so the fence and the /home surface cannot disagree about "home".
    mockDefaultWorkspace.mockResolvedValue({ id: OTHER_WS } as never);

    await expect(
      createBase(personCtx(), { name: "Elsewhere", homeScoped: true })
    ).rejects.toBeInstanceOf(HomeScopeForbiddenError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });

  it("REFUSES a PUBLIC base on the shelf", async () => {
    await expect(
      createBase(personCtx(), {
        name: "Announcement",
        visibility: "public",
        homeScoped: true,
      })
    ).rejects.toBeInstanceOf(HomeScopeForbiddenError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });

  it("REFUSES the teams path, whose visibility is rewritten to public UNDER the fence", async () => {
    // 🔒 THE ORDER IS THE ASSERTION. The teams branch rewrites `visibility` to
    // `public` after the input is read, so a fence that consulted
    // `input.visibility` would wave this through and put a team-shared base on
    // a shelf described as "yours alone".
    await expect(
      createBase(personCtx(), {
        name: "Team shelf",
        accessMode: "teams",
        teamGrants: [{ teamId: "11111111-2222-4333-8444-555555555555", level: "edit" }],
        homeScoped: true,
      })
    ).rejects.toBeInstanceOf(HomeScopeForbiddenError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });

  it("REFUSES a SHARED credential — a workspace key has no personal shelf", async () => {
    await expect(
      createBase(
        personCtx({ apiKeyWorkspaceId: HOME_WS, source: "agent" }),
        { name: "From a key", homeScoped: true }
      )
    ).rejects.toBeInstanceOf(HomeScopeForbiddenError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });
});
