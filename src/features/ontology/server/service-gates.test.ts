/**
 * Invariant suite — the ontology write and read gates inside a HOME
 * container (`service-gates.ts`, spec §4 sites 2-6). `service.test.ts` runs
 * the same service in a standard workspace; this file moves it into a `link`
 * container and pins: reads are filtered, a `view` level refuses a write, Q9's
 * all-ontologies rule holds on an object in two ontologies, and every write is
 * attributed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyRow, OntologyObjectRow } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";

// The changelog capture is a real awaited write (`./service-revisions.ts`), so
// an unstubbed service test reaches `supabaseAdmin()` and fails on a missing
// service-role key. That the rows are recorded is `service-revisions.test.ts`'s subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listSharesForChannels: vi.fn(),
  // The card's "shared into N channels" read (`service-reads.ts ›
  // mapOntologyRow`). It rides `getSnapshot`'s second fan, so a mock that omits
  // it fails every snapshot case here with a missing-export error rather than a
  // wrong answer.
  countSharesForOntologies: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("./repository-projections", () => ({
  listOntologySlugs: vi.fn(async () => []),
  listMembershipParents: vi.fn(async () => []),
  listRelationshipsForSource: vi.fn(async () => []),
}));

vi.mock("./repository-anchor", () => ({
  findAnchorObject: vi.fn(),
  setAnchor: vi.fn(),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  personalShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("@/features/billing/server/entitlements", () => ({
  assertCanCreateObject: vi.fn(async () => undefined),
}));

vi.mock("./repository", () => ({
  listOntologies: vi.fn(),
  listMemberships: vi.fn(),
  listObjectsByIds: vi.fn(),
  listRelationshipsForSources: vi.fn(),
  findOntologyById: vi.fn(),
  insertOntology: vi.fn(),
  updateOntology: vi.fn(),
  cascadeHardDeleteOntology: vi.fn(),
  findObjectById: vi.fn(),
  insertObject: vi.fn(),
  updateObject: vi.fn(),
  hardDeleteObject: vi.fn(),
  countMembershipSiblings: vi.fn(async () => 0),
  insertMembership: vi.fn(),
  replaceRelationshipsForSource: vi.fn(),
  filterObjectIds: vi.fn(async () => new Set<string>()),
}));

import * as repo from "./repository";
import * as anchorRepo from "./repository-anchor";
import * as narrowRepo from "./repository-projections";
import * as shareRepo from "./repository-shares";
import {
  createOntology,
  createObject,
  deleteOntology,
  deleteObject,
  getAnchor,
  getSnapshot,
  updateOntology,
  updateObject,
} from "./service";

const mockRepo = vi.mocked(repo);
const mockAnchor = vi.mocked(anchorRepo);
const mockNarrow = vi.mocked(narrowRepo);
const mockShareRepo = vi.mocked(shareRepo);

const WS = "ws-1";
const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";
const LINK = "ws-link";
const PEER_ONTOLOGY = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";

const ONTOLOGY_ROW: OntologyRow = {
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
};

const OBJECT_ROW: OntologyObjectRow = {
  id: "obj-1",
  workspace_id: WS,
  name: "Sales Rep",
  subtitle: "",
  attributes: [],
  methods: [],
  template: [],
  user_id: null,
  last_edited_by: null,
  last_edited_source: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.countMembershipSiblings.mockResolvedValue(0);
  mockNarrow.listMembershipParents.mockResolvedValue([]);
});

const homeCtx = ontologyContextFactory({ workspaceId: LINK });

function share(over: { ontology: string; members?: "none" | "view" | "edit" }) {
  return {
    ontology_id: over.ontology,
    channel_id: "ch-1",
    workspace_id: WS,
    members_level: over.members ?? "view",
    guests_level: "none",
    owner_agents_level: "view",
  } as const;
}

function primeHome(shares: ReturnType<typeof share>[]) {
  mockShareRepo.findWorkspaceKind.mockResolvedValue("link");
  mockShareRepo.countActiveWorkspaceMembers.mockResolvedValue(2);
  mockShareRepo.listChannelIdsForWorkspace.mockResolvedValue(["ch-1"]);
  mockShareRepo.listSharesForChannels.mockResolvedValue([...shares]);
}

describe("home container — reads are FILTERED to the admitted ontologies", () => {
  it("drops an ontology with no share row, and never reads its objects", async () => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "view" })]);
    mockRepo.listOntologies.mockResolvedValue([
      ONTOLOGY_ROW,
      { ...ONTOLOGY_ROW, id: PEER_ONTOLOGY, created_by: "somebody-else" },
    ]);
    mockRepo.listMemberships.mockResolvedValue([
      {
        id: "m-1",
        workspace_id: WS,
        ontology_id: ONTOLOGY_ID,
        parent_object_id: null,
        child_object_id: "obj-1",
        position: 0,
      },
      {
        id: "m-2",
        workspace_id: WS,
        ontology_id: PEER_ONTOLOGY,
        parent_object_id: null,
        child_object_id: "obj-secret",
        position: 0,
      },
    ]);
    mockRepo.listObjectsByIds.mockResolvedValue([OBJECT_ROW]);
    mockRepo.listRelationshipsForSources.mockResolvedValue([]);

    const snapshot = await getSnapshot(homeCtx({ userId: "user-1" }));

    expect(snapshot.ontologies.map((c) => c.id)).toEqual([ONTOLOGY_ID]);
    // The unadmitted ontology's object is never ASKED FOR: a filter applied
    // after the read is one a second consumer of the rows walks straight past.
    expect(mockRepo.listObjectsByIds).toHaveBeenCalledWith(expect.anything(), ["obj-1"]);
  });
});

describe("home container — a `view` level REFUSES every write", () => {
  beforeEach(() => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "view" })]);
    mockRepo.findOntologyById.mockResolvedValue({
      ...ONTOLOGY_ROW,
      created_by: "somebody-else",
    });
  });

  it("updateOntology 404s rather than 403s — refusal is never an oracle", async () => {
    await expect(
      updateOntology(homeCtx(), ONTOLOGY_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateOntology).not.toHaveBeenCalled();
  });

  it("deleteOntology refuses before the cascade RPC", async () => {
    await expect(deleteOntology(homeCtx(), ONTOLOGY_ID)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockRepo.cascadeHardDeleteOntology).not.toHaveBeenCalled();
  });

  it("createObject refuses before the entitlement check and the insert", async () => {
    await expect(
      createObject(homeCtx(), { ontologyId: ONTOLOGY_ID, name: "Card" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.insertObject).not.toHaveBeenCalled();
  });

  it("createOntology refuses an AGENT whose owner lane is capped at view", async () => {
    // Solo toggle OFF is the same answer as a shared room: not `edit`.
    mockShareRepo.countActiveWorkspaceMembers.mockResolvedValue(4);
    await expect(
      createOntology(homeCtx({ source: "agent" }), { name: "New" })
    ).rejects.toMatchObject({ status: 403 });
    expect(mockRepo.insertOntology).not.toHaveBeenCalled();
  });
});

describe("home container — Q9, an object in TWO ontologies", () => {
  const bothOntologies = [
    { ...ONTOLOGY_ROW, created_by: "somebody-else" },
    { ...ONTOLOGY_ROW, id: PEER_ONTOLOGY, created_by: "somebody-else" },
  ];

  function primeObjectInBoth(secondLevel: "none" | "view" | "edit") {
    primeHome([
      share({ ontology: ONTOLOGY_ID, members: "edit" }),
      share({ ontology: PEER_ONTOLOGY, members: secondLevel }),
    ]);
    mockRepo.findObjectById.mockResolvedValue({
      ...OBJECT_ROW,
      id: OBJECT_ID,
    });
    mockRepo.listOntologies.mockResolvedValue(bothOntologies);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { ontology_id: ONTOLOGY_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { ontology_id: PEER_ONTOLOGY, parent_object_id: null, child_object_id: OBJECT_ID },
    ]);
    mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
  }

  it("a WRITE needs `edit` on EVERY ontology — `edit` + `view` is a refusal", async () => {
    primeObjectInBoth("view");
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateObject).not.toHaveBeenCalled();
  });

  it("`edit` + `none` is a refusal too — an invisible ontology still COUNTS", async () => {
    primeObjectInBoth("none");
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("`edit` on BOTH admits the write", async () => {
    primeObjectInBoth("edit");
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).resolves.toMatchObject({ id: OBJECT_ID });
  });

  it("a READ needs `view` on ANY — `edit` + `none` still deletes nothing but reads", async () => {
    primeObjectInBoth("none");
    mockRepo.hardDeleteObject.mockResolvedValue(undefined);
    await expect(deleteObject(homeCtx(), OBJECT_ID)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockRepo.hardDeleteObject).not.toHaveBeenCalled();
  });

  it("an ontology the walk NAMES but this caller cannot even SEE still refuses the write", async () => {
    // The sharpest form of Q9: the object also hangs under an ontology in a
    // container this request never reached, so `listOntologies` never returns it —
    // an `every` over the visible ones alone would admit the write.
    primeHome([share({ ontology: ONTOLOGY_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listOntologies.mockResolvedValue([
      { ...ONTOLOGY_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { ontology_id: ONTOLOGY_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { ontology_id: "c-invisible", parent_object_id: null, child_object_id: OBJECT_ID },
    ]);

    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateObject).not.toHaveBeenCalled();
  });

  it("🔒 a READ needs `view` on ANY — one visible ontology is enough, even beside an invisible one", async () => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "view" })]);
    mockAnchor.findAnchorObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listOntologies.mockResolvedValue([
      { ...ONTOLOGY_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { ontology_id: ONTOLOGY_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { ontology_id: "c-invisible", parent_object_id: null, child_object_id: OBJECT_ID },
    ]);

    // The asymmetry is the ruling: the same pair of ontologies that refuses the
    // write two cases up admits the read.
    await expect(getAnchor(homeCtx())).resolves.toMatchObject({ id: OBJECT_ID });
  });

  it("an object reachable from NO ontology is refused — `every` over nothing must not admit", async () => {
    primeObjectInBoth("edit");
    mockNarrow.listMembershipParents.mockResolvedValue([]);
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * Q8 on a WRITE — an edge may not reach out of the shared ontology.
 *
 * The scope holds the LENDER's whole container by construction, so
 * `repository.ts › filterObjectIds` (which asks only "is this a live row in the
 * scope") admits a target the caller cannot see. `service-gates.ts ›
 * admittedObjectIds` is the second half, and this is the case that would pass
 * without it.
 */
describe("Q8 on a WRITE — an edge target outside the shared ontology is dropped", () => {
  const FOREIGN = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listOntologies.mockResolvedValue([
      { ...ONTOLOGY_ROW, created_by: "somebody-else" },
      // The LENDER's other, unshared ontology — in the scope, not in the answer.
      { ...ONTOLOGY_ROW, id: PEER_ONTOLOGY, created_by: "somebody-else" },
    ]);
    // Both rows are LIVE and in the read scope: the old filter admitted both.
    mockRepo.filterObjectIds.mockResolvedValue(new Set([OBJECT_ID, FOREIGN]));
    mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockNarrow.listMembershipParents.mockImplementation(async (_ws, ids) => {
      const asked = new Set(ids);
      const rows: {
        ontology_id: string | null;
        parent_object_id: string | null;
        child_object_id: string;
      }[] = [];
      if (asked.has(OBJECT_ID)) {
        rows.push({
          ontology_id: ONTOLOGY_ID,
          parent_object_id: null,
          child_object_id: OBJECT_ID,
        });
      }
      if (asked.has(FOREIGN)) {
        rows.push({
          ontology_id: PEER_ONTOLOGY,
          parent_object_id: null,
          child_object_id: FOREIGN,
        });
      }
      return rows;
    });
  });

  it("keeps a target inside an admitted ontology and drops one outside it", async () => {
    await updateObject(homeCtx(), OBJECT_ID, {
      relationships: [{ label: "reports to", targetIds: [OBJECT_ID, FOREIGN] }],
    });
    // `OBJECT_ID` is the source, so the self-ref is dropped too — what is left
    // is the empty label, which `sanitizeEdges` drops whole.
    expect(mockRepo.replaceRelationshipsForSource).toHaveBeenCalledWith(
      WS,
      OBJECT_ID,
      []
    );
  });

  it("an edge already written to a foreign target is not READ BACK either", async () => {
    mockNarrow.listRelationshipsForSource.mockResolvedValue([
      {
        id: "r-1",
        workspace_id: WS,
        source_object_id: OBJECT_ID,
        target_object_id: FOREIGN,
        label: "reports to",
        position: 0,
      },
    ]);
    const object = await updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" });
    expect(object.relationships).toEqual([]);
  });
});

describe("attribution — Q3/Q6, an edit survives the unshare", () => {
  it("stamps last_edited_by and last_edited_source on an object update", async () => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listOntologies.mockResolvedValue([
      { ...ONTOLOGY_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { ontology_id: ONTOLOGY_ID, parent_object_id: null, child_object_id: OBJECT_ID },
    ]);
    mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });

    await updateObject(homeCtx({ source: "agent" }), OBJECT_ID, { name: "Renamed" });

    expect(mockRepo.updateObject).toHaveBeenCalledWith(
      WS,
      OBJECT_ID,
      { name: "Renamed" },
      { userId: "user-1", source: "agent" },
      undefined
    );
  });

  it("stamps the AUTHOR and the SOURCE on a create too", async () => {
    primeHome([share({ ontology: ONTOLOGY_ID, members: "edit" })]);
    mockRepo.findOntologyById.mockResolvedValue({
      ...ONTOLOGY_ROW,
      created_by: "somebody-else",
    });
    mockRepo.insertObject.mockResolvedValue(OBJECT_ROW);
    mockRepo.insertMembership.mockResolvedValue({
      id: "m-1",
      workspace_id: WS,
      ontology_id: ONTOLOGY_ID,
      parent_object_id: null,
      child_object_id: OBJECT_ROW.id,
      position: 0,
    });

    await createObject(homeCtx({ source: "agent" }), {
      ontologyId: ONTOLOGY_ID,
      name: "Sales Rep",
    });

    expect(mockRepo.insertObject).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "user-1", source: "agent" })
    );
  });
});
