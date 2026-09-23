/**
 * `unreachableKnowledgeBaseCount` — WHAT A LAUNCH IS TOLD ABOUT AN ATTACHMENT IT
 * CANNOT REACH (Samuel's ruling, 2026-09-05).
 *
 * ⚠ THE RULING IN ONE LINE: a user MAY attach a shared base to a personal
 * identity, and launching it where the base is out of reach must START THE AGENT
 * ANYWAY and let it say *"I don't have access to this knowledge base in this
 * channel"* — WITHOUT saying where the base lives.
 *
 * So the two halves this file pins are:
 *   1. the COUNT is honest (it is the junction rows the viewer filter dropped),
 *      and it never blocks the launch;
 *   2. the payload carries NOTHING ELSE about a dropped base — no id, no name,
 *      no container — because the prompt line the desktop writes from it is the
 *      one place a location leak would land in text an agent reads.
 *
 * ⚠ SIBLING OF `service-resolve.test.ts`, same seam and same mocks: this file
 * owns the REACH arithmetic, that one owns `authoredByCaller` and the 404.
 * Through the public service with the repository mocked: no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity, AgentIdentityContext } from "../types";

// ⚠ THE GRANT ARM IS A DB READ (F-604) — empty here, exactly as the sibling
// suite declares it: every case below is about the viewer filter's OTHER arms.
vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

vi.mock("./repository", () => ({
  listIdentitiesForWorkspace: vi.fn(),
  findIdentityById: vi.fn(),
  listTeamLinksForIdentities: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listKnowledgeLinksForIdentities: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
  listLiveFoldersForBases: vi.fn(),
  listLiveEntryRows: vi.fn(),
}));

vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import { resolveIdentityForLaunch } from "./service";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancy);

const CREATOR = "user-creator";
const REACHABLE = "kb-reachable";
const OUT_OF_REACH = "kb-out-of-reach";

function ctx(overrides: Partial<AgentIdentityContext> = {}): AgentIdentityContext {
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

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Code Auditor",
    description: "ignored by the launch payload",
    instructions: "Audit the diff.",
    model: "claude-opus-5",
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

/** A junction row: the identity NAMES this base, whatever the reader can see.
 *  ⚠ SCOPED SINCE 2026-09-08 — `scope_kind` defaults to `'base'`, which is what
 *  every row written before that migration IS. */
const link = (knowledgeBaseId: string) => ({
  identityId: "tpl-1",
  knowledgeBaseId,
  scopeKind: "base" as const,
  folderId: null,
  entryId: null,
});

/** A junction row naming ONE FOLDER of a base. */
const folderLink = (knowledgeBaseId: string, folderId: string) => ({
  identityId: "tpl-1",
  knowledgeBaseId,
  scopeKind: "folder" as const,
  folderId,
  entryId: null,
});

/** …and one naming a single ENTRY. */
const entryLink = (knowledgeBaseId: string, entryId: string) => ({
  identityId: "tpl-1",
  knowledgeBaseId,
  scopeKind: "entry" as const,
  folderId: null,
  entryId,
});

/** A base row the viewer filter WILL keep — public, workspace-wide. */
const visibleBase = (id: string, name: string) => ({
  id,
  name,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  createdBy: CREATOR,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTenancy.resolveResource.mockResolvedValue(null);
  mockRepo.findIdentityById.mockResolvedValue(identity());
  mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.listLiveFoldersForBases.mockResolvedValue([]);
  mockRepo.listLiveEntryRows.mockResolvedValue([]);
  mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
});

describe("the count", () => {
  it("is 0 when the identity attaches nothing", async () => {
    // ⚠ A DECIDED ZERO, not an absence: this row went through the decoration and
    // the answer is "nothing was dropped".
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([]);
  });

  it("is 0 when every attachment resolves", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(REACHABLE)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });

  it("counts the attachment the viewer filter dropped — THE RULED CASE", async () => {
    // The shared base attached to a personal identity, launched where the base
    // does not resolve: the junction row exists, the base row does not come back.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("counts only the dropped ones when an identity has both", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      link(REACHABLE),
      link(OUT_OF_REACH),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });
});

describe("what it must NOT do", () => {
  it("does not block the launch — the payload is whole, minus the base", async () => {
    // ⚠ THE HALF OF THE RULING A REFUSAL WOULD BREAK. An unreachable attachment
    // is a thing to SAY, never a reason to refuse to start.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.name).toBe("Code Auditor");
    expect(resolved.instructions).toBe("Audit the diff.");
    expect(resolved.knowledgeBases).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("says NOTHING about the dropped base beyond the count — no id, no name, no container", async () => {
    // 🔒 The leak test. Serialised, because a location could hide in any key: the
    // payload may not contain the dropped id anywhere, at any depth.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(JSON.stringify(resolved)).not.toContain(OUT_OF_REACH);
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledge",
      "knowledgeBases",
      "model",
      "name",
      "unreachableKnowledgeBaseCount",
    ]);
  });

  it("issues NO second read to find out where the base went", async () => {
    // ⚠ THE ARITHMETIC IS OVER ROWS ALREADY READ. A probe for a base outside the
    // caller's reach is precisely what the no-location rule forbids, so the count
    // must cost exactly the queries the decoration already made.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(mockRepo.listKnowledgeLinksForIdentities).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledWith("ws-1", [
      OUT_OF_REACH,
    ]);
  });
});

/**
 * SUB-BASE SCOPES, THROUGH THE SAME DECORATION (2026-09-08).
 *
 * ⚠ **A SCOPE DROPS WITH ITS BASE, AND ALSO ON ITS OWN.** The base predicate is
 * the ceiling — a folder is reachable exactly when its base is — but a folder
 * that has been TRASHED, or that turns out to live in a different base than the
 * scope names, drops too, and drops into the SAME count. Splitting that count
 * would put the disclosure decision on four surfaces instead of one.
 */
describe("folder and entry scopes", () => {
  const FOLDER = "f-1";
  const ENTRY = "e-1";

  it("renders a folder scope as a path, and a toolPath that is NOT the display one", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: "f-0", knowledgeBaseId: REACHABLE, parentId: null, name: "Runbooks" },
      { id: FOLDER, knowledgeBaseId: REACHABLE, parentId: "f-0", name: "Deploys" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge).toEqual([
      {
        baseId: REACHABLE,
        baseName: "Ops Notes",
        scope: "folder",
        folderId: FOLDER,
        folderName: "Deploys",
        // ⚠ THE WHOLE CHAIN, root-first, led by the BASE NAME — display.
        path: "Ops Notes / Runbooks / Deploys",
        // …and the base-relative address a `dopl_kb` call takes. The two are
        // never interchangeable: a base named "Ops / Legal" makes splitting one
        // back into the other silently wrong.
        toolPath: "Runbooks/Deploys",
      },
    ]);
    // 🔒 A folder scope is NOT in the base-level slice — listing its base would
    // tell an older reader the whole base is attached.
    expect(resolved.knowledgeBases).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
  });

  it("renders an entry scope at its folder's path", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      entryLink(REACHABLE, ENTRY),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: "f-0", knowledgeBaseId: REACHABLE, parentId: null, name: "Runbooks" },
    ]);
    mockRepo.listLiveEntryRows.mockResolvedValue([
      { id: ENTRY, knowledgeBaseId: REACHABLE, folderId: "f-0", title: "Rollback" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge[0]?.path).toBe("Ops Notes / Runbooks / Rollback");
    expect(resolved.knowledge[0]?.toolPath).toBe("Runbooks/Rollback");
  });

  it("drops a TRASHED entry into the same count, naming nothing", async () => {
    // The live-entry read simply does not return it, which is how a soft delete
    // reaches this layer.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      entryLink(REACHABLE, ENTRY),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveEntryRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(JSON.stringify(resolved)).not.toContain(ENTRY);
  });

  it("drops a folder that lives in ANOTHER base — the row is not evidence", async () => {
    // 🔒 The trigger refuses this write; this refuses the READ of a row written
    // before the trigger existed. A path naming one base beside a tool call
    // naming another is an agent pointed at the wrong document.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: OUT_OF_REACH, parentId: null, name: "Elsewhere" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("drops every scope of a base the viewer cannot see, without reading its tree", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(OUT_OF_REACH, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    // ⚠ NO PROBE. Reading the folders of a base the caller cannot see is a
    // result we would then have to remember to discard.
    expect(mockRepo.listLiveFoldersForBases).not.toHaveBeenCalled();
  });
});

/**
 * **THE ATTACHED-BASE CARD** (A4, 2026-09-18) — the four facts a `scope: "base"`
 * ref now carries so a role block can name a base well enough to open the right
 * thing without a `get_tree`-and-guess round trip.
 *
 * ⚠ **THE VIEWER FILTER IS UNCHANGED AND IS ASSERTED HERE TOO.** The card is
 * more detail about a base, so the case that matters most is the one where the
 * base is not visible: nothing about it may appear, and the disclosure stays the
 * bare COUNT this file's other half pins.
 */
describe("the base card", () => {
  const folder = (id: string, name: string, description: string | null = null) => ({
    id,
    knowledgeBaseId: REACHABLE,
    parentId: null,
    name,
    description,
  });

  beforeEach(() => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(REACHABLE)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      {
        ...visibleBase(REACHABLE, "Deploys"),
        slug: "deploys",
        description: "How this service is released.",
      },
    ]);
  });

  it("carries the slug, the summary, the TOP-LEVEL folders and the true count", async () => {
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      folder("f-1", "Runbooks", "one per incident class"),
      folder("f-2", "Postmortems"),
      // ⚠ A CHILD FOLDER IS NOT A CARD FOLDER — the whole subtree is what
      // `get_tree` is for, and a recursive list is the unbounded thing the card
      // refuses to be.
      { ...folder("f-3", "2026"), parentId: "f-2" },
    ]);

    const [ref] = (await resolveIdentityForLaunch(ctx(), "tpl-1")).knowledge;
    expect(ref.baseSlug).toBe("deploys");
    expect(ref.baseSummary).toBe("How this service is released.");
    expect(ref.baseFolders).toEqual([
      { name: "Runbooks", summary: "one per incident class" },
      { name: "Postmortems" },
    ]);
    expect(ref.baseFolderCount).toBe(2);
  });

  it("🔒 says NOTHING about a base the viewer cannot see — not even its shape", async () => {
    // ⚠ The ruling's line: a dropped attachment discloses a COUNT and nothing
    // else. A card would be a name, a slug and a folder list — the exact
    // location information the filter exists to withhold.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);

    const resolved = await resolveIdentityForLaunch(ctx(), "tpl-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(JSON.stringify(resolved)).not.toContain(OUT_OF_REACH);
  });

  it("a FOLDER scope gets no card — it already names the thing it points at", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, "f-1"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([folder("f-1", "Runbooks")]);

    const [ref] = (await resolveIdentityForLaunch(ctx(), "tpl-1")).knowledge;
    expect(ref.scope).toBe("folder");
    expect(ref.baseSlug).toBeUndefined();
    expect(ref.baseFolders).toBeUndefined();
    expect(ref.baseFolderCount).toBeUndefined();
  });

  it("a base with no folders carries a count of 0, which is an ANSWER", async () => {
    mockRepo.listLiveFoldersForBases.mockResolvedValue([]);
    const [ref] = (await resolveIdentityForLaunch(ctx(), "tpl-1")).knowledge;
    expect(ref.baseFolders).toEqual([]);
    expect(ref.baseFolderCount).toBe(0);
  });
});
