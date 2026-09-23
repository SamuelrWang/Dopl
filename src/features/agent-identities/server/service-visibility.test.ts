/**
 * THE VISIBILITY MATRIX, as a property over the whole grid rather than a
 * handful of examples: 3 visibilities × 7 caller kinds, every cell asserted.
 *
 * ⚠ WHY A GRID AND NOT CASES. `canSeeIdentity` is six ordered arms, and the
 * bugs this class of function actually ships are ORDER bugs — an admin arm
 * placed above the `private` arm, an API-key arm placed below the creator arm.
 * Neither shows up in the cases anyone writes by hand, because each looks right
 * on its own row. Enumerating the product means a reordering cannot be green.
 *
 * Through the public service with the repository mocked: no Supabase, no
 * network. Same idiom as `skills/server/service.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { meetsMinRole } from "@/features/workspaces/types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { getIdentityById, listIdentities } from "./service";
import { AgentIdentityNotFoundError } from "./errors";
import { OWNER as CREATOR, ctx, identity, resetReadMocks } from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

const TEAMMATE = "user-teammate";
const OUTSIDER = "user-outsider";
const ADMIN = "user-admin";
const SHARED_TEAM = "team-shared";

beforeEach(() => {
  vi.clearAllMocks();
  resetReadMocks(mockRepo);
});

// ── The grid ─────────────────────────────────────────────────────────

/** The five callers the matrix distinguishes. `teamsOf` is what
 *  `listTeamIdsForUser` answers for them. */
const CALLERS = {
  creator: { c: ctx({ userId: CREATOR }), teamsOf: [] as string[] },
  teammate: { c: ctx({ userId: TEAMMATE }), teamsOf: [SHARED_TEAM] },
  nonTeamMember: { c: ctx({ userId: OUTSIDER }), teamsOf: ["team-other"] },
  admin: { c: ctx({ userId: ADMIN, role: "admin" }), teamsOf: [] as string[] },
  /**
   * ⚠ NOT "a caller in another workspace" — there is no such caller at this
   * layer, and pretending there is would test nothing. Cross-workspace
   * isolation is enforced one layer down, by the `workspace_id` filter every
   * repository query carries, and it is asserted separately below.
   * This row is the WORKSPACE-SCOPED API KEY (M-10): a credential that may be
   * shared between humans and therefore inherits no individual's reach.
   */
  workspaceKey: {
    c: ctx({ userId: CREATOR, apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null }),
    teamsOf: [] as string[],
  },
  /**
   * 🔒 THE CONTAINER-SESSION CHILD CREDENTIAL (F-333, ruled 2026-08-27) — the
   * row this grid was missing, and the reason arm 2 could not stay keyed on the
   * lock. It carries the SAME `apiKeyWorkspaceId` as `workspaceKey` above and
   * the OPPOSITE answer on every private row, because it is one human's session
   * rather than a credential shared between humans. Every PERSONAL identity is
   * `private`, so without this row the operator's own agents cannot see the
   * identities the operator authored for them. ⚠ **THE ORIGINAL CASE WAS THE
   * "Use in this channel" COPY, WHICH IS DELETED (2026-09-02, B15)** — the arm
   * it forced is unchanged and now covers every personal row instead of one
   * gesture's output.
   */
  containerSession: {
    c: ctx({
      userId: CREATOR,
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: CREATOR,
    }),
    teamsOf: [] as string[],
  },
  /**
   * ⚠ AND THE PEER'S container session, which is what proves the widening is
   * per-PERSON and not per-credential-kind: same lock, same kind, different
   * user id — and the operator's private identity stays hidden from it.
   */
  containerSessionPeer: {
    c: ctx({
      userId: OUTSIDER,
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: OUTSIDER,
    }),
    teamsOf: [] as string[],
  },
} as const;

type CallerName = keyof typeof CALLERS;

/**
 * ⚠ THE EXPECTED GRID IS WRITTEN OUT, NOT COMPUTED. A table derived from the
 * same rules the implementation uses would pass for a wrong implementation;
 * this one is a statement of the product decision and has to be edited by hand
 * when the decision changes.
 */
const EXPECTED: Record<
  "private" | "team" | "workspace",
  Record<CallerName, boolean>
> = {
  private: {
    creator: true,
    teammate: false,
    nonTeamMember: false,
    // ⚠ FALSE, and it is the arm ordering that makes it so: an admin
    // administers SHARING, which is not a read of a teammate's private row.
    admin: false,
    // The key IS the creator by user id, and still gets nothing — that is the
    // whole of M-10, and it survives F-333 unchanged: what distinguishes this
    // row from `containerSession` below is the lock's KIND, never the lock.
    workspaceKey: false,
    // 🔒 F-333: the operator's own session reads the operator's own private
    // identity — including every "Use in this channel" copy.
    containerSession: true,
    // 🔒 …and the PEER's session does not.
    containerSessionPeer: false,
  },
  team: {
    creator: true,
    teammate: true,
    nonTeamMember: false,
    admin: true,
    workspaceKey: false,
    // Creator arm, same as `creator`.
    containerSession: true,
    // No shared team, not the creator, not an admin.
    containerSessionPeer: false,
  },
  workspace: {
    creator: true,
    teammate: true,
    nonTeamMember: true,
    admin: true,
    // The only cell where a workspace-scoped key sees anything: a row every
    // member can see is not one person's content.
    workspaceKey: true,
    containerSession: true,
    containerSessionPeer: true,
  },
};

describe("canSeeIdentity — 3 visibilities × 7 callers, every cell", () => {
  for (const visibility of ["private", "team", "workspace"] as const) {
    for (const callerName of Object.keys(CALLERS) as CallerName[]) {
      const expected = EXPECTED[visibility][callerName];
      it(`${visibility} identity is ${expected ? "VISIBLE" : "hidden"} to ${callerName}`, async () => {
        const row = identity({ visibility });
        const caller = CALLERS[callerName];
        mockRepo.listIdentitiesForWorkspace.mockResolvedValue([row]);
        mockRepo.listTeamLinksForIdentities.mockResolvedValue(
          visibility === "team"
            ? [{ identityId: row.id, teamId: SHARED_TEAM }]
            : []
        );
        mockRepo.listTeamIdsForUser.mockResolvedValue([...caller.teamsOf]);

        const listed = await listIdentities(caller.c);
        expect(listed.map((t) => t.id)).toEqual(expected ? [row.id] : []);

        // ⚠ THE LIST FILTER AND THE SINGLE-ROW GATE MUST AGREE. They are
        // separate code paths (`listIdentities` filters, `getIdentityById`
        // throws) and a divergence between them is a row that is invisible in
        // the UI and readable by id.
        mockRepo.findIdentityById.mockResolvedValue(row);
        const single = getIdentityById(caller.c, row.id);
        if (expected) {
          await expect(single).resolves.toMatchObject({ id: row.id });
        } else {
          await expect(single).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
        }
      });
    }
  }
});

/**
 * 🔒 F-333 CLAIMS THERE IS NO GUEST EXPOSURE TO WEIGH, AND THAT CLAIM IS A
 * COMPOSITION OF TWO FACTS THAT LIVE IN DIFFERENT FILES — so it is asserted
 * here rather than trusted. (1) `withWorkspaceAuth`'s floor is `viewer` and no
 * agent-identities route lowers it (`app/api/agent-identities/route.test.ts ›
 * "reads at VIEWER — the default, so no options are passed"` asserts the
 * options object is undefined, i.e. the default; `POST`/`PATCH`/`DELETE` raise it to `member`), and
 * `POST /api/channels/launch-directives` — the agent-token lane that resolves a
 * identity BY NAME — keeps the same default. (2) `guest` ranks BELOW `viewer`.
 * Together: a guest never reaches an identity surface at all, so widening
 * `canSeeIdentity` for a container session cannot expose one to a guest.
 */
describe("the guest floor — why the container-session arm has no guest arm", () => {
  it("guest does not clear the viewer floor every identity route sits at", () => {
    expect(meetsMinRole("guest", "viewer")).toBe(false);
    expect(meetsMinRole("viewer", "viewer")).toBe(true);
  });
});

describe("cross-workspace isolation", () => {
  it("every read is workspace-filtered AT THE REPOSITORY, not by the caller", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([]);
    await listIdentities(ctx({ workspaceId: "ws-other" }));
    // The service passes its own context's workspace and the repository takes
    // it as a required argument — there is no code path that reads a workspace
    // id off a request body.
    // ⚠ The second argument is the SHELF (2026-08-27), and `undefined` here is
    // the assertion that an unasked-for shelf means NO filter — the workspace
    // fence and the shelf filter are different axes and neither substitutes for
    // the other.
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(
      "ws-other",
      undefined
    );
  });

  it("a missing row 404s exactly like an invisible one", async () => {
    mockRepo.findIdentityById.mockResolvedValue(null);
    await expect(getIdentityById(ctx(), "id-gone")).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });
});

// ── Team-composition leakage ─────────────────────────────────────────

describe("the sharing set is owner/admin-only", () => {
  const row = identity({ visibility: "team" });

  beforeEach(() => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([row]);
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([
      { identityId: row.id, teamId: SHARED_TEAM },
      { identityId: row.id, teamId: "team-second" },
    ]);
  });

  it("the creator sees which teams it is shared with", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: CREATOR }));
    expect(t.teamIds.sort()).toEqual(["team-second", SHARED_TEAM].sort());
  });

  it("a workspace admin sees it (they administer sharing)", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: ADMIN, role: "admin" }));
    expect(t.teamIds).toHaveLength(2);
  });

  it("a granted TEAMMATE sees the identity and NOT the team list", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([SHARED_TEAM]);
    const [t] = await listIdentities(ctx({ userId: TEAMMATE }));
    // They can use it; they may not learn that "team-second" also has it —
    // that is org-chart information leaking through a shared identity.
    expect(t.id).toBe(row.id);
    expect(t.teamIds).toEqual([]);
  });

  it("a workspace-visible identity reports no teams even to its creator", async () => {
    const open = identity({ visibility: "workspace" });
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([open]);
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: CREATOR }));
    // Stale links from a previous `team` scope must not read as live sharing.
    expect(t.teamIds).toEqual([]);
  });
});

// ── Query-count discipline ───────────────────────────────────────────

describe("fixed query count", () => {
  it("no team lookup at all when nothing is team-scoped", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      identity({ id: "a", visibility: "private" }),
      identity({ id: "b", visibility: "workspace" }),
    ]);
    await listIdentities(ctx({ userId: OUTSIDER }));
    expect(mockRepo.listTeamLinksForIdentities).not.toHaveBeenCalled();
    expect(mockRepo.listTeamIdsForUser).not.toHaveBeenCalled();
  });

  it("ONE team-link query for many team-scoped rows, not one per row", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      identity({ id: "a", visibility: "team", createdBy: OUTSIDER }),
      identity({ id: "b", visibility: "team", createdBy: OUTSIDER }),
      identity({ id: "c", visibility: "team", createdBy: OUTSIDER }),
    ]);
    await listIdentities(ctx({ userId: TEAMMATE }));
    expect(mockRepo.listTeamLinksForIdentities).toHaveBeenCalledTimes(1);
    expect(mockRepo.listTeamLinksForIdentities).toHaveBeenCalledWith("ws-1", [
      "a",
      "b",
      "c",
    ]);
    expect(mockRepo.listTeamIdsForUser).toHaveBeenCalledTimes(1);
  });
});
