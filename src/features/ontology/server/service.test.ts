/**
 * INVARIANT SUITE — ontology object-cap enforcement (freeze-don't-delete).
 * Drives the real gate (createObject → assertCanCreateObject →
 * getWorkspaceEntitlements) with billing counts + repository mocked, so the
 * plan/member/object matrix decides the outcome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";
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

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

// The AUDIENCE is driven through its OWN repository rather than stubbed: a
// standard workspace answers `unrestricted`, which is this suite's subject.
// The home-container arms are `service-audience.test.ts` and the block below.
vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(async () => "standard"),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => []),
  listSharesForChannels: vi.fn(async () => []),
}));

vi.mock("./repository-projections", () => ({
  listOntologySlugs: vi.fn(async () => []),
  listMembershipParents: vi.fn(async () => []),
  listRelationshipsForSource: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  personalShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("./repository", () => ({
  listOntologies: vi.fn(),
  listMemberships: vi.fn(),
  listObjectsByIds: vi.fn(),
  listRelationshipsForSources: vi.fn(),
  insertOntology: vi.fn(),
  updateObject: vi.fn(),
  findOntologyById: vi.fn(),
  insertObject: vi.fn(),
  countMembershipSiblings: vi.fn(),
  insertMembership: vi.fn(),
  updateOntology: vi.fn(),
  cascadeHardDeleteOntology: vi.fn(),
  findObjectById: vi.fn(),
  hardDeleteObject: vi.fn(),
}));

import * as billingRepo from "@/features/billing/server/workspace-billing";
import * as repo from "./repository";
import {
  createObject,
  deleteOntology,
  deleteObject,
  updateOntology,
} from "./service";
import { EntitlementError } from "@/features/billing/server/entitlements";

const mockBilling = vi.mocked(billingRepo);
const mockRepo = vi.mocked(repo);

const WS = "ws-1";
const CTX = ontologyContextFactory({ workspaceId: WS })();
const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";

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
  mockRepo.findOntologyById.mockResolvedValue(ONTOLOGY_ROW);
  mockRepo.insertObject.mockResolvedValue(OBJECT_ROW);
  mockRepo.countMembershipSiblings.mockResolvedValue(0);
  mockRepo.insertMembership.mockResolvedValue({
    id: "mem-1",
    workspace_id: WS,
    ontology_id: ONTOLOGY_ID,
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
    const object = await createObject(CTX, { ontologyId: ONTOLOGY_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });

  it("free 2-member workspace AT the cap (100) throws EntitlementError and never writes", async () => {
    setEntitlements({ billing: null, members: 2, objects: 100 });
    await expect(
      createObject(CTX, { ontologyId: ONTOLOGY_ID, name: "Sales Rep" })
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(mockRepo.insertObject).not.toHaveBeenCalled();
  });

  it("carries over_free_cap + workspaceId on the thrown error", async () => {
    setEntitlements({ billing: null, members: 2, objects: 100 });
    await createObject(CTX, { ontologyId: ONTOLOGY_ID, name: "Sales Rep" }).catch(
      (err) => {
        expect((err as EntitlementError).code).toBe("over_free_cap");
        expect((err as EntitlementError).workspaceId).toBe(WS);
      }
    );
  });

  it("solo free workspace at 5000 objects is uncapped — create OK", async () => {
    setEntitlements({ billing: null, members: 1, objects: 5000 });
    const object = await createObject(CTX, { ontologyId: ONTOLOGY_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });

  it("pro workspace at 5000 objects is uncapped — create OK", async () => {
    setEntitlements({
      billing: billing({ plan: "team", status: "active" }),
      members: 8,
      objects: 5000,
    });
    const object = await createObject(CTX, { ontologyId: ONTOLOGY_ID, name: "Sales Rep" });
    expect(object.id).toBe("obj-1");
    expect(mockRepo.insertObject).toHaveBeenCalledTimes(1);
  });
});

describe("updateOntology — layout round-trip", () => {
  it("forwards a layout patch to the repository and maps it back onto the domain ontology", async () => {
    const layout = { "obj-1": { x: 40, y: 80 }, "obj-2": { x: 320, y: 0 } };
    mockRepo.updateOntology.mockResolvedValue({ ...ONTOLOGY_ROW, layout });

    const ontology = await updateOntology(CTX, ONTOLOGY_ID, { layout });

    expect(mockRepo.updateOntology).toHaveBeenCalledWith(WS, ONTOLOGY_ID, { layout }, {
      userId: "user-1",
      source: "user",
    });
    expect(ontology.layout).toEqual(layout);
  });

  it("defaults a null stored layout to an empty map", async () => {
    mockRepo.updateOntology.mockResolvedValue({ ...ONTOLOGY_ROW, layout: null });
    const ontology = await updateOntology(CTX, ONTOLOGY_ID, { name: "Renamed" });
    expect(ontology.layout).toEqual({});
  });

  it("throws NotFound when the ontology is missing", async () => {
    mockRepo.updateOntology.mockResolvedValue(null);
    await expect(updateOntology(CTX, ONTOLOGY_ID, { name: "X" })).rejects.toThrow();
  });
});

// ── Cascade HARD delete ─────────────────────────────────────────────
// Deleting is PERMANENT and IMMEDIATE — no trash, restore or purge.
// `deleteOntology` must stay ONE atomic RPC (`cascadeHardDeleteOntology`,
// migration 20260807120000); composing two writes re-opens a desync that
// leaves objects hard-gone under a surviving tombstone. Pins the RPC call, the
// object count, and the null→404 mapping.

describe("deleteOntology — atomic cascade HARD delete", () => {
  it("delegates to the single cascade RPC and returns its object count", async () => {
    mockRepo.cascadeHardDeleteOntology.mockResolvedValue(3);

    const count = await deleteOntology(CTX, ONTOLOGY_ID);

    expect(count).toBe(3);
    expect(mockRepo.cascadeHardDeleteOntology).toHaveBeenCalledTimes(1);
    expect(mockRepo.cascadeHardDeleteOntology).toHaveBeenCalledWith(WS, ONTOLOGY_ID);
  });

  it("deletes an ontology that owns zero objects (count 0 is not 'not found')", async () => {
    mockRepo.cascadeHardDeleteOntology.mockResolvedValue(0);
    await expect(deleteOntology(CTX, ONTOLOGY_ID)).resolves.toBe(0);
  });

  it("throws NotFound when the RPC matched no live ontology", async () => {
    // null (not 0) = RPC's "nothing matched"; distinguishes missing from
    // empty.
    mockRepo.cascadeHardDeleteOntology.mockResolvedValue(null);
    await expect(deleteOntology(CTX, ONTOLOGY_ID)).rejects.toThrow();
  });

  it("surfaces an RPC failure with no half-write (atomic)", async () => {
    mockRepo.cascadeHardDeleteOntology.mockRejectedValue(new Error("db down"));

    await expect(deleteOntology(CTX, ONTOLOGY_ID)).rejects.toThrow("db down");
    expect(mockRepo.cascadeHardDeleteOntology).toHaveBeenCalledTimes(1);
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
