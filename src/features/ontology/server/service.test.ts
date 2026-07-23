/**
 * INVARIANT SUITE — ontology object-cap enforcement (freeze-don't-delete).
 *
 * createObject is THE create-time choke point for the free-plan object cap.
 * These tests drive the real gate (createObject → assertCanCreateObject →
 * getWorkspaceEntitlements) with the billing counts + ontology repository
 * mocked, so the plan/member/object matrix decides the outcome:
 *   - free 2-member at 50 objects   -> create OK
 *   - free 2-member at 100 objects  -> EntitlementError(over_free_cap)
 *   - solo free at 5000 objects     -> create OK (uncapped)
 *   - pro at 5000 objects           -> create OK (uncapped)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";
import type { OntologyClusterRow, OntologyObjectRow } from "./dto";

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

vi.mock("./repository", () => ({
  findClusterById: vi.fn(),
  insertObject: vi.fn(),
  countMembershipSiblings: vi.fn(),
  insertMembership: vi.fn(),
  updateCluster: vi.fn(),
  cascadeSoftDeleteCluster: vi.fn(),
  cascadeRestoreCluster: vi.fn(),
  listTrashedClusters: vi.fn(),
  cascadePurgeCluster: vi.fn(),
}));

import * as billingRepo from "@/features/billing/server/workspace-billing";
import * as repo from "./repository";
import {
  createObject,
  deleteCluster,
  listTrashedClusters,
  purgeCluster,
  restoreCluster,
  updateCluster,
} from "./service";
import { EntitlementError } from "@/features/billing/server/entitlements";

const mockBilling = vi.mocked(billingRepo);
const mockRepo = vi.mocked(repo);

const WS = "ws-1";
const CTX = { workspaceId: WS, userId: "user-1" };
const CLUSTER_ID = "11111111-1111-4111-8111-111111111111";

const CLUSTER_ROW: OntologyClusterRow = {
  id: CLUSTER_ID,
  workspace_id: WS,
  slug: "sales",
  name: "Sales",
  purpose: "",
  layout: {},
  position: 0,
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

function billing(overrides: Partial<WorkspaceBillingRow>): WorkspaceBillingRow {
  return {
    workspaceId: WS,
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodEnd: "2026-08-01T00:00:00Z",
    lastStripeEventCreated: null,
    ...overrides,
  };
}

function setEntitlements(opts: {
  billing: WorkspaceBillingRow | null;
  members: number;
  objects: number;
}) {
  mockBilling.getWorkspaceBilling.mockResolvedValue(opts.billing);
  mockBilling.countActiveMembers.mockResolvedValue(opts.members);
  mockBilling.countOntologyObjects.mockResolvedValue(opts.objects);
}

function primeRepoForCreate() {
  mockRepo.findClusterById.mockResolvedValue(CLUSTER_ROW);
  mockRepo.insertObject.mockResolvedValue(OBJECT_ROW);
  mockRepo.countMembershipSiblings.mockResolvedValue(0);
  mockRepo.insertMembership.mockResolvedValue({
    id: "mem-1",
    workspace_id: WS,
    cluster_id: CLUSTER_ID,
    parent_object_id: null,
    child_object_id: OBJECT_ROW.id,
    position: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  primeRepoForCreate();
});

describe("createObject — free-plan object cap", () => {
  it("free 2-member workspace at 50 objects allows the create", async () => {
    setEntitlements({ billing: null, members: 2, objects: 50 });
    const object = await createObject(CTX, { clusterId: CLUSTER_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });

  it("free 2-member workspace AT the cap (100) throws EntitlementError and never writes", async () => {
    setEntitlements({ billing: null, members: 2, objects: 100 });
    await expect(
      createObject(CTX, { clusterId: CLUSTER_ID, name: "Sales Rep" })
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(mockRepo.insertObject).not.toHaveBeenCalled();
  });

  it("carries over_free_cap + workspaceId on the thrown error", async () => {
    setEntitlements({ billing: null, members: 2, objects: 100 });
    await createObject(CTX, { clusterId: CLUSTER_ID, name: "Sales Rep" }).catch(
      (err) => {
        expect((err as EntitlementError).code).toBe("over_free_cap");
        expect((err as EntitlementError).workspaceId).toBe(WS);
      }
    );
  });

  it("solo free workspace at 5000 objects is uncapped — create OK", async () => {
    setEntitlements({ billing: null, members: 1, objects: 5000 });
    const object = await createObject(CTX, { clusterId: CLUSTER_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });

  it("pro workspace at 5000 objects is uncapped — create OK", async () => {
    setEntitlements({
      billing: billing({ plan: "team", status: "active" }),
      members: 8,
      objects: 5000,
    });
    const object = await createObject(CTX, { clusterId: CLUSTER_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });
});

describe("updateCluster — layout round-trip", () => {
  it("forwards a layout patch to the repository and maps it back onto the domain cluster", async () => {
    const layout = { "obj-1": { x: 40, y: 80 }, "obj-2": { x: 320, y: 0 } };
    mockRepo.updateCluster.mockResolvedValue({ ...CLUSTER_ROW, layout });

    const cluster = await updateCluster(CTX, CLUSTER_ID, { layout });

    expect(mockRepo.updateCluster).toHaveBeenCalledWith(WS, CLUSTER_ID, { layout });
    expect(cluster.layout).toEqual(layout);
  });

  it("defaults a null stored layout to an empty map", async () => {
    mockRepo.updateCluster.mockResolvedValue({ ...CLUSTER_ROW, layout: null });
    const cluster = await updateCluster(CTX, CLUSTER_ID, { name: "Renamed" });
    expect(cluster.layout).toEqual({});
  });

  it("throws NotFound when the cluster is missing", async () => {
    mockRepo.updateCluster.mockResolvedValue(null);
    await expect(updateCluster(CTX, CLUSTER_ID, { name: "X" })).rejects.toThrow();
  });
});

// ── Cascade soft-delete + restore (reverses F-13's detach) ───────────
//
// deleteCluster and restoreCluster now delegate the cascade to a SINGLE
// atomic RPC each (`cascadeSoftDeleteCluster` / `cascadeRestoreCluster`),
// which stamps/clears the cluster AND every object it owns in one
// transaction. The object collection + shared-timestamp + re-slug logic
// lives in SQL (migration 20260718000040), so these service tests drive the
// thin wiring: the 404 pre-check, the single RPC call (structurally proving
// the old two-write desync is gone), the returned count, and row mapping.

describe("deleteCluster — atomic cascade soft-delete", () => {
  it("delegates to the single cascade RPC and returns its object count", async () => {
    mockRepo.findClusterById.mockResolvedValue(CLUSTER_ROW);
    mockRepo.cascadeSoftDeleteCluster.mockResolvedValue(3);

    const count = await deleteCluster(CTX, CLUSTER_ID);

    expect(count).toBe(3);
    // ONE write path — there is no second write to desync against.
    expect(mockRepo.cascadeSoftDeleteCluster).toHaveBeenCalledTimes(1);
    expect(mockRepo.cascadeSoftDeleteCluster).toHaveBeenCalledWith(WS, CLUSTER_ID);
  });

  it("throws NotFound when the cluster does not exist (never cascades)", async () => {
    mockRepo.findClusterById.mockResolvedValue(null);
    await expect(deleteCluster(CTX, CLUSTER_ID)).rejects.toThrow();
    expect(mockRepo.cascadeSoftDeleteCluster).not.toHaveBeenCalled();
  });

  // Failure-path — previously untested. The whole cascade is one atomic RPC,
  // so a throw rolls the transaction back and leaves NOTHING half-written:
  // objects can't be trashed while the cluster stays live (the old bug). The
  // service surfaces the error and, structurally, there is no second write to
  // leave the two out of sync.
  it("surfaces an RPC failure with no half-write (atomic)", async () => {
    mockRepo.findClusterById.mockResolvedValue(CLUSTER_ROW);
    mockRepo.cascadeSoftDeleteCluster.mockRejectedValue(new Error("db down"));

    await expect(deleteCluster(CTX, CLUSTER_ID)).rejects.toThrow("db down");
    // The single RPC is the only write — one call, all-or-nothing.
    expect(mockRepo.cascadeSoftDeleteCluster).toHaveBeenCalledTimes(1);
  });
});

describe("restoreCluster — atomic cascade restore", () => {
  const RESTORED: OntologyClusterRow = { ...CLUSTER_ROW, deleted_at: null };

  it("delegates to the single cascade RPC and maps the restored row", async () => {
    mockRepo.cascadeRestoreCluster.mockResolvedValue(RESTORED);

    const cluster = await restoreCluster(CTX, CLUSTER_ID);

    expect(mockRepo.cascadeRestoreCluster).toHaveBeenCalledTimes(1);
    expect(mockRepo.cascadeRestoreCluster).toHaveBeenCalledWith(WS, CLUSTER_ID);
    expect(cluster.id).toBe(CLUSTER_ID);
    expect(cluster.slug).toBe("sales");
  });

  it("passes a slug ref straight through to the RPC (server resolves the tombstone)", async () => {
    mockRepo.cascadeRestoreCluster.mockResolvedValue(RESTORED);
    await restoreCluster(CTX, "sales");
    expect(mockRepo.cascadeRestoreCluster).toHaveBeenCalledWith(WS, "sales");
  });

  it("throws NotFound when no trashed cluster matches", async () => {
    mockRepo.cascadeRestoreCluster.mockResolvedValue(null);
    await expect(restoreCluster(CTX, CLUSTER_ID)).rejects.toThrow();
  });

  it("surfaces an RPC failure with no half-write (atomic)", async () => {
    mockRepo.cascadeRestoreCluster.mockRejectedValue(new Error("db down"));
    await expect(restoreCluster(CTX, CLUSTER_ID)).rejects.toThrow("db down");
    expect(mockRepo.cascadeRestoreCluster).toHaveBeenCalledTimes(1);
  });
});

// ── Trash view: list trashed clusters ────────────────────────────────
//
// The repository does the `deleted_at IS NOT NULL` filter, ordering, and
// cheap cascade-object count (in SQL); the service maps each trashed row to
// the shared trash-entry shape. These tests drive that mapping and the
// empty-trash case.

describe("listTrashedClusters — trash view mapping", () => {
  const TRASHED: OntologyClusterRow = {
    ...CLUSTER_ROW,
    deleted_at: "2026-02-01T00:00:00Z",
  };

  it("maps only the repo's trashed rows to the summary shape", async () => {
    mockRepo.listTrashedClusters.mockResolvedValue([
      { cluster: TRASHED, objectCount: 4 },
    ]);

    const trash = await listTrashedClusters(CTX);

    expect(mockRepo.listTrashedClusters).toHaveBeenCalledWith(WS);
    expect(trash).toEqual([
      {
        kind: "ontology_cluster",
        id: CLUSTER_ID,
        name: "Sales",
        deletedAt: "2026-02-01T00:00:00Z",
        objectCount: 4,
      },
    ]);
  });

  it("returns an empty list when the trash is empty", async () => {
    mockRepo.listTrashedClusters.mockResolvedValue([]);
    await expect(listTrashedClusters(CTX)).resolves.toEqual([]);
  });
});

// ── Trash view: permanent purge ──────────────────────────────────────
//
// purgeCluster delegates the whole hard-delete to a SINGLE atomic RPC
// (`cascadePurgeCluster`) that deletes the cluster AND its cascade-trashed
// objects in one transaction. These tests drive the thin wiring: the single
// RPC call, the returned object count, and the null→404 mapping (mirrors
// restore) when the ref matches no trashed cluster.

describe("purgeCluster — atomic permanent purge", () => {
  it("delegates to the single purge RPC and returns its object count", async () => {
    mockRepo.cascadePurgeCluster.mockResolvedValue(3);

    const count = await purgeCluster(CTX, CLUSTER_ID);

    expect(count).toBe(3);
    // ONE write path — the hard delete is all-or-nothing in the RPC.
    expect(mockRepo.cascadePurgeCluster).toHaveBeenCalledTimes(1);
    expect(mockRepo.cascadePurgeCluster).toHaveBeenCalledWith(WS, CLUSTER_ID);
  });

  it("passes a slug ref straight through to the RPC (server resolves the tombstone)", async () => {
    mockRepo.cascadePurgeCluster.mockResolvedValue(0);
    await purgeCluster(CTX, "sales");
    expect(mockRepo.cascadePurgeCluster).toHaveBeenCalledWith(WS, "sales");
  });

  it("throws NotFound when no trashed cluster matches the ref", async () => {
    mockRepo.cascadePurgeCluster.mockResolvedValue(null);
    await expect(purgeCluster(CTX, CLUSTER_ID)).rejects.toThrow();
  });

  it("surfaces an RPC failure with no half-write (atomic)", async () => {
    mockRepo.cascadePurgeCluster.mockRejectedValue(new Error("db down"));
    await expect(purgeCluster(CTX, CLUSTER_ID)).rejects.toThrow("db down");
    expect(mockRepo.cascadePurgeCluster).toHaveBeenCalledTimes(1);
  });
});
