/**
 * INVARIANT SUITE — ontology object-cap enforcement (freeze-don't-delete).
 * Drives the real gate (createObject → assertCanCreateObject →
 * getWorkspaceEntitlements) with billing counts + repository mocked, so the
 * plan/member/object matrix decides the outcome.
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
  cascadeHardDeleteCluster: vi.fn(),
  findObjectById: vi.fn(),
  hardDeleteObject: vi.fn(),
}));

import * as billingRepo from "@/features/billing/server/workspace-billing";
import * as repo from "./repository";
import {
  createObject,
  deleteCluster,
  deleteObject,
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
    currentPeriodStart: "2026-07-01T00:00:00Z",
    currentPeriodEnd: "2026-08-01T00:00:00Z",
    cancelAtPeriodEnd: false,
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

// ── Cascade HARD delete ─────────────────────────────────────────────
// Deleting is PERMANENT and IMMEDIATE — no trash, restore or purge.
// ⚠ `deleteCluster` must stay ONE atomic RPC (`cascadeHardDeleteCluster`,
// migration 20260807120000); composing two writes re-opens a desync that
// leaves objects hard-gone under a surviving tombstone. Pins the RPC call, the
// object count, and the null→404 mapping.

describe("deleteCluster — atomic cascade HARD delete", () => {
  it("delegates to the single cascade RPC and returns its object count", async () => {
    mockRepo.cascadeHardDeleteCluster.mockResolvedValue(3);

    const count = await deleteCluster(CTX, CLUSTER_ID);

    expect(count).toBe(3);
    expect(mockRepo.cascadeHardDeleteCluster).toHaveBeenCalledTimes(1);
    expect(mockRepo.cascadeHardDeleteCluster).toHaveBeenCalledWith(WS, CLUSTER_ID);
  });

  it("deletes a cluster that owns zero objects (count 0 is not 'not found')", async () => {
    mockRepo.cascadeHardDeleteCluster.mockResolvedValue(0);
    await expect(deleteCluster(CTX, CLUSTER_ID)).resolves.toBe(0);
  });

  it("throws NotFound when the RPC matched no live cluster", async () => {
    // null (not 0) = RPC's "nothing matched"; distinguishes missing from
    // empty.
    mockRepo.cascadeHardDeleteCluster.mockResolvedValue(null);
    await expect(deleteCluster(CTX, CLUSTER_ID)).rejects.toThrow();
  });

  it("surfaces an RPC failure with no half-write (atomic)", async () => {
    mockRepo.cascadeHardDeleteCluster.mockRejectedValue(new Error("db down"));

    await expect(deleteCluster(CTX, CLUSTER_ID)).rejects.toThrow("db down");
    expect(mockRepo.cascadeHardDeleteCluster).toHaveBeenCalledTimes(1);
  });
});

describe("deleteObject — permanent delete", () => {
  const OBJECT_ID = "22222222-2222-4222-8222-222222222222";

  it("HARD-deletes the object — no tombstone write", async () => {
    mockRepo.findObjectById.mockResolvedValue({
      id: OBJECT_ID,
      workspace_id: WS,
    } as OntologyObjectRow);
    mockRepo.hardDeleteObject.mockResolvedValue(undefined);

    await deleteObject(CTX, OBJECT_ID);

    expect(mockRepo.hardDeleteObject).toHaveBeenCalledWith(WS, OBJECT_ID);
  });

  it("throws NotFound for an unknown or cross-workspace object (no delete)", async () => {
    mockRepo.findObjectById.mockResolvedValue(null);

    await expect(deleteObject(CTX, OBJECT_ID)).rejects.toThrow();
    expect(mockRepo.hardDeleteObject).not.toHaveBeenCalled();
  });
});
