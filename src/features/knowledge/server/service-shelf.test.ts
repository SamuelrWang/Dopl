/**
 * The two shelves — Samuel's ruling, 2026-08-26 ("home-only shelf"). The shelf
 * is a TENANCY since 2026-09-02 (slice B15, ruling B10): `home_scoped` is dropped
 * by `20260923120000_drop_home_scoped.sql` and the personal shelf is the caller's
 * own `kind='personal'` container.
 *
 * THE READ HALF
 *   1. a shelf reaches the QUERY, not a post-filter — the rows must not arrive
 *      (INVARIANTS §11: viewer filtering is server-side by principle);
 *   2. absent shelf means BOTH, because MCP `kb_list_bases` and workspace
 *      search ride the unfiltered path and must keep seeing the workspace;
 *   3. a narrowed read never SEEDS — "no bases on this shelf" is the normal
 *      state of a young workspace whose content is all on the other one.
 *
 * THE WRITE HALF — `resolveHomeScope`'s three conditions left this file on
 * 2026-09-02 with the fence and the column; the survivor is pinned against both
 * tables in `shared/tenancy/personal-shelf-repositories.test.ts`. What is left
 * here is that the SERVICE does not re-decide the flag on its way down.
 *
 * NOT a cross-workspace leak suite — nothing leaked, the RANGE was wrong, so
 * the fix was a noun, not a gate. `service-audience.test.ts` owns that axis.
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

// ⚠ **`findWorkspaceById` MOCKED SINCE 2026-09-18**: a private create now asks
// `workspaces/server/home-channel-destination.ts › assertHomeChannelRowIsShared`
// where the row is LANDING, and that reads the workspace row. Answered as a
// STANDARD workspace, the kind the rule leaves alone, so this file keeps
// measuring its own subject — every direction of the rule itself is
// `workspaces/server/home-channel-destination.test.ts`.
vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(async () => ({ id: "ws-1", kind: "standard" })),
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

// A2: `createBase` now resolves WHERE the row lands before inserting it
// (`service-base-gates.ts › resolveCreateDestination`), and that decision asks
// the personal fence. Mocked OPEN so this file measures the SERVICE, not the
// fence.
vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(async () => ({
    kind: "open",
    containerId: "ws-personal",
  })),
  personalShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("@/features/teams/server/repository", () => ({
  deleteGrantRow: vi.fn(),
  deleteGrantsForResource: vi.fn(),
  listGrantsForResource: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  upsertGrant: vi.fn(),
}));

import { findWorkspaceKind } from "./repository-audience";
import * as repo from "./repository";
import { listBases } from "./service-bases";
import { createBase } from "./service-base-writes";
import { seedWorkspace } from "./service-seed";

const mockRepo = vi.mocked(repo);
const mockSeed = vi.mocked(seedWorkspace);

const HOME_WS = "ws-home";
const USER = "u-operator";

/** A signed-in person in their own default standard workspace. */
function personCtx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: HOME_WS,
    userId: USER,
    role: "owner",
    source: "user",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: USER,
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
  mockRepo.insertBase.mockImplementation(
    (args) => Promise.resolve(baseRow({ name: args.name, slug: args.slug })) as never
  );
});

describe("listing one shelf", () => {
  it("pushes the shelf DOWN to the query instead of filtering the answer", async () => {
    // the point is the third argument, not the returned array: a service that
    // fetched everything and filtered in JS would put the other shelf on the
    // wire and still satisfy an output assertion.
    mockRepo.listBasesForWorkspace.mockResolvedValue([baseRow()]);

    await listBases(personCtx(), { shelf: "home" });

    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      false,
      "home"
    );
  });

  it("asks for BOTH shelves when no shelf is named", async () => {
    // MCP `kb_list_bases` and workspace SEARCH ride this path. "Absent" is not a
    // defaulted shelf; defaulting to `workspace` would hide the operator's own
    // home shelf from their own agent.
    await listBases(personCtx());

    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      false,
      undefined
    );
  });

  it("never SEEDS off an empty shelf", async () => {
    // the seed gate below `listBases` reads "this workspace has no bases at all";
    // asked of ONE shelf that becomes "none on this shelf", and a <24h-old
    // workspace would be re-seeded by every visit to the /home pane.
    //
    // VACUOUS TODAY, KEPT ANYWAY: `service-bases.ts › listBases` carries
    // `DEMO_DISABLE_AUTO_SEED = true`, so nothing seeds and this passes with the
    // shelf guard deleted (mutation-confirmed 2026-08-26). A tripwire for the day
    // that flag flips — do not read it as coverage of the guard.
    mockRepo.listBasesForWorkspace.mockResolvedValue([]);

    const out = await listBases(personCtx(), { shelf: "home" });

    expect(out).toEqual([]);
    expect(mockSeed).not.toHaveBeenCalled();
    // One read, not two: the narrowed path returns before the seed branch's
    // second `listBasesForWorkspace`.
    expect(mockRepo.listBasesForWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("creating onto the personal shelf", () => {
  // Six cases became two on 2026-09-02 (slice B15): four pinned
  // `resolveHomeScope`'s three conditions, deleted with the `home_scoped` column.
  // The survivor is `shared/tenancy/personal-container.ts ›
  // personalWriteWorkspaceId`, pinned in `personal-shelf-repositories.test.ts`.
  //
  // The "does not re-decide" pin is retired on the A2 slice (gap 2 of #1077) and
  // its reversal is the feature: the service DOES resolve the flag now, via
  // `service-base-gates.ts › resolveCreateDestination`, which has its own test.
  // What survives is the half really at risk — the service must not invent a
  // shelf nobody asked for, and the flag it hands the repository must agree with
  // the CONTAINER it hands it beside.

  it("resolves the asked-for shelf to a container, and the two AGREE", async () => {
    // the flag and the id together, or the slug read, the insert and the rollback
    // disagree about where the row went. Both resolve the personal container by
    // OWNER, so they cannot answer differently.
    await createBase(personCtx(), { name: "Shelf note", homeScoped: true });
    expect(mockRepo.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScoped: true,
        workspaceId: "ws-personal",
        visibility: "private",
      })
    );
  });

  it("🔒 invents NO shelf when nobody asked — the calling container, still", async () => {
    // `undefined` → `false` is an assertion change, not a behaviour one: the
    // router tests `homeScoped !== true`. The load-bearing half is the container:
    // a person creating in their own workspace must still land THERE.
    await createBase(personCtx(), { name: "Ordinary" });
    const args = mockRepo.insertBase.mock.calls[0][0];
    expect(args.homeScoped).toBe(false);
    expect(args.workspaceId).toBe(HOME_WS);
  });
});
