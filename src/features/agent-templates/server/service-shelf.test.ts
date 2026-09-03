/**
 * 🔒 THE TWO SHELVES, FOR TEMPLATES — Samuel's ruling 2026-08-27 (converge the
 * Agents face on the Knowledge one). ⚠ **A TENANCY SINCE 2026-09-02 (slice B15,
 * ruling B10)**: `20260901120000`'s column is dropped by
 * `20260923120000_drop_home_scoped.sql`, and the personal shelf is the caller's
 * own `kind='personal'` container.
 *
 * The sibling of `features/knowledge/server/service-shelf.test.ts`: the shelf
 * reaches the QUERY (not a post-filter) and absent means BOTH.
 * ⚠ **THE CREATE FENCE'S THREE CONDITIONS LEFT ON 2026-09-02 (slice B15)** with
 * `resolveTemplateHomeScope` and the column — see the write block below.
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

import * as repo from "./repository";
import { listTemplates } from "./service-reads";
import { createTemplate } from "./service-writes";

const mockRepo = vi.mocked(repo);

const HOME_WS = "ws-home";
const USER = "u-operator";

/** A signed-in person in their own default standard workspace. */
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

describe("creating onto the personal shelf", () => {
  // ⚠ **FIVE CASES BECAME TWO ON 2026-09-02 (slice B15)** — the twin of the trim
  // in `knowledge/server/service-shelf.test.ts`, and for once the two files
  // agreeing is the assertion rather than the risk. `resolveTemplateHomeScope`
  // is deleted; the one surviving condition is pinned against BOTH tables at
  // once in `shared/tenancy/personal-shelf-repositories.test.ts`.
  //
  // ⚠ **THE `private`-IS-TERMINAL CASE IS GONE AND ITS ARGUMENT IS WORTH
  // KEEPING**: a template had no grant table and one consumer per row, so
  // `private` was the entire audience statement, where a KB's `private` was a
  // floor. Both stopped mattering when the shelf became a container with exactly
  // one member — and a template HAS a grant table now (`resource_grants` at
  // `resource_type='agent_template'`, B1), which is what `op="grant"` lends.

  it("passes the caller's own flag straight through, unchanged", async () => {
    await createTemplate(personCtx(), { name: "Shelf agent", homeScoped: true });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ homeScoped: true, visibility: "private" })
    );
  });

  it("passes NOTHING through when nobody asked — every pre-existing caller", async () => {
    await createTemplate(personCtx(), { name: "Ordinary" });
    const args = mockRepo.insertTemplate.mock.calls[0][0];
    expect(args.homeScoped).toBeUndefined();
  });
});
