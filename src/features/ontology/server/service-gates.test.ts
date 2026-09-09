/**
 * INVARIANT SUITE — 🔒 THE ONTOLOGY WRITE AND READ GATES inside a HOME
 * container (`service-gates.ts`, spec §4 sites 2-6).
 *
 * `service.test.ts` runs the same service in a STANDARD workspace, where the
 * ceiling answers `unrestricted` and today's behaviour is unchanged. This file
 * moves it into a `link` container and pins the four things the sharing model
 * IS: reads are FILTERED, a `view` level REFUSES a write, Q9's all-clusters
 * rule holds on an object in two clusters, and every write is ATTRIBUTED.
 *
 * ⚠ **SPLIT OUT OF `service.test.ts` AT THE §1 CAP** (it measured 508 of 500).
 * The seam is the one the source has: what is pinned here is the GATE, and what
 * is pinned there is the object cap and the CRUD contracts the gate stands in
 * front of.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyClusterRow, OntologyObjectRow } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";

// ⚠ **THE CHANGELOG CAPTURE IS A REAL WRITE AND IT IS AWAITED**
// (`./service-revisions.ts`, 2026-09-09, part 2): every ontology write now
// records one revision per CHANGED FIELD inside the same request, so a service
// test that leaves it alone reaches `supabaseAdmin()` and fails on a missing
// service-role key. Stubbed here because these suites are about the WRITE, not
// about its audit rows — that the rows are recorded, one per changed field, per
// path, is `service-revisions.test.ts`'s subject.
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
  // ⚠ The card's "shared into N channels" read (`service-reads.ts ›
  // mapClusterRow`). It rides `getSnapshot`'s second fan, so a mock that omits
  // it fails every snapshot case here with a missing-export error rather than a
  // wrong answer.
  countSharesForClusters: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("./repository-projections", () => ({
  listClusterSlugs: vi.fn(async () => []),
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
  listClusters: vi.fn(),
  listMemberships: vi.fn(),
  listObjectsByIds: vi.fn(),
  listRelationshipsForSources: vi.fn(),
  findClusterById: vi.fn(),
  insertCluster: vi.fn(),
  updateCluster: vi.fn(),
  cascadeHardDeleteCluster: vi.fn(),
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
  createCluster,
  createObject,
  deleteCluster,
  deleteObject,
  getAnchor,
  getSnapshot,
  updateCluster,
  updateObject,
} from "./service";

const mockRepo = vi.mocked(repo);
const mockAnchor = vi.mocked(anchorRepo);
const mockNarrow = vi.mocked(narrowRepo);
const mockShareRepo = vi.mocked(shareRepo);

const WS = "ws-1";
const CLUSTER_ID = "11111111-1111-4111-8111-111111111111";
const LINK = "ws-link";
const PEER_CLUSTER = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";

const CLUSTER_ROW: OntologyClusterRow = {
  id: CLUSTER_ID,
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

describe("home container — reads are FILTERED to the admitted clusters", () => {
  it("drops a cluster with no share row, and never reads its objects", async () => {
    primeHome([share({ ontology: CLUSTER_ID, members: "view" })]);
    mockRepo.listClusters.mockResolvedValue([
      CLUSTER_ROW,
      { ...CLUSTER_ROW, id: PEER_CLUSTER, created_by: "somebody-else" },
    ]);
    mockRepo.listMemberships.mockResolvedValue([
      {
        id: "m-1",
        workspace_id: WS,
        cluster_id: CLUSTER_ID,
        parent_object_id: null,
        child_object_id: "obj-1",
        position: 0,
      },
      {
        id: "m-2",
        workspace_id: WS,
        cluster_id: PEER_CLUSTER,
        parent_object_id: null,
        child_object_id: "obj-secret",
        position: 0,
      },
    ]);
    mockRepo.listObjectsByIds.mockResolvedValue([OBJECT_ROW]);
    mockRepo.listRelationshipsForSources.mockResolvedValue([]);

    const snapshot = await getSnapshot(homeCtx({ userId: "user-1" }));

    expect(snapshot.clusters.map((c) => c.id)).toEqual([CLUSTER_ID]);
    // 🔒 The unadmitted cluster's object is not merely unrendered — it is
    // never ASKED FOR. A filter applied after the read is a filter a second
    // consumer of the rows walks straight past.
    expect(mockRepo.listObjectsByIds).toHaveBeenCalledWith(expect.anything(), ["obj-1"]);
  });
});

describe("home container — a `view` level REFUSES every write", () => {
  beforeEach(() => {
    primeHome([share({ ontology: CLUSTER_ID, members: "view" })]);
    mockRepo.findClusterById.mockResolvedValue({
      ...CLUSTER_ROW,
      created_by: "somebody-else",
    });
  });

  it("updateCluster 404s rather than 403s — refusal is never an oracle", async () => {
    await expect(
      updateCluster(homeCtx(), CLUSTER_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateCluster).not.toHaveBeenCalled();
  });

  it("deleteCluster refuses before the cascade RPC", async () => {
    await expect(deleteCluster(homeCtx(), CLUSTER_ID)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockRepo.cascadeHardDeleteCluster).not.toHaveBeenCalled();
  });

  it("createObject refuses before the entitlement check and the insert", async () => {
    await expect(
      createObject(homeCtx(), { clusterId: CLUSTER_ID, name: "Card" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.insertObject).not.toHaveBeenCalled();
  });

  it("createCluster refuses an AGENT whose owner lane is capped at view", async () => {
    // Solo toggle OFF is the same answer as a shared room: not `edit`.
    mockShareRepo.countActiveWorkspaceMembers.mockResolvedValue(4);
    await expect(
      createCluster(homeCtx({ source: "agent" }), { name: "New" })
    ).rejects.toMatchObject({ status: 403 });
    expect(mockRepo.insertCluster).not.toHaveBeenCalled();
  });
});

describe("home container — Q9, an object in TWO clusters", () => {
  const bothClusters = [
    { ...CLUSTER_ROW, created_by: "somebody-else" },
    { ...CLUSTER_ROW, id: PEER_CLUSTER, created_by: "somebody-else" },
  ];

  function primeObjectInBoth(secondLevel: "none" | "view" | "edit") {
    primeHome([
      share({ ontology: CLUSTER_ID, members: "edit" }),
      share({ ontology: PEER_CLUSTER, members: secondLevel }),
    ]);
    mockRepo.findObjectById.mockResolvedValue({
      ...OBJECT_ROW,
      id: OBJECT_ID,
    });
    mockRepo.listClusters.mockResolvedValue(bothClusters);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { cluster_id: CLUSTER_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { cluster_id: PEER_CLUSTER, parent_object_id: null, child_object_id: OBJECT_ID },
    ]);
    mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
  }

  it("a WRITE needs `edit` on EVERY cluster — `edit` + `view` is a refusal", async () => {
    primeObjectInBoth("view");
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateObject).not.toHaveBeenCalled();
  });

  it("`edit` + `none` is a refusal too — an invisible cluster still COUNTS", async () => {
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

  it("a cluster the walk NAMES but this caller cannot even SEE still refuses the write", async () => {
    // 🔒 The sharpest form of Q9. The object hangs under a visible cluster the
    // caller may edit AND under one in a container this request never reached,
    // so the second never comes back from `listClusters` — an `every` over the
    // VISIBLE ones alone would silently admit the write. A cluster you cannot
    // see is not a cluster that stops counting.
    primeHome([share({ ontology: CLUSTER_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listClusters.mockResolvedValue([
      { ...CLUSTER_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { cluster_id: CLUSTER_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { cluster_id: "c-invisible", parent_object_id: null, child_object_id: OBJECT_ID },
    ]);

    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.updateObject).not.toHaveBeenCalled();
  });

  it("🔒 a READ needs `view` on ANY — one visible cluster is enough, even beside an invisible one", async () => {
    primeHome([share({ ontology: CLUSTER_ID, members: "view" })]);
    mockAnchor.findAnchorObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listClusters.mockResolvedValue([
      { ...CLUSTER_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { cluster_id: CLUSTER_ID, parent_object_id: null, child_object_id: OBJECT_ID },
      { cluster_id: "c-invisible", parent_object_id: null, child_object_id: OBJECT_ID },
    ]);

    // ⚠ The ASYMMETRY is the ruling: the very same pair of clusters that
    // REFUSES the write two cases up ADMITS the read.
    await expect(getAnchor(homeCtx())).resolves.toMatchObject({ id: OBJECT_ID });
  });

  it("an object reachable from NO cluster is refused — `every` over nothing must not admit", async () => {
    primeObjectInBoth("edit");
    mockNarrow.listMembershipParents.mockResolvedValue([]);
    await expect(
      updateObject(homeCtx(), OBJECT_ID, { name: "Renamed" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * 🔒 Q8 ON A WRITE — an EDGE may not reach out of the shared cluster.
 *
 * ⚠ The scope holds the LENDER's whole container by construction, so
 * `repository.ts › filterObjectIds` (which asks only "is this a live row in the
 * scope") admits a target the caller cannot see. `service-gates.ts ›
 * admittedObjectIds` is the second half, and this is the case that would pass
 * without it.
 */
describe("Q8 on a WRITE — an edge target outside the shared cluster is dropped", () => {
  const FOREIGN = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    primeHome([share({ ontology: CLUSTER_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listClusters.mockResolvedValue([
      { ...CLUSTER_ROW, created_by: "somebody-else" },
      // The LENDER's other, unshared ontology — in the scope, not in the answer.
      { ...CLUSTER_ROW, id: PEER_CLUSTER, created_by: "somebody-else" },
    ]);
    // Both rows are LIVE and in the read scope: the old filter admitted both.
    mockRepo.filterObjectIds.mockResolvedValue(new Set([OBJECT_ID, FOREIGN]));
    mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockNarrow.listMembershipParents.mockImplementation(async (_ws, ids) => {
      const asked = new Set(ids);
      const rows: {
        cluster_id: string | null;
        parent_object_id: string | null;
        child_object_id: string;
      }[] = [];
      if (asked.has(OBJECT_ID)) {
        rows.push({
          cluster_id: CLUSTER_ID,
          parent_object_id: null,
          child_object_id: OBJECT_ID,
        });
      }
      if (asked.has(FOREIGN)) {
        rows.push({
          cluster_id: PEER_CLUSTER,
          parent_object_id: null,
          child_object_id: FOREIGN,
        });
      }
      return rows;
    });
  });

  it("keeps a target inside an admitted cluster and drops one outside it", async () => {
    await updateObject(homeCtx(), OBJECT_ID, {
      relationships: [{ label: "reports to", targetIds: [OBJECT_ID, FOREIGN] }],
    });
    // ⚠ `OBJECT_ID` is the SOURCE, so the self-ref is dropped too — what is
    // left is the empty label, which `sanitizeEdges` drops whole.
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
    primeHome([share({ ontology: CLUSTER_ID, members: "edit" })]);
    mockRepo.findObjectById.mockResolvedValue({ ...OBJECT_ROW, id: OBJECT_ID });
    mockRepo.listClusters.mockResolvedValue([
      { ...CLUSTER_ROW, created_by: "somebody-else" },
    ]);
    mockNarrow.listMembershipParents.mockResolvedValue([
      { cluster_id: CLUSTER_ID, parent_object_id: null, child_object_id: OBJECT_ID },
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
    primeHome([share({ ontology: CLUSTER_ID, members: "edit" })]);
    mockRepo.findClusterById.mockResolvedValue({
      ...CLUSTER_ROW,
      created_by: "somebody-else",
    });
    mockRepo.insertObject.mockResolvedValue(OBJECT_ROW);
    mockRepo.insertMembership.mockResolvedValue({
      id: "m-1",
      workspace_id: WS,
      cluster_id: CLUSTER_ID,
      parent_object_id: null,
      child_object_id: OBJECT_ROW.id,
      position: 0,
    });

    await createObject(homeCtx({ source: "agent" }), {
      clusterId: CLUSTER_ID,
      name: "Sales Rep",
    });

    expect(mockRepo.insertObject).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "user-1", source: "agent" })
    );
  });
});
