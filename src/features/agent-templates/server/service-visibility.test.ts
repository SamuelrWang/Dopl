/**
 * THE VISIBILITY MATRIX, as a property over the whole grid rather than a
 * handful of examples: 3 visibilities × 7 caller kinds, every cell asserted.
 *
 * ⚠ WHY A GRID AND NOT CASES. `canSeeTemplate` is six ordered arms, and the
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
import type { AgentTemplate, AgentTemplateContext } from "../types";

vi.mock("./repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
}));

import * as repo from "./repository";
import { getTemplateById, listTemplates } from "./service";
import { AgentTemplateNotFoundError } from "./errors";

const mockRepo = vi.mocked(repo);

const CREATOR = "user-creator";
const TEAMMATE = "user-teammate";
const OUTSIDER = "user-outsider";
const ADMIN = "user-admin";
const SHARED_TEAM = "team-shared";

function ctx(overrides: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
  return {
    workspaceId: "ws-1",
    userId: CREATOR,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: CREATOR,
    ...overrides,
  };
}

function template(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: CREATOR,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
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
   * rather than a credential shared between humans. Everything
   * `containerCopyDraft` makes is `private`, so without this row every "Use in
   * this channel" copy is invisible to the agent it was made for.
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
   * user id — and the operator's private template stays hidden from it.
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
    // template — including every "Use in this channel" copy.
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

describe("canSeeTemplate — 3 visibilities × 7 callers, every cell", () => {
  for (const visibility of ["private", "team", "workspace"] as const) {
    for (const callerName of Object.keys(CALLERS) as CallerName[]) {
      const expected = EXPECTED[visibility][callerName];
      it(`${visibility} template is ${expected ? "VISIBLE" : "hidden"} to ${callerName}`, async () => {
        const row = template({ visibility });
        const caller = CALLERS[callerName];
        mockRepo.listTemplatesForWorkspace.mockResolvedValue([row]);
        mockRepo.listTeamLinksForTemplates.mockResolvedValue(
          visibility === "team"
            ? [{ templateId: row.id, teamId: SHARED_TEAM }]
            : []
        );
        mockRepo.listTeamIdsForUser.mockResolvedValue([...caller.teamsOf]);

        const listed = await listTemplates(caller.c);
        expect(listed.map((t) => t.id)).toEqual(expected ? [row.id] : []);

        // ⚠ THE LIST FILTER AND THE SINGLE-ROW GATE MUST AGREE. They are
        // separate code paths (`listTemplates` filters, `getTemplateById`
        // throws) and a divergence between them is a row that is invisible in
        // the UI and readable by id.
        mockRepo.findTemplateById.mockResolvedValue(row);
        const single = getTemplateById(caller.c, row.id);
        if (expected) {
          await expect(single).resolves.toMatchObject({ id: row.id });
        } else {
          await expect(single).rejects.toBeInstanceOf(AgentTemplateNotFoundError);
        }
      });
    }
  }
});

/**
 * 🔒 F-333 CLAIMS THERE IS NO GUEST EXPOSURE TO WEIGH, AND THAT CLAIM IS A
 * COMPOSITION OF TWO FACTS THAT LIVE IN DIFFERENT FILES — so it is asserted
 * here rather than trusted. (1) `withWorkspaceAuth`'s floor is `viewer` and no
 * agent-templates route lowers it (`app/api/agent-templates/route.test.ts ›
 * "reads at VIEWER — the default, so no options are passed"` asserts the
 * options object is undefined, i.e. the default; `POST`/`PATCH`/`DELETE` raise it to `member`), and
 * `POST /api/channels/launch-directives` — the agent-token lane that resolves a
 * template BY NAME — keeps the same default. (2) `guest` ranks BELOW `viewer`.
 * Together: a guest never reaches a template surface at all, so widening
 * `canSeeTemplate` for a container session cannot expose one to a guest.
 */
describe("the guest floor — why F-333 has no guest arm", () => {
  it("guest does not clear the viewer floor every template route sits at", () => {
    expect(meetsMinRole("guest", "viewer")).toBe(false);
    expect(meetsMinRole("viewer", "viewer")).toBe(true);
  });
});

describe("cross-workspace isolation", () => {
  it("every read is workspace-filtered AT THE REPOSITORY, not by the caller", async () => {
    mockRepo.listTemplatesForWorkspace.mockResolvedValue([]);
    await listTemplates(ctx({ workspaceId: "ws-other" }));
    // The service passes its own context's workspace and the repository takes
    // it as a required argument — there is no code path that reads a workspace
    // id off a request body.
    // ⚠ The second argument is the SHELF (2026-08-27), and `undefined` here is
    // the assertion that an unasked-for shelf means NO filter — the workspace
    // fence and the shelf filter are different axes and neither substitutes for
    // the other.
    expect(mockRepo.listTemplatesForWorkspace).toHaveBeenCalledWith(
      "ws-other",
      undefined
    );
  });

  it("a missing row 404s exactly like an invisible one", async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    await expect(getTemplateById(ctx(), "tpl-gone")).rejects.toBeInstanceOf(
      AgentTemplateNotFoundError
    );
  });
});

// ── Team-composition leakage ─────────────────────────────────────────

describe("the sharing set is owner/admin-only", () => {
  const row = template({ visibility: "team" });

  beforeEach(() => {
    mockRepo.listTemplatesForWorkspace.mockResolvedValue([row]);
    mockRepo.listTeamLinksForTemplates.mockResolvedValue([
      { templateId: row.id, teamId: SHARED_TEAM },
      { templateId: row.id, teamId: "team-second" },
    ]);
  });

  it("the creator sees which teams it is shared with", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listTemplates(ctx({ userId: CREATOR }));
    expect(t.teamIds.sort()).toEqual(["team-second", SHARED_TEAM].sort());
  });

  it("a workspace admin sees it (they administer sharing)", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listTemplates(ctx({ userId: ADMIN, role: "admin" }));
    expect(t.teamIds).toHaveLength(2);
  });

  it("a granted TEAMMATE sees the template and NOT the team list", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([SHARED_TEAM]);
    const [t] = await listTemplates(ctx({ userId: TEAMMATE }));
    // They can use it; they may not learn that "team-second" also has it —
    // that is org-chart information leaking through a shared template.
    expect(t.id).toBe(row.id);
    expect(t.teamIds).toEqual([]);
  });

  it("a workspace-visible template reports no teams even to its creator", async () => {
    const open = template({ visibility: "workspace" });
    mockRepo.listTemplatesForWorkspace.mockResolvedValue([open]);
    mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
    const [t] = await listTemplates(ctx({ userId: CREATOR }));
    // Stale links from a previous `team` scope must not read as live sharing.
    expect(t.teamIds).toEqual([]);
  });
});

// ── Query-count discipline ───────────────────────────────────────────

describe("fixed query count", () => {
  it("no team lookup at all when nothing is team-scoped", async () => {
    mockRepo.listTemplatesForWorkspace.mockResolvedValue([
      template({ id: "a", visibility: "private" }),
      template({ id: "b", visibility: "workspace" }),
    ]);
    await listTemplates(ctx({ userId: OUTSIDER }));
    expect(mockRepo.listTeamLinksForTemplates).not.toHaveBeenCalled();
    expect(mockRepo.listTeamIdsForUser).not.toHaveBeenCalled();
  });

  it("ONE team-link query for many team-scoped rows, not one per row", async () => {
    mockRepo.listTemplatesForWorkspace.mockResolvedValue([
      template({ id: "a", visibility: "team", createdBy: OUTSIDER }),
      template({ id: "b", visibility: "team", createdBy: OUTSIDER }),
      template({ id: "c", visibility: "team", createdBy: OUTSIDER }),
    ]);
    await listTemplates(ctx({ userId: TEAMMATE }));
    expect(mockRepo.listTeamLinksForTemplates).toHaveBeenCalledTimes(1);
    expect(mockRepo.listTeamLinksForTemplates).toHaveBeenCalledWith("ws-1", [
      "a",
      "b",
      "c",
    ]);
    expect(mockRepo.listTeamIdsForUser).toHaveBeenCalledTimes(1);
  });
});
