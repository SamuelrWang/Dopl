/**
 * ID-OR-NAME TEMPLATE RESOLUTION (`service-resolve-ref.ts`) — the CREATE fence
 * on the launch-directive lane, driven adversarially.
 *
 * ⚠ **THE PROPERTY THIS FILE EXISTS FOR IS THAT A NAME NEVER PICKS.**
 * `agent_templates` has no name uniqueness on purpose — a unique index across a
 * visibility boundary would leak the existence of a private row through a
 * conflict error — so two visible templates may legitimately share a name, and
 * every natural tie-break silently launches an identity the caller did not
 * choose. The refusal is the feature.
 *
 * ⚠ The second property is that the ANSWER FOR "invisible" and the answer for
 * "no such row" are THE SAME OBJECT. This surface is 404-never-403 everywhere
 * else; a resolver that split them would rebuild the existence oracle on a new
 * door.
 *
 * ⚠ The visibility MATRIX itself is not re-tested here — `service-visibility.
 * test.ts` enumerates 3 visibilities × 5 caller kinds over the same
 * `canSeeTemplate`. What is tested here is that this function GOES THROUGH it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  findTemplateById: vi.fn(),
  listTemplatesForWorkspace: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
}));

// ⚠ THE CROSS-TENANCY PAIR (T35) LIVES IN ITS OWN MODULE, and is mocked EMPTY so
// the default is "nothing to say" — every assertion in this file is about the
// answer THIS workspace gives, and a classifier that answered would change the
// error's DETAIL, never its visibility.
vi.mock("./repository-tenancy", () => ({
  listWorkspaceIdsForUser: vi.fn(async () => []),
  findTemplateTenancyRows: vi.fn(async () => []),
}));

import * as repo from "./repository";
import * as tenancyRepo from "./repository-tenancy";
import { resolveTemplateRef } from "./service-resolve-ref";
import type { AgentTemplate, AgentTemplateContext } from "../types";

const WS = "11111111-1111-1111-1111-111111111111";
const ME = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const T1 = "44444444-4444-4444-4444-444444444444";
const T2 = "55555555-5555-5555-5555-555555555555";
const TEAM = "66666666-6666-6666-6666-666666666666";

const ctx: AgentTemplateContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
  apiKeyWorkspaceId: null,
};

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: T1,
    workspaceId: WS,
    name: "Code Auditor",
    description: null,
    instructions: "audit it",
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listTeamIdsForUser).mockResolvedValue([]);
  vi.mocked(repo.listTeamLinksForTemplates).mockResolvedValue([]);
});

describe("the ID path", () => {
  it("resolves a visible template by id, and reads it BY ID rather than scanning", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(template());
    const out = await resolveTemplateRef(ctx, T1);
    expect(out).toEqual({ kind: "found", id: T1, name: "Code Auditor" });
    expect(repo.findTemplateById).toHaveBeenCalledWith(WS, T1);
    expect(repo.listTemplatesForWorkspace).not.toHaveBeenCalled();
  });

  it("answers NOT-FOUND for an invisible template — the same object as a missing one", async () => {
    // ⚠ Somebody else's PRIVATE template. `canSeeTemplate` arm 4 refuses it even
    // to a workspace admin, and this must be indistinguishable from "no row".
    vi.mocked(repo.findTemplateById).mockResolvedValue(
      template({ createdBy: OTHER, visibility: "private" })
    );
    const invisible = await resolveTemplateRef(ctx, T1);
    vi.mocked(repo.findTemplateById).mockResolvedValue(null);
    const missing = await resolveTemplateRef(ctx, T1);
    expect(invisible).toEqual({ kind: "not-found" });
    expect(invisible).toEqual(missing);
  });

  it("an invisible template is not found even for a workspace ADMIN", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(
      template({ createdBy: OTHER, visibility: "private" })
    );
    expect(
      await resolveTemplateRef({ ...ctx, role: "admin" }, T1)
    ).toEqual({ kind: "not-found" });
  });

  it("a UUID that matches nothing does NOT fall back to a name lookup", async () => {
    // ⚠ Two lookups answering through each other is how "no such id" starts
    // reporting as "no such name" and vice versa.
    vi.mocked(repo.findTemplateById).mockResolvedValue(null);
    await resolveTemplateRef(ctx, T1);
    expect(repo.listTemplatesForWorkspace).not.toHaveBeenCalled();
  });
});

describe("the NAME path", () => {
  it("resolves a unique visible name, case-insensitively", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([template()]);
    expect(await resolveTemplateRef(ctx, "code auditor")).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });

  it("is EXACT after casefold — never a prefix and never fuzzy", async () => {
    // ⚠ An orchestrator naming "Auditor" must not silently get "Code Auditor".
    // A substring rule makes every NEW template a chance of re-pointing an
    // existing call at a different identity.
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([template()]);
    for (const near of ["Auditor", "Code", "Code Auditor ", "Code  Auditor"]) {
      const out = await resolveTemplateRef(ctx, near);
      // "Code Auditor " trims to an exact match; the others must miss.
      expect(out.kind).toBe(near.trim() === "Code Auditor" ? "found" : "not-found");
    }
  });

  it("does not match a template the caller cannot see", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([
      template({ createdBy: OTHER, visibility: "private" }),
    ]);
    expect(await resolveTemplateRef(ctx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("an empty workspace, and a blank ref, are both not-found without a throw", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([]);
    expect(await resolveTemplateRef(ctx, "Anything")).toEqual({ kind: "not-found" });
    expect(await resolveTemplateRef(ctx, "   ")).toEqual({ kind: "not-found" });
  });
});

describe("AMBIGUITY — it refuses, and it lists", () => {
  const twoVisible = [
    template({ id: T1, name: "Researcher", visibility: "private", createdBy: ME }),
    template({ id: T2, name: "Researcher", visibility: "workspace", createdBy: OTHER }),
  ];

  it("REFUSES rather than picking, and never picks the caller's own", async () => {
    // ⚠ "Mine wins" is the most tempting rule in the product and it is the one
    // this case exists to forbid: it starts an identity the caller did not
    // choose and reports success.
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue(twoVisible);
    const out = await resolveTemplateRef(ctx, "Researcher");
    expect(out.kind).toBe("ambiguous");
    expect(JSON.stringify(out)).not.toContain('"found"');
  });

  it("lists every match with its id AND its visibility", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue(twoVisible);
    const out = await resolveTemplateRef(ctx, "researcher");
    expect(out).toEqual({
      kind: "ambiguous",
      matches: [
        { id: T1, name: "Researcher", visibility: "private" },
        { id: T2, name: "Researcher", visibility: "workspace" },
      ],
    });
  });

  it("the list is NOT AN ORACLE — an invisible same-name row is absent from it", async () => {
    // ⚠ THE SHARP ONE. Three rows share the name; one is somebody else's private
    // template. If it appeared here the refusal would be a probe: name a word,
    // learn whose private templates carry it.
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([
      ...twoVisible,
      template({
        id: "77777777-7777-7777-7777-777777777777",
        name: "Researcher",
        visibility: "private",
        createdBy: OTHER,
      }),
    ]);
    const out = await resolveTemplateRef(ctx, "Researcher");
    expect(out.kind).toBe("ambiguous");
    expect(JSON.stringify(out)).not.toContain("77777777");
  });

  it("two rows sharing a name where only ONE is visible is a plain FOUND", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([
      template({ id: T1, name: "Researcher", createdBy: ME, visibility: "private" }),
      template({ id: T2, name: "Researcher", createdBy: OTHER, visibility: "private" }),
    ]);
    expect(await resolveTemplateRef(ctx, "Researcher")).toEqual({
      kind: "found",
      id: T1,
      name: "Researcher",
    });
  });
});

describe("M-10 — a workspace-scoped API key inherits nobody's reach", () => {
  /**
   * ⚠ ARM 2 OF THE MATRIX, AND THE REASON THE LAUNCH LANE HAD TO START CARRYING
   * `apiKeyWorkspaceId` ON ITS CONTEXT (2026-08-23). Such a key may be shared
   * between humans — CI runners, service accounts — so it must never resolve the
   * key-owner's private templates by name. Building the template context with a
   * `null` here is the exact shape that would.
   */
  const keyCtx: AgentTemplateContext = { ...ctx, apiKeyWorkspaceId: WS };

  it("cannot resolve the key owner's own private template, by id or by name", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(template());
    expect(await resolveTemplateRef(keyCtx, T1)).toEqual({ kind: "not-found" });
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([template()]);
    expect(await resolveTemplateRef(keyCtx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("…and the SAME context resolves a workspace-visible one, so this is arm 2 and not a blanket refusal", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(
      template({ visibility: "workspace" })
    );
    expect(await resolveTemplateRef(keyCtx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });

  it("cannot reach a TEAM template even when the key's user is in the team", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(
      template({ visibility: "team", createdBy: OTHER })
    );
    vi.mocked(repo.listTeamIdsForUser).mockResolvedValue([TEAM]);
    vi.mocked(repo.listTeamLinksForTemplates).mockResolvedValue([
      { templateId: T1, teamId: TEAM },
    ] as never);
    expect(await resolveTemplateRef(keyCtx, T1)).toEqual({ kind: "not-found" });
    // The same row IS reachable for the person, which is what makes the arm
    // above a fence rather than a bug.
    expect(await resolveTemplateRef(ctx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });
});

// ── THE CROSS-TENANCY CLASSIFIER (T35) ───────────────────────────────────
//
// ⚠ THE PROPERTY: it turns the ONE miss that has an honest cause into a sentence
// an agent can act on, WITHOUT reopening the existence oracle the rest of this
// file pins shut. A template read is keyed `(workspace_id, id)`, so a row in
// another tenancy is filtered out BEFORE `canSeeTemplate` runs — "you own it"
// and "it resolves here" are different questions, and an agent that does not
// know that re-checks the spelling of a name that was never wrong.
//
// ⚠ THE FENCE IS THE QUERY, and it is in `repository.ts ›
// findTemplateTenancyRows`: the caller's OWN rows, or `workspace`-visible ones,
// in workspaces they are an ACTIVE member of. Those tests live with the
// classifier's CALLERS (it cannot name what the query never returns); what is
// pinned HERE is that this function never asks WIDER than that, never asks at
// all for a shared credential, and never asks about its own workspace.

describe("the miss that is not a mystery", () => {
  const OTHER_WS = "77777777-7777-7777-7777-777777777777";
  const LINK_WS = "88888888-8888-8888-8888-888888888888";

  function tenancy(over: Partial<tenancyRepo.TemplateTenancyRow> = {}): tenancyRepo.TemplateTenancyRow {
    return {
      id: T2,
      name: "Code Auditor",
      workspaceId: OTHER_WS,
      workspaceName: "Acme",
      workspaceKind: "standard",
      homeScoped: false,
      ...over,
    };
  }

  beforeEach(() => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(null);
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([]);
    vi.mocked(tenancyRepo.listWorkspaceIdsForUser).mockResolvedValue([WS, OTHER_WS]);
  });

  it("names the workspace a template of the caller's own lives in", async () => {
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([tenancy()]);
    expect(await resolveTemplateRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      template: { name: "Code Auditor", label: "the workspace “Acme”" },
    });
  });

  it("calls the PERSONAL SHELF the personal shelf, never a workspace", async () => {
    // ⚠ A `home_scoped` row is `private` by fence, so the only way it reached
    // the caller-owned arm of the query is that the caller created it — this
    // label is a statement about their own rows and nobody else's.
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([
      tenancy({ homeScoped: true }),
    ]);
    expect(await resolveTemplateRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      template: { name: "Code Auditor", label: "your personal shelf" },
    });
  });

  it("names a home-channel container BY ITS ID, which is the actionable half", async () => {
    // ⚠ §4A: a container is never advertised as a workspace, and its NAME is
    // not the thing you can do anything with — `workspace=<container id>` is.
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([
      tenancy({ workspaceId: LINK_WS, workspaceKind: "link", workspaceName: "Sam & Dana" }),
    ]);
    const out = await resolveTemplateRef(ctx, "Code Auditor");
    expect(out).toEqual({
      kind: "elsewhere",
      template: {
        name: "Code Auditor",
        label: `a home channel of yours, container ${LINK_WS}`,
      },
    });
    expect(JSON.stringify(out)).not.toContain("Sam & Dana");
  });

  it("answers ONE tenancy and never a roster, however many matched", async () => {
    // ⚠ A name can legitimately match in several tenancies. Listing them would
    // be the roster this must not print, and an arbitrary pick would make one
    // refusal read differently on two consecutive calls — so it is sorted.
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([
      tenancy({ workspaceName: "Zephyr" }),
      tenancy({ homeScoped: true }),
    ]);
    expect(await resolveTemplateRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      template: { name: "Code Auditor", label: "the workspace “Zephyr”" },
    });
  });

  it("stays NOT-FOUND when nothing of the caller's matches — the probe-proof arm", async () => {
    // Somebody else's private template in another workspace is exactly this:
    // the query returns nothing, so there is nothing to name.
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([]);
    expect(await resolveTemplateRef(ctx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("NEVER classifies for a SHARED credential, and does not even ask", async () => {
    // 🔒 Arm 2 of `canSeeTemplate` restated, not a second rule: such a key may
    // be shared between humans, so it inherits no one person's reach and must
    // not learn where "their" templates live.
    const keyCtx: AgentTemplateContext = { ...ctx, apiKeyWorkspaceId: WS };
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([tenancy()]);
    expect(await resolveTemplateRef(keyCtx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
    expect(tenancyRepo.listWorkspaceIdsForUser).not.toHaveBeenCalled();
    expect(tenancyRepo.findTemplateTenancyRows).not.toHaveBeenCalled();
  });

  it("asks only about OTHER workspaces of the caller's, and only about this ref", async () => {
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockResolvedValue([]);
    await resolveTemplateRef(ctx, "Code Auditor");
    expect(tenancyRepo.findTemplateTenancyRows).toHaveBeenCalledWith(ME, [OTHER_WS], {
      name: "Code Auditor",
    });
    // ⚠ A UUID ref asks BY ID. Two lookups answering through each other is how
    // "no such id" starts reporting as "no such name".
    vi.mocked(tenancyRepo.findTemplateTenancyRows).mockClear();
    await resolveTemplateRef(ctx, T1);
    expect(tenancyRepo.findTemplateTenancyRows).toHaveBeenCalledWith(ME, [OTHER_WS], {
      id: T1,
    });
  });

  it("does not ask at all when the caller belongs to no OTHER workspace", async () => {
    vi.mocked(tenancyRepo.listWorkspaceIdsForUser).mockResolvedValue([WS]);
    await resolveTemplateRef(ctx, "Code Auditor");
    expect(tenancyRepo.findTemplateTenancyRows).not.toHaveBeenCalled();
  });

  it("costs NOTHING on the hit path — a resolved ref never reaches the classifier", async () => {
    vi.mocked(repo.findTemplateById).mockResolvedValue(template());
    expect(await resolveTemplateRef(ctx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    expect(tenancyRepo.listWorkspaceIdsForUser).not.toHaveBeenCalled();
    expect(tenancyRepo.findTemplateTenancyRows).not.toHaveBeenCalled();
  });

  it("an AMBIGUOUS name is answered here, not sent looking elsewhere", async () => {
    vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([
      template(),
      template({ id: T2, visibility: "workspace", createdBy: OTHER }),
    ]);
    expect(
      (await resolveTemplateRef(ctx, "Code Auditor")).kind
    ).toBe("ambiguous");
    expect(tenancyRepo.findTemplateTenancyRows).not.toHaveBeenCalled();
  });
});
