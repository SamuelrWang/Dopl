/**
 * ONTOLOGY → REVISIONS — the CAPTURE COUNT, the actor, the ontology roll-up and
 * the per-field restore (2026-09-09, the CHANGELOG lane part 2).
 *
 * The claim is a COUNT, and that is the only thing that catches either
 * failure: a path that records TWICE shows one save as two versions of one
 * field; a path that records NONE changes a graph with nothing to say it did.
 * Both are silent in every other suite.
 *
 * The primitive runs for real — only `revisions/server/repository.ts` is
 * stubbed — so `recordRevision`'s actor derivation, its coalescing decision and
 * `restoreRevision`'s refusal are under test rather than mocked out from under
 * it. `appendRevision`'s ARGUMENTS are the assertion surface.
 *
 * Mutation-verified — four reverts, four failures (the READ half's two are in
 * `./service-revisions-read.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyRow, OntologyObjectRow } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";
import type { Revision } from "@/features/revisions/types";

// The primitive's repository, and nothing above it.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async (args: Record<string, unknown>) => ({
    id: "rev-new",
    ...args,
  })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-coalesced" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(async () => null),
  countActiveMembers: vi.fn(async () => 1),
  countOntologyObjects: vi.fn(async () => 0),
}));

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(async () => "standard"),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => ["ch-1"]),
  listSharesForChannels: vi.fn(async () => []),
  listSharesForOntology: vi.fn(async () => []),
  upsertShare: vi.fn(),
  deleteShare: vi.fn(async () => {}),
  findChannelContainer: vi.fn(),
  findActiveMemberRole: vi.fn(),
  countSharesForOntologies: vi.fn(async () => new Map()),
}));

vi.mock("./repository-projections", () => ({
  listOntologySlugs: vi.fn(async () => []),
  listMembershipParents: vi.fn(async () => []),
  listRelationshipsForSource: vi.fn(async () => []),
  listOntologySummaries: vi.fn(async () => []),
  listObjectSummariesByIds: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/home-space-reach", () => ({
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("./repository", () => ({
  listOntologies: vi.fn(async () => []),
  listMemberships: vi.fn(async () => []),
  listObjectsByIds: vi.fn(async () => []),
  listRelationshipsForSources: vi.fn(async () => []),
  filterObjectIds: vi.fn(async () => new Set<string>()),
  replaceRelationshipsForSource: vi.fn(async () => {}),
  insertOntology: vi.fn(),
  updateObject: vi.fn(),
  findOntologyById: vi.fn(),
  insertObject: vi.fn(),
  countMembershipSiblings: vi.fn(async () => 0),
  insertMembership: vi.fn(async () => ({})),
  updateOntology: vi.fn(),
  cascadeHardDeleteOntology: vi.fn(async () => 3),
  findObjectById: vi.fn(),
  hardDeleteObject: vi.fn(async () => {}),
}));

import * as revisionRepo from "@/features/revisions/server/repository";
import * as shareRepo from "./repository-shares";
import * as repo from "./repository";
import {
  createObject,
  deleteOntology,
  deleteObject,
  updateOntology,
  updateObject,
} from "./service";
import { changedFields, objectFields } from "./service-revisions";

const append = vi.mocked(revisionRepo.appendRevision);
const replace = vi.mocked(revisionRepo.replaceRevisionSnapshot);
const mockRepo = vi.mocked(repo);
const mockShares = vi.mocked(shareRepo);

const WS = "ws-1";
const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "22222222-2222-4222-8222-222222222222";

const ctxOf = ontologyContextFactory({ workspaceId: WS });

function ontologyRow(over: Partial<OntologyRow> = {}): OntologyRow {
  return {
    id: ONTOLOGY_ID,
    workspace_id: WS,
    slug: "sales",
    name: "Sales",
    purpose: "",
    layout: {},
    position: 0,
    created_by: "user-1",
    agents_may_edit: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function objectRow(over: Partial<OntologyObjectRow> = {}): OntologyObjectRow {
  return {
    id: OBJECT_ID,
    workspace_id: WS,
    name: "Acme",
    subtitle: "",
    attributes: [
      { key: "stage", label: "Stage", value: { kind: "pill", value: "New" } },
      { key: "owner", label: "Owner", value: { kind: "text", value: "Sam" } },
    ],
    methods: [],
    template: [],
    user_id: null,
    last_edited_by: null,
    last_edited_source: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

/** Every `revisions` row this call appended. */
function rows() {
  return append.mock.calls.map(([args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShares.findWorkspaceKind.mockResolvedValue("standard");
  mockShares.listSharesForChannels.mockResolvedValue([]);
  mockRepo.findOntologyById.mockResolvedValue(ontologyRow());
  mockRepo.findObjectById.mockResolvedValue(objectRow());
});

describe("the field diff", () => {
  it("answers only the fields that MOVED", () => {
    const before = objectFields(objectRow());
    const after = objectFields(objectRow({ subtitle: "A customer" }));
    expect(changedFields(before, after).map((c) => c.field)).toEqual(["subtitle"]);
  });

  it("counts an ADDED attribute and a REMOVED one, with null on the missing half", () => {
    const before = objectFields(objectRow({ attributes: [] }));
    const after = objectFields(objectRow());
    const added = changedFields(before, after);
    expect(added.map((c) => c.field)).toEqual([
      "attribute:owner",
      "attribute:stage",
    ]);
    expect(added[0].before).toBeNull();
    const removed = changedFields(after, before);
    expect(removed[0].after).toBeNull();
  });

  it("an unchanged object answers nothing at all", () => {
    expect(changedFields(objectFields(objectRow()), objectFields(objectRow()))).toEqual(
      []
    );
  });
});

describe("capture — one row per CHANGED field", () => {
  it("an update that moves two fields records exactly two rows", async () => {
    mockRepo.updateObject.mockResolvedValue(
      objectRow({
        name: "Acme Corp",
        attributes: [
          { key: "stage", label: "Stage", value: { kind: "pill", value: "Won" } },
          { key: "owner", label: "Owner", value: { kind: "text", value: "Sam" } },
        ],
      })
    );
    await updateObject(ctxOf(), OBJECT_ID, { name: "Acme Corp" });
    expect(append).toHaveBeenCalledTimes(2);
    expect(rows().map((r) => [r.op, r.payload.field])).toEqual([
      // `rename` for `name`, `edit` for everything else — the primitive's own
      // vocabulary, so the renderer needs no ontology arm to label it.
      ["edit", "attribute:stage"],
      ["rename", "name"],
    ]);
  });

  it("a PATCH that re-sends the stored values records NOTHING", async () => {
    mockRepo.updateObject.mockResolvedValue(objectRow());
    await updateObject(ctxOf(), OBJECT_ID, { name: "Acme" });
    expect(append).not.toHaveBeenCalled();
  });

  it("a create is ONE bundle row plus ONE membership row", async () => {
    mockRepo.insertObject.mockResolvedValue(objectRow());
    await createObject(ctxOf(), { ontologyId: ONTOLOGY_ID, name: "Acme" });
    expect(rows().map((r) => [r.op, r.resourceType])).toEqual([
      ["create", "ontology_object"],
      ["edit", "ontology_object"],
    ]);
    expect(rows()[0].payload.fields).toMatchObject({ name: "Acme" });
    expect(rows()[1].payload).toMatchObject({
      association: "membership",
      after: { ontologyId: ONTOLOGY_ID, parentObjectId: null },
    });
  });

  it("a delete is ONE row carrying the LAST state", async () => {
    await deleteObject(ctxOf(), OBJECT_ID);
    expect(append).toHaveBeenCalledTimes(1);
    expect(rows()[0].op).toBe("delete");
    expect(rows()[0].payload.fields).toMatchObject({ name: "Acme" });
  });

  it("a relationship write records ONE association row, on the object", async () => {
    mockRepo.updateObject.mockResolvedValue(objectRow());
    mockRepo.filterObjectIds.mockResolvedValue(new Set(["33333333-3333-4333-8333-333333333333"]));
    await updateObject(ctxOf(), OBJECT_ID, {
      relationships: [
        { label: "works at", targetIds: ["33333333-3333-4333-8333-333333333333"] },
      ],
    });
    expect(append).toHaveBeenCalledTimes(1);
    expect(rows()[0].payload).toMatchObject({
      association: "relationship",
      before: [],
      after: [
        { label: "works at", targetIds: ["33333333-3333-4333-8333-333333333333"] },
      ],
    });
    // `edit`, NOT a new `link` word — the migration's `op` CHECK is unchanged.
    expect(rows()[0].op).toBe("edit");
  });

  it("an ontology rename records on the ONTOLOGY; a layout drag records nothing", async () => {
    mockRepo.updateOntology.mockResolvedValue(ontologyRow({ name: "Pipeline" }));
    await updateOntology(ctxOf(), ONTOLOGY_ID, { name: "Pipeline" });
    expect(rows().map((r) => [r.resourceType, r.op, r.payload.field])).toEqual([
      ["ontology", "rename", "name"],
    ]);

    append.mockClear();
    mockRepo.updateOntology.mockResolvedValue(ontologyRow({ layout: { a: { x: 1, y: 2 } } }));
    await updateOntology(ctxOf(), ONTOLOGY_ID, { layout: { a: { x: 1, y: 2 } } });
    expect(append).not.toHaveBeenCalled();
  });

  it("an ontology delete records one row carrying the cascade count", async () => {
    await deleteOntology(ctxOf(), ONTOLOGY_ID);
    expect(append).toHaveBeenCalledTimes(1);
    expect(rows()[0].payload.fields).toMatchObject({ cascadedObjects: 3 });
  });
});

describe("the actor", () => {
  it("an MCP write carries the agent session id; a person's write carries none", async () => {
    mockRepo.updateObject.mockResolvedValue(objectRow({ subtitle: "A customer" }));
    await updateObject(
      ctxOf({ source: "agent", sessionId: "ch-1:slot-2" }),
      OBJECT_ID,
      { subtitle: "A customer" }
    );
    expect(rows()[0]).toMatchObject({
      actorKind: "agent",
      agentSessionId: "ch-1:slot-2",
    });

    append.mockClear();
    mockRepo.updateObject.mockResolvedValue(objectRow({ subtitle: "Another" }));
    await updateObject(ctxOf({ sessionId: "ch-1:slot-2" }), OBJECT_ID, {
      subtitle: "Another",
    });
    expect(rows()[0]).toMatchObject({
      actorKind: "user",
      agentSessionId: null,
    });
  });

  it("🔒 an ontology write NEVER coalesces, even for the same person seconds apart", async () => {
    vi.mocked(revisionRepo.findLatestRevision).mockResolvedValue({
      id: "rev-open",
      resourceType: "ontology_object",
      resourceId: OBJECT_ID,
      workspaceId: WS,
      actor: { userId: "user-1", kind: "user", agentSessionId: null },
      op: "edit",
      summary: null,
      payload: { field: "subtitle", before: "", after: "x" },
      contentHash: "h",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Revision);
    mockRepo.updateObject.mockResolvedValue(objectRow({ subtitle: "A customer" }));
    await updateObject(ctxOf(), OBJECT_ID, { subtitle: "A customer" });
    // A new row, never the open one rewritten: coalescing would replace one
    // FIELD's history with another's (F-686 point 3).
    expect(append).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
