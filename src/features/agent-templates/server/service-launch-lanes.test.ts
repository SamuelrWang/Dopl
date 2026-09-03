/**
 * 🔒 **THE TWO LANES OF ONE LAUNCH, DRIVEN OVER ONE FIXTURE — SAMUEL'S RULING
 * #18** (B2, 2026-09-02).
 *
 * A launch passes two fences and they belong to DIFFERENT PEOPLE:
 *
 *   - the CREATE fence, under the ORCHESTRATOR's credential —
 *     `channels/server/service-launch-template.ts › resolveTemplateForDirective`
 *     → `service-resolve-ref.ts › resolveTemplateRef`;
 *   - the RESOLVE fence, on the OPERATOR's desktop at spawn —
 *     `GET /api/agent-templates/{id}/resolve` → `service-reads.ts ›
 *     resolveTemplateForLaunch` → `readTemplateById`.
 *
 * ⚠ **UNTIL B2 THEY DISAGREED ABOUT AN ID.** A12 made the second follow an id
 * into the container it names and left the first workspace-keyed, so a personal
 * template 404'd on CREATE and resolved on SPAWN. Wave A recorded that rather
 * than closing it, because closing it was a DECISION. Ruling #18 made it:
 * **a personal template launches anywhere its owner is**, and both lanes follow
 * the id.
 *
 * ⚠ **THIS FILE ASSERTS AGREEMENT, NOT EITHER FENCE.** The fence is
 * `shared/tenancy/resolve-resource.test.ts` (un-mocked); the follow is
 * `shared/tenancy/read-resource.test.ts`; the matrix is
 * `service-visibility.test.ts`. What only this file can say is that two doors
 * give the SAME answer about the SAME id — a property that has no home in either
 * door's own suite, which is exactly why it drifted for a wave.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
  resolveResourcesByName: vi.fn(async () => []),
}));

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { resolveTemplateForLaunch, resolveTemplateRef } from "./service";
import { AgentTemplateNotFoundError } from "./errors";

const ME = "user-me";
const OTHER = "user-other";
/** Where the caller was authorised — a channel's container, say. */
const HERE = "11111111-1111-1111-1111-111111111111";
/** Where the template actually lives — the caller's personal shelf. */
const SHELF = "22222222-2222-2222-2222-222222222222";
const ID = "44444444-4444-4444-4444-444444444444";

function ctx(over: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
  return {
    workspaceId: HERE,
    userId: ME,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: ME,
    ...over,
  };
}

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: ID,
    workspaceId: SHELF,
    name: "Code Auditor",
    description: null,
    instructions: "Audit the diff.",
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** The row exists on the caller's PERSONAL SHELF and nowhere else. ⚠
 *  `findTemplateById` is workspace-keyed, so the read in `HERE` must miss or
 *  there is nothing for either lane to follow. */
function livesOnTheShelf(over: Partial<AgentTemplate> = {}) {
  vi.mocked(repo.findTemplateById).mockImplementation(async (workspaceId) =>
    workspaceId === SHELF ? template(over) : null
  );
  vi.mocked(tenancy.resolveResource).mockResolvedValue({
    type: "agent_template",
    id: ID,
    name: "Code Auditor",
    containerId: SHELF,
    containerName: "",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "admin",
  } satisfies ResolvedResource);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([]);
  vi.mocked(repo.findTemplateById).mockResolvedValue(null);
  vi.mocked(repo.listTemplatesForWorkspace).mockResolvedValue([]);
  vi.mocked(repo.listKnowledgeLinksForTemplates).mockResolvedValue([]);
  vi.mocked(repo.listKnowledgeBaseAccessRows).mockResolvedValue([]);
  vi.mocked(repo.listKnowledgeBaseTeamGrants).mockResolvedValue([]);
  vi.mocked(repo.listTeamLinksForTemplates).mockResolvedValue([]);
  vi.mocked(repo.listTeamIdsForUser).mockResolvedValue([]);
});

describe("🔒 ruling #18 — a personal template launches anywhere its owner is", () => {
  it("BOTH lanes resolve an id living in another container of the caller's", async () => {
    livesOnTheShelf();
    // The CREATE lane (orchestrator).
    await expect(resolveTemplateRef(ctx(), ID)).resolves.toEqual({
      kind: "found",
      id: ID,
      name: "Code Auditor",
    });
    // The SPAWN lane (operator's desktop).
    await expect(resolveTemplateForLaunch(ctx(), ID)).resolves.toMatchObject({
      name: "Code Auditor",
      instructions: "Audit the diff.",
      authoredByCaller: true,
    });
  });

  it("BOTH lanes miss an id that is nameable nowhere", async () => {
    // ⚠ The probe-proof arm, on both doors at once. Somebody else's private
    // template is exactly this: the resolver names nothing, so neither lane can.
    await expect(resolveTemplateRef(ctx(), ID)).resolves.toEqual({
      kind: "not-found",
    });
    await expect(resolveTemplateForLaunch(ctx(), ID)).rejects.toBeInstanceOf(
      AgentTemplateNotFoundError
    );
  });

  it("🔒 BOTH lanes still refuse what the MATRIX refuses in the container it named", async () => {
    // 🔒 RESOLUTION IS NOT AUTHORISATION, on either door. The resolver is
    // strictly narrower than `canSeeTemplate` and cannot have named this row —
    // and even handed the address, both lanes re-run the matrix and answer the
    // same single miss.
    livesOnTheShelf({ createdBy: OTHER });
    await expect(resolveTemplateRef(ctx(), ID)).resolves.toEqual({
      kind: "not-found",
    });
    await expect(resolveTemplateForLaunch(ctx(), ID)).rejects.toBeInstanceOf(
      AgentTemplateNotFoundError
    );
  });

  it("neither lane pays for the follow when the template is where it was asked for", async () => {
    vi.mocked(repo.findTemplateById).mockImplementation(async (workspaceId) =>
      workspaceId === HERE ? template({ workspaceId: HERE }) : null
    );
    await resolveTemplateRef(ctx(), ID);
    await resolveTemplateForLaunch(ctx(), ID);
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});

describe("⚠ a NAME does not follow, on either lane, and that is deliberate", () => {
  it("labels the tenancy instead of picking one", async () => {
    // `agent_templates` has no name uniqueness, so a name matching in two
    // containers has no non-arbitrary answer — every tie-break launches an
    // identity the caller did not choose. The CREATE lane says WHERE instead;
    // the SPAWN lane never sees a name at all (the directive stores the ID).
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      {
        type: "agent_template",
        id: ID,
        name: "Code Auditor",
        containerId: SHELF,
        containerName: "",
        // ⚠ **THE PERSONAL SHELF IS A CONTAINER KIND SINCE 2026-09-02 (B15).**
        containerKind: "personal",
        ownedByCaller: true,
        containerRole: "admin",
      },
    ]);
    await expect(resolveTemplateRef(ctx(), "Code Auditor")).resolves.toEqual({
      kind: "elsewhere",
      template: { name: "Code Auditor", label: "your personal container" },
    });
  });
});
