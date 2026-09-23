/**
 * 🔒 THE TWO SHELVES, FOR IDENTITIES — Samuel's ruling 2026-08-27 (converge the
 * Agents face on the Knowledge one). ⚠ **A TENANCY SINCE 2026-09-02 (slice B15,
 * ruling B10)**: `20260901120000`'s column is dropped by
 * `20260923120000_drop_home_scoped.sql`, and the personal shelf is the caller's
 * own `kind='personal'` container.
 *
 * The sibling of `features/knowledge/server/service-shelf.test.ts`: the shelf
 * reaches the QUERY (not a post-filter) and absent means BOTH.
 * ⚠ **THE CREATE FENCE'S THREE CONDITIONS LEFT ON 2026-09-02 (slice B15)** with
 * `resolveIdentityHomeScope` and the column — see the write block below.
 *
 * 🔒 ⚠ THE ORTHOGONALITY PIN IS THE ONE THAT IS NEW HERE. `canSeeIdentity`'s
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
import type { AgentIdentity, AgentIdentityContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", () => ({
  listIdentitiesForWorkspace: vi.fn(),
  findIdentityById: vi.fn(),
  insertIdentity: vi.fn(),
  listTeamLinksForIdentities: vi.fn(),
  replaceTeamLinks: vi.fn(),
  replaceKnowledgeLinks: vi.fn(),
  listKnowledgeLinksForIdentities: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listLiveFoldersForBases: vi.fn(),
  listLiveEntryRows: vi.fn(),
}));

// ⚠ **NEW ON THE A2 CLEANUP SLICE, AND IT IS WHY THE WRITE BLOCK BELOW MOVED.**
// `createIdentity` now RESOLVES where the row lands before inserting it
// (`service-write-gates.ts`), and that decision asks the personal fence. Mocked
// OPEN here so this file keeps measuring the SERVICE — every direction of the
// fence itself is `shared/tenancy/personal-reach.test.ts`, and the seam's own
// arms are `service-write-gates.test.ts`.
vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(async () => ({
    kind: "open",
    containerId: "ws-personal",
  })),
  personalShelfContainerIds: vi.fn(async () => []),
}));

// ⚠ A create that LEFT the calling container is re-read through the A12
// resolving read, whose FOLLOW is another module's job and is tested there.
vi.mock("@/shared/tenancy/read-resource", () => ({
  readResourceById: vi.fn(),
}));

// ⚠ **NEW ON 2026-09-18, AND FOR THE SAME REASON THE PERSONAL FENCE ABOVE IS
// MOCKED.** A private create now asks
// `workspaces/server/home-channel-destination.ts › assertHomeChannelRowIsShared`
// where the row is LANDING, and that reads the workspace row. Answered
// `personal` here — this file's whole subject is the personal shelf, which is
// destination 1 and the one the fence must never refuse. Every direction of the
// rule is `workspaces/server/home-channel-destination.test.ts`.
vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(async () => ({ id: "ws-personal", kind: "personal" })),
}));

import * as repo from "./repository";
import { readResourceById } from "@/shared/tenancy/read-resource";
import { listIdentities } from "./service-reads";
import { createIdentity } from "./service-writes";

const mockRepo = vi.mocked(repo);
const mockFollow = vi.mocked(readResourceById);

const HOME_WS = "ws-home";
const PERSONAL_WS = "ws-personal";
const USER = "u-operator";

/** A signed-in person in their own default standard workspace. */
function personCtx(over: Partial<AgentIdentityContext> = {}): AgentIdentityContext {
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

function tpl(over: Partial<AgentIdentity> = {}): AgentIdentity {
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
  mockRepo.listIdentitiesForWorkspace.mockResolvedValue([]);
  // ⚠ ARRAYS, not Maps — the repository returns flat link rows and the service
  // folds them; a Map here throws inside `decorateWithKnowledgeBases`.
  mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
  mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listLiveFoldersForBases.mockResolvedValue([]);
  mockRepo.listLiveEntryRows.mockResolvedValue([]);
  // `createIdentity` returns through `getIdentityById`, so the row has to be
  // findable afterwards — the write is asserted on `insertIdentity`'s args.
  mockRepo.findIdentityById.mockImplementation((_ws, id) =>
    Promise.resolve(tpl({ id })) as never
  );
  mockRepo.insertIdentity.mockImplementation(
    (args) => Promise.resolve(tpl({ name: args.name, visibility: args.visibility })) as never
  );
  // The A12 follow, for a row that landed outside the calling container.
  mockFollow.mockImplementation(
    async () => ({ value: tpl({ workspaceId: PERSONAL_WS }) }) as never
  );
});

describe("listing one shelf", () => {
  it("pushes the shelf DOWN to the query instead of filtering the answer", async () => {
    // 🔒 The point is the SECOND ARGUMENT, not the returned array. A service
    // that fetched everything and filtered in JS would satisfy any
    // rendered-output assertion while putting the other shelf on the wire
    // (INVARIANTS §11).
    await listIdentities(personCtx(), { shelf: "home" });
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(HOME_WS, "home");

    await listIdentities(personCtx(), { shelf: "workspace" });
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenLastCalledWith(
      HOME_WS,
      "workspace"
    );
  });

  it("asks for BOTH shelves when no shelf is named", async () => {
    // ⚠ The launch picker, `resolveIdentityRef` and MCP ride this path.
    // "Absent" is not a defaulted shelf; defaulting it to `workspace` would
    // hide the operator's own home shelf from their own agent at spawn time.
    await listIdentities(personCtx());
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      undefined
    );
  });

  it("🔒 does NOT become a visibility gate — F-333/F-336 answer the same either way", async () => {
    // 🔒 THE ORTHOGONALITY PIN. A shelf read still runs `canSeeIdentity` after
    // it, and that predicate neither reads nor is passed the shelf. Here a
    // SHARED credential asks for its own shelf: arm 2 refuses the private row
    // exactly as it would on the unfiltered read, and the `workspace` row is
    // returned exactly as it would be. Narrowing can only ever SUBSET.
    const rows = [tpl({ id: "mine", visibility: "private" }), tpl({ id: "pub", visibility: "workspace" })];
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue(rows);
    const shared = personCtx({
      source: "agent",
      apiKeyWorkspaceId: HOME_WS,
      credentialSubjectUserId: null,
    });

    const narrowed = await listIdentities(shared, { shelf: "home" });
    const unfiltered = await listIdentities(shared);

    expect(narrowed.map((t) => t.id)).toEqual(["pub"]);
    expect(unfiltered.map((t) => t.id)).toEqual(["pub"]);
  });
});

describe("decorating a list that spans containers (P7-02)", () => {
  const KB_PERSONAL = "kb-personal";

  it("reads each row's knowledge in ITS OWN container, so a personal row keeps its set", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      tpl({ id: "here", workspaceId: HOME_WS }),
      tpl({ id: "personal", workspaceId: PERSONAL_WS }),
    ]);
    // Junction and base rows are filed under the row's container: asked under the
    // calling one, the personal row's links are simply not there.
    mockRepo.listKnowledgeLinksForIdentities.mockImplementation(async (ws) =>
      ws === PERSONAL_WS
        ? [{ identityId: "personal", knowledgeBaseId: KB_PERSONAL, scopeKind: "base", folderId: null, entryId: null }]
        : []
    );
    mockRepo.listKnowledgeBaseAccessRows.mockImplementation(async (ws) =>
      ws === PERSONAL_WS
        ? ([{ id: KB_PERSONAL, name: "Notes", visibility: "private", accessMode: "workspace", createdBy: USER }] as never)
        : []
    );

    const rows = await listIdentities(personCtx());
    const personal = rows.find((t) => t.id === "personal");

    expect(mockRepo.listKnowledgeLinksForIdentities).toHaveBeenCalledWith(PERSONAL_WS, ["personal"]);
    expect(personal?.knowledgeBases).toEqual([{ id: KB_PERSONAL, name: "Notes" }]);
    expect(personal?.unreachableKnowledgeBaseCount).toBe(0);
    expect(rows.map((t) => t.id)).toEqual(["here", "personal"]);
  });
});

describe("creating onto the personal shelf", () => {
  // ⚠ **FIVE CASES BECAME TWO ON 2026-09-02 (slice B15)** — the twin of the trim
  // in `knowledge/server/service-shelf.test.ts`, and for once the two files
  // agreeing is the assertion rather than the risk. `resolveIdentityHomeScope`
  // is deleted; the one surviving condition is pinned against BOTH tables at
  // once in `shared/tenancy/personal-shelf-repositories.test.ts`.
  //
  // ⚠ **THE `private`-IS-TERMINAL CASE IS GONE AND ITS ARGUMENT IS WORTH
  // KEEPING**: an identity had no grant table and one consumer per row, so
  // `private` was the entire audience statement, where a KB's `private` was a
  // floor. Both stopped mattering when the shelf became a container with exactly
  // one member — and an identity HAS a grant table now (`resource_grants` at
  // `resource_type='agent_identity'`, B1), which is what `op="grant"` lends.

  // ⚠ **"PASSES THE FLAG STRAIGHT THROUGH" IS RETIRED ON THE A2 CLEANUP SLICE,
  // AND ITS REVERSAL IS THE POINT.** Straight through was the DEFECT: the flag
  // reached `personalWriteWorkspaceId` with nothing having asked whether this
  // caller may touch that shelf from this room, so an agent in an unarmed
  // shared room could write onto its operator's personal container while
  // `personal-reach.ts` refused it even to LIST the same rows. The twin pin in
  // `knowledge/server/service-shelf.test.ts` moved for the same reason, and the
  // two files agreeing is again the assertion rather than the risk.

  it("resolves the asked-for shelf to a container, and the two AGREE", async () => {
    // 🔒 THE FLAG AND THE ID TOGETHER: the router resolves the container from
    // the flag by OWNER and the gate resolved it through the fence by the same
    // owner, so the insert cannot land somewhere the junctions and the re-read
    // are not looking.
    await createIdentity(personCtx(), { name: "Shelf agent", homeScoped: true });
    expect(mockRepo.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScoped: true,
        workspaceId: PERSONAL_WS,
        visibility: "private",
      })
    );
  });

  it("🔒 re-reads a row that LEFT the room through the resolving read", async () => {
    // 🔒 THE 404-AFTER-A-SUCCESSFUL-CREATE, CLOSED. The response re-read was
    // keyed to `ctx.workspaceId` while the row had just been routed into the
    // personal container, so `findIdentityById(room, id)` answered null and the
    // caller got `AgentIdentityNotFoundError` for a create that had landed.
    await createIdentity(personCtx(), { name: "Shelf agent", homeScoped: true });

    expect(mockFollow).toHaveBeenCalledTimes(1);
    expect(mockRepo.findIdentityById).not.toHaveBeenCalled();
  });

  it("🔒 invents NO shelf when nobody asked — the calling container, still", async () => {
    // ⚠ THE ASSERTION MOVED FROM `undefined` TO `false` AND THE BEHAVIOUR DID
    // NOT: the router tests `homeScoped !== true`, so absent and `false` are
    // one instruction. 🔒 The load-bearing halves are the CONTAINER — a create
    // nobody re-routed must land exactly where it always did — and the re-read
    // staying on the gated in-tenancy path, which costs no extra query.
    await createIdentity(personCtx(), { name: "Ordinary" });
    const args = mockRepo.insertIdentity.mock.calls[0][0];
    expect(args.homeScoped).toBe(false);
    expect(args.workspaceId).toBe(HOME_WS);
    expect(mockFollow).not.toHaveBeenCalled();
  });
});
