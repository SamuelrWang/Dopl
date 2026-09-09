/**
 * ONTOLOGY → REVISIONS, THE READ HALF — one object's history, the CLUSTER
 * ROLL-UP and the PER-FIELD RESTORE (2026-09-09, the CHANGELOG lane part 2).
 *
 * ⚠ **SPLIT FROM `./service-revisions.test.ts` AT THE §1 CAP, ON THE SAME SEAM
 * THE SOURCE IS SPLIT ON** — capture there, reads and restore here. The mock
 * preamble is duplicated rather than shared: a helper module would be a third
 * file that both suites' `vi.mock` factories cannot close over anyway (they are
 * hoisted).
 *
 * ⚠ **THE PRIMITIVE RUNS FOR REAL — only `revisions/server/repository.ts` is
 * stubbed** — so `restoreRevision`'s own refusal is under test rather than
 * mocked out from under it.
 *
 * ⚠ MUTATION-VERIFIED — two reverts, two failures: `restoreObjectRevision`
 * writing without the `restore` op override (no new row is filed as a restore);
 * and `listClusterRevisions` losing its gate (the `none` reader gains history).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyClusterRow, OntologyObjectRow } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";
import type { Revision } from "@/features/revisions/types";

// ⚠ THE PRIMITIVE'S REPOSITORY, AND NOTHING ABOVE IT.
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
  listSharesForCluster: vi.fn(async () => []),
  upsertShare: vi.fn(),
  deleteShare: vi.fn(async () => {}),
  findChannelContainer: vi.fn(),
  findActiveMemberRole: vi.fn(),
  countSharesForClusters: vi.fn(async () => new Map()),
}));

vi.mock("./repository-projections", () => ({
  listClusterSlugs: vi.fn(async () => []),
  listMembershipParents: vi.fn(async () => []),
  listRelationshipsForSource: vi.fn(async () => []),
  listClusterSummaries: vi.fn(async () => []),
  listObjectSummariesByIds: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  personalShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("./repository", () => ({
  listClusters: vi.fn(async () => []),
  listMemberships: vi.fn(async () => []),
  listObjectsByIds: vi.fn(async () => []),
  listRelationshipsForSources: vi.fn(async () => []),
  filterObjectIds: vi.fn(async () => new Set<string>()),
  replaceRelationshipsForSource: vi.fn(async () => {}),
  insertCluster: vi.fn(),
  updateObject: vi.fn(),
  findClusterById: vi.fn(),
  insertObject: vi.fn(),
  countMembershipSiblings: vi.fn(async () => 0),
  insertMembership: vi.fn(async () => ({})),
  updateCluster: vi.fn(),
  cascadeHardDeleteCluster: vi.fn(async () => 3),
  findObjectById: vi.fn(),
  hardDeleteObject: vi.fn(async () => {}),
}));

import * as revisionRepo from "@/features/revisions/server/repository";
import * as shareRepo from "./repository-shares";
import * as repo from "./repository";
import {
  listClusterRevisions,
  listObjectRevisions,
  restoreObjectRevision,
} from "./service-revisions-read";

const append = vi.mocked(revisionRepo.appendRevision);
const mockRepo = vi.mocked(repo);
const mockShares = vi.mocked(shareRepo);

const WS = "ws-1";
const OWNER_WS = "ws-owner";
const CLUSTER_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "22222222-2222-4222-8222-222222222222";

const ctxOf = ontologyContextFactory({ workspaceId: WS });

function clusterRow(over: Partial<OntologyClusterRow> = {}): OntologyClusterRow {
  return {
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
  mockRepo.findClusterById.mockResolvedValue(clusterRow());
  mockRepo.findObjectById.mockResolvedValue(objectRow());
});

describe("the cluster roll-up", () => {
  beforeEach(() => {
    mockRepo.listMemberships.mockResolvedValue([
      {
        id: "m-1",
        workspace_id: WS,
        cluster_id: CLUSTER_ID,
        parent_object_id: null,
        child_object_id: OBJECT_ID,
        position: 0,
      },
      {
        id: "m-2",
        workspace_id: WS,
        cluster_id: "other-cluster",
        parent_object_id: null,
        child_object_id: "44444444-4444-4444-8444-444444444444",
        position: 0,
      },
    ]);
  });

  it("asks for the cluster's OWN rows and its objects', and nothing else's", async () => {
    await listClusterRevisions(ctxOf(), CLUSTER_ID);
    const [workspaceId, ids] = vi.mocked(
      revisionRepo.listRevisionsForResources
    ).mock.calls[0];
    expect(workspaceId).toBe(WS);
    // ⚠ THE ID SET IS THE FENCE — the object of ANOTHER cluster is not on it,
    // because the walk is the same boundary `getSnapshot` uses (Q8).
    expect(new Set(ids)).toEqual(new Set([CLUSTER_ID, OBJECT_ID]));
  });

  it("🔒 a lent reader at `view` sees the history; one with no share gets 404", async () => {
    mockShares.findWorkspaceKind.mockResolvedValue("link");
    mockRepo.findClusterById.mockResolvedValue(
      clusterRow({ workspace_id: OWNER_WS, created_by: "owner-1" })
    );
    const share = {
      ontology_id: CLUSTER_ID,
      channel_id: "ch-1",
      workspace_id: OWNER_WS,
      members_level: "view" as const,
      guests_level: "none" as const,
      owner_agents_level: "view" as const,
    };
    mockShares.listSharesForChannels.mockResolvedValue([share]);
    await expect(listClusterRevisions(ctxOf(), CLUSTER_ID)).resolves.toMatchObject({
      revisions: [],
    });

    mockShares.listSharesForChannels.mockResolvedValue([
      { ...share, members_level: "none" as const },
    ]);
    // ⚠ A 404, never a 403 — "not shared with you" and "does not exist" are one
    // answer (`service-gates.ts`).
    await expect(listClusterRevisions(ctxOf(), CLUSTER_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("per-field restore", () => {
  const SOURCE: Revision = {
    id: "rev-1",
    resourceType: "ontology_object",
    resourceId: OBJECT_ID,
    workspaceId: WS,
    actor: { userId: "user-1", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload: {
      field: "attribute:stage",
      before: { kind: "pill", value: "New" },
      after: { kind: "pill", value: "Won" },
    },
    contentHash: "h",
    createdAt: "2026-09-08T10:00:00.000Z",
    updatedAt: "2026-09-08T10:00:00.000Z",
  };

  it("writes the prior value through the object service and appends a NEW row", async () => {
    vi.mocked(revisionRepo.findRevisionById).mockResolvedValue(SOURCE);
    mockRepo.findObjectById.mockResolvedValue(
      objectRow({
        attributes: [
          { key: "stage", label: "Stage", value: { kind: "pill", value: "Won" } },
        ],
      })
    );
    // ⚠ THE POST-WRITE ROW carries the restored value and NOTHING ELSE moved —
    // one field restored is one revision, which is the count below.
    mockRepo.updateObject.mockResolvedValue(
      objectRow({
        attributes: [
          { key: "stage", label: "Stage", value: { kind: "pill", value: "New" } },
        ],
      })
    );

    await restoreObjectRevision(ctxOf(), OBJECT_ID, "rev-1");

    // ⚠ THE MERGE, NOT A REPLACEMENT OF THE BAG: only `stage` moves.
    expect(mockRepo.updateObject.mock.calls[0][2]).toMatchObject({
      attributes: [
        { key: "stage", label: "Stage", value: { kind: "pill", value: "New" } },
      ],
    });
    // ⚠ A NEW ROW, op `restore`, naming the SOURCE's date — never a rewrite of
    // the row it restored from.
    expect(append).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({
      op: "restore",
      summary: "Restored the version from 2026-09-08",
    });
  });

  it("🔒 refuses at `view` — a lent reader cannot restore", async () => {
    vi.mocked(revisionRepo.findRevisionById).mockResolvedValue(SOURCE);
    mockShares.findWorkspaceKind.mockResolvedValue("link");
    mockRepo.findObjectById.mockResolvedValue(
      objectRow({ workspace_id: OWNER_WS })
    );
    mockRepo.findClusterById.mockResolvedValue(
      clusterRow({ workspace_id: OWNER_WS, created_by: "owner-1" })
    );
    mockRepo.listClusters.mockResolvedValue([
      clusterRow({ workspace_id: OWNER_WS, created_by: "owner-1" }),
    ]);
    vi.mocked(
      (await import("./repository-projections")).listMembershipParents
    ).mockResolvedValue([
      { cluster_id: CLUSTER_ID, parent_object_id: null, child_object_id: OBJECT_ID },
    ]);
    mockShares.listSharesForChannels.mockResolvedValue([
      {
        ontology_id: CLUSTER_ID,
        channel_id: "ch-1",
        workspace_id: OWNER_WS,
        members_level: "view",
        guests_level: "none",
        owner_agents_level: "view",
      },
    ]);
    await expect(
      restoreObjectRevision(ctxOf(), OBJECT_ID, "rev-1")
    ).rejects.toMatchObject({ status: 404 });
    expect(append).not.toHaveBeenCalled();
  });

  it("refuses an ASSOCIATION row — there is no field to write back", async () => {
    vi.mocked(revisionRepo.findRevisionById).mockResolvedValue({
      ...SOURCE,
      payload: { association: "relationship", field: "relationship", before: [], after: [] },
    });
    await expect(
      restoreObjectRevision(ctxOf(), OBJECT_ID, "rev-1")
    ).rejects.toMatchObject({ code: "REVISION_NOT_RESTORABLE" });
  });
});

describe("one object's history", () => {
  it("is gated at `view` and reaches only that object's rows", async () => {
    await listObjectRevisions(ctxOf(), OBJECT_ID);
    expect(vi.mocked(revisionRepo.listRevisionsForResource).mock.calls[0].slice(0, 2)).toEqual([
      "ontology_object",
      OBJECT_ID,
    ]);
  });
});
