/**
 * 🔒 THE TWO SHELVES, FOR TEMPLATES — Samuel's ruling 2026-08-27 (converge the
 * Agents face on the Knowledge one), schema
 * `20260901120000_agent_template_home_scoped.sql`.
 *
 * The sibling of `features/knowledge/server/service-shelf.test.ts`, and the
 * same four properties: the shelf reaches the QUERY (not a post-filter);
 * absent means BOTH; and the create fence's three conditions each refuse
 * separately.
 *
 * 🔒 ⚠ THE ORTHOGONALITY PIN IS THE ONE THAT IS NEW HERE. `canSeeTemplate`'s
 * arm 2 (`isSharedCredential`, F-333/F-336) and this column answer DIFFERENT
 * QUESTIONS — "does this credential stand for a person" versus "which of the
 * operator's own two shelves is this row on" — and the shelf must not become a
 * second, weaker visibility gate by accident. It is pinned below by driving a
 * shelf read whose rows would be refused by visibility anyway, and asserting the
 * visibility answer is unchanged.
 *
 * ⚠ MUTATION-VERIFIED; counts in this change's report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTemplate, AgentTemplateContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  insertTemplate: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  replaceTeamLinks: vi.fn(),
  replaceKnowledgeLinks: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
}));

vi.mock("@/features/workspaces/server/service", () => ({
  isOwnPersonalContainer: vi.fn(),
}));

import * as repo from "./repository";
import { isOwnPersonalContainer } from "@/features/workspaces/server/service";
import { listTemplates } from "./service-reads";
import { createTemplate } from "./service-writes";
import { TemplateHomeScopeForbiddenError } from "./errors";

const mockRepo = vi.mocked(repo);
const mockIsOwnHome = vi.mocked(isOwnPersonalContainer);

const HOME_WS = "ws-home";
const USER = "u-operator";

/** A signed-in person in their own personal container. */
function personCtx(over: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
  return {
    workspaceId: HOME_WS,
    userId: USER,
    source: "user",
    role: "owner",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: USER,
    ...over,
  };
}

function tpl(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: HOME_WS,
    name: "Scout",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: USER,
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listTemplatesForWorkspace.mockResolvedValue([]);
  // ⚠ ARRAYS, not Maps — the repository returns flat link rows and the service
  // folds them; a Map here throws inside `decorateWithKnowledgeBases`.
  mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
  mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
  // `createTemplate` returns through `getTemplateById`, so the row has to be
  // findable afterwards — the write is asserted on `insertTemplate`'s args.
  mockRepo.findTemplateById.mockImplementation((_ws, id) =>
    Promise.resolve(tpl({ id })) as never
  );
  mockIsOwnHome.mockImplementation(async (_userId, workspaceId) => workspaceId === HOME_WS);
  mockRepo.insertTemplate.mockImplementation(
    (args) => Promise.resolve(tpl({ name: args.name, visibility: args.visibility })) as never
  );
});

describe("listing one shelf", () => {
  it("pushes the shelf DOWN to the query instead of filtering the answer", async () => {
    // 🔒 The point is the SECOND ARGUMENT, not the returned array. A service
    // that fetched everything and filtered in JS would satisfy any
    // rendered-output assertion while putting the other shelf on the wire
    // (INVARIANTS §11).
    await listTemplates(personCtx(), { shelf: "home" });
    expect(mockRepo.listTemplatesForWorkspace).toHaveBeenCalledWith(HOME_WS, "home");

    await listTemplates(personCtx(), { shelf: "workspace" });
    expect(mockRepo.listTemplatesForWorkspace).toHaveBeenLastCalledWith(
      HOME_WS,
      "workspace"
    );
  });

  it("asks for BOTH shelves when no shelf is named", async () => {
    // ⚠ The launch picker, `resolveTemplateRef` and MCP ride this path.
    // "Absent" is not a defaulted shelf; defaulting it to `workspace` would
    // hide the operator's own home shelf from their own agent at spawn time.
    await listTemplates(personCtx());
    expect(mockRepo.listTemplatesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      undefined
    );
  });

  it("🔒 does NOT become a visibility gate — F-333/F-336 answer the same either way", async () => {
    // 🔒 THE ORTHOGONALITY PIN. A shelf read still runs `canSeeTemplate` after
    // it, and that predicate neither reads nor is passed the shelf. Here a
    // SHARED credential asks for its own shelf: arm 2 refuses the private row
    // exactly as it would on the unfiltered read, and the `workspace` row is
    // returned exactly as it would be. Narrowing can only ever SUBSET.
    const rows = [tpl({ id: "mine", visibility: "private" }), tpl({ id: "pub", visibility: "workspace" })];
    mockRepo.listTemplatesForWorkspace.mockResolvedValue(rows);
    const shared = personCtx({
      source: "agent",
      apiKeyWorkspaceId: HOME_WS,
      credentialSubjectUserId: null,
    });

    const narrowed = await listTemplates(shared, { shelf: "home" });
    const unfiltered = await listTemplates(shared);

    expect(narrowed.map((t) => t.id)).toEqual(["pub"]);
    expect(unfiltered.map((t) => t.id)).toEqual(["pub"]);
  });
});

describe("creating onto the home shelf", () => {
  it("marks the row when a person creates a PRIVATE template in their own home workspace", async () => {
    await createTemplate(personCtx(), { name: "Shelf agent", homeScoped: true });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ homeScoped: true, visibility: "private" })
    );
  });

  it("leaves the row UNMARKED when nobody asked — every pre-existing caller", async () => {
    await createTemplate(personCtx(), { name: "Ordinary" });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ homeScoped: false })
    );
  });

  it("REFUSES when the target is not the caller's own personal container", async () => {
    // A link CONTAINER fails this, and so does any workspace the caller merely
    // belongs to. `isOwnPersonalContainer` is the same answer `POST /api/boot`
    // gives, so the fence and the /home surface cannot disagree about "home".
    mockIsOwnHome.mockResolvedValue(false);

    await expect(
      createTemplate(personCtx(), { name: "Elsewhere", homeScoped: true })
    ).rejects.toBeInstanceOf(TemplateHomeScopeForbiddenError);
    expect(mockRepo.insertTemplate).not.toHaveBeenCalled();
  });

  it("REFUSES a `workspace`-visible template on the shelf", async () => {
    // ⚠ A template has NO grant table and one consumer per row, so `private` is
    // TERMINAL — it is the entire audience statement, which is what makes it
    // the right condition for a shelf the UI calls "yours alone". (Knowledge's
    // equivalent fence treats `private` as a FLOOR, because a KB can still
    // reach a channel through a grant. Same word, different force.)
    await expect(
      createTemplate(personCtx(), {
        name: "Announcement",
        visibility: "workspace",
        homeScoped: true,
      })
    ).rejects.toBeInstanceOf(TemplateHomeScopeForbiddenError);
    expect(mockRepo.insertTemplate).not.toHaveBeenCalled();
  });

  it("REFUSES a SHARED credential — a workspace key has no personal shelf", async () => {
    // ⚠ And it is refused on the CREDENTIAL, before the visibility branch above
    // has any say: `createTemplate` defaults a shared credential to `workspace`,
    // so a fence that only looked at visibility would refuse it for the wrong
    // reason and would let a shared credential through the day that default
    // changed.
    await expect(
      createTemplate(
        personCtx({
          source: "agent",
          apiKeyWorkspaceId: HOME_WS,
          credentialSubjectUserId: null,
        }),
        {
        name: "From a key",
        homeScoped: true,
      })
    ).rejects.toBeInstanceOf(TemplateHomeScopeForbiddenError);
    expect(mockRepo.insertTemplate).not.toHaveBeenCalled();
  });
});
