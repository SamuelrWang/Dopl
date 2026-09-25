/**
 * Invariant suite — a GUEST of a home channel, end to end (Samuel's
 * home-ontology ruling, 2026-09-09; closes F-685).
 *
 * `guests_level` was stored, read by SQL, picked by the audience and written by
 * the share dialog, and no guest request could reach an ontology route: every
 * one sat at `withWorkspaceAuth`'s `viewer` default while a home channel's peer
 * is admitted at the role the LINK grants, which defaults to `guest`. Six floors
 * moved (`app/api/channels/guest-route-floor.test.ts › GUEST_ALLOWED`), and this
 * file is the behavioural half: the floor lets a guest be REFUSED; the
 * AUDIENCE is what refuses them.
 *
 * Both halves are required and neither is the other: the census reads route
 * SOURCE and cannot tell what the service does; this drives the real
 * `service.ts` against a mocked repository and cannot tell what floor the route
 * carries. The last describe is the seam — what a guest must NEVER reach,
 * asserted as a floor, because there is no service call to make when the
 * request is rejected two layers up.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OntologyRow, OntologyObjectRow } from "./dto";
import type { OntologyLevel } from "../types";
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
  countSharesForOntologies: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("./repository-projections", () => ({
  listOntologySlugs: vi.fn(async () => []),
  listOntologySummaries: vi.fn(async () => []),
  listMembershipParents: vi.fn(async () => []),
  listRelationshipsForSource: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/home-space-reach", () => ({
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

vi.mock("@/features/billing/server/entitlements", () => ({
  assertCanCreateObject: vi.fn(async () => undefined),
}));

vi.mock("./repository", () => ({
  listOntologies: vi.fn(async () => []),
  listMemberships: vi.fn(async () => []),
  listObjectsByIds: vi.fn(async () => []),
  listRelationshipsForSources: vi.fn(async () => []),
  findOntologyById: vi.fn(),
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
import * as narrowRepo from "./repository-projections";
import * as shareRepo from "./repository-shares";
import { createObject, deleteObject, getSnapshot, updateObject } from "./service";
import { getReach } from "./service-reach";
import { workspaceFloor } from "@/shared/auth/route-floor-parser";

const mockRepo = vi.mocked(repo);
const mockNarrow = vi.mocked(narrowRepo);
const mockShareRepo = vi.mocked(shareRepo);

/** The LINK container the guest stands in — never the ontology's. */
const LINK = "ws-link";
/** The OWNER's home shelf, where the lent ontology actually lives. */
const OWNER_WS = "ws-owner";
const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const OWNER = "user-owner";
const GUEST = "user-guest";

const ONTOLOGY_ROW: OntologyRow = {
  id: ONTOLOGY_ID,
  workspace_id: OWNER_WS,
  slug: "sales",
  name: "Sales",
  purpose: "",
  layout: {},
  position: 0,
  created_by: OWNER,
  agents_may_edit: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const OBJECT_ROW: OntologyObjectRow = {
  id: OBJECT_ID,
  workspace_id: OWNER_WS,
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

const MEMBERSHIP = {
  id: "m-1",
  workspace_id: OWNER_WS,
  ontology_id: ONTOLOGY_ID,
  parent_object_id: null,
  child_object_id: OBJECT_ID,
  position: 0,
};

/** A GUEST of the home channel. */
const guest = ontologyContextFactory({
  workspaceId: LINK,
  userId: GUEST,
  role: "guest",
  credentialSubjectUserId: GUEST,
});

/**
 * One share row for the lent ontology. `members_level` is `edit` in EVERY case
 * below, so a case that passes because the wrong COLUMN was read is impossible:
 * a guest reading `members_level` would be `edit` throughout.
 */
function primeShare(guests: OntologyLevel | null) {
  mockShareRepo.findWorkspaceKind.mockResolvedValue("link");
  mockShareRepo.countActiveWorkspaceMembers.mockResolvedValue(2);
  mockShareRepo.listChannelIdsForWorkspace.mockResolvedValue(["ch-1"]);
  mockShareRepo.listSharesForChannels.mockResolvedValue(
    guests === null
      ? []
      : [
          {
            ontology_id: ONTOLOGY_ID,
            channel_id: "ch-1",
            workspace_id: OWNER_WS,
            members_level: "edit",
            guests_level: guests,
            owner_agents_level: "edit",
          },
        ]
  );
  mockRepo.listOntologies.mockResolvedValue([ONTOLOGY_ROW]);
  mockRepo.listMemberships.mockResolvedValue([MEMBERSHIP]);
  // Honours the ids it is given: a mock that answers the same row whatever it
  // is asked cannot tell "the walk found nothing" from "the walk found it and
  // the filter missed", which is exactly the case below.
  mockRepo.listObjectsByIds.mockImplementation(async (_ws, ids) =>
    ids.includes(OBJECT_ID) ? [OBJECT_ROW] : []
  );
  mockRepo.listRelationshipsForSources.mockResolvedValue([]);
  mockRepo.findOntologyById.mockResolvedValue(ONTOLOGY_ROW);
  mockRepo.findObjectById.mockResolvedValue(OBJECT_ROW);
  mockNarrow.listMembershipParents.mockResolvedValue([
    { ontology_id: ONTOLOGY_ID, parent_object_id: null, child_object_id: OBJECT_ID },
  ] as never);
  mockNarrow.listOntologySummaries.mockResolvedValue([
    {
      id: ONTOLOGY_ID,
      workspace_id: OWNER_WS,
      slug: "sales",
      name: "Sales",
      purpose: "",
      created_by: OWNER,
      agents_may_edit: true,
    },
  ]);
  mockRepo.insertObject.mockResolvedValue({ ...OBJECT_ROW, id: "obj-new" });
  mockRepo.updateObject.mockResolvedValue({ ...OBJECT_ROW, name: "Renamed" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a guest at `view` — reads the lent ontology, writes NOTHING", () => {
  it("reads the snapshot", async () => {
    primeShare("view");
    const snap = await getSnapshot(guest());
    expect(snap.ontologies.map((c) => c.id)).toEqual([ONTOLOGY_ID]);
    expect(Object.keys(snap.objects)).toEqual([OBJECT_ID]);
  });

  it("🔒 is REFUSED a write, 404-shaped — the audience is the fence, not the floor", async () => {
    primeShare("view");
    await expect(updateObject(guest(), OBJECT_ID, { name: "x" })).rejects.toMatchObject({
      status: 404,
    });
    expect(mockRepo.updateObject).not.toHaveBeenCalled();
  });

  it("🔒 …and a CREATE inside that ontology is refused the same way", async () => {
    primeShare("view");
    await expect(
      createObject(guest(), { ontologyId: ONTOLOGY_ID, name: "New column" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockRepo.insertObject).not.toHaveBeenCalled();
  });

  it("the reach read names it at VIEW (what the desktop framing is told)", async () => {
    primeShare("view");
    expect(await getReach(guest())).toEqual([
      { id: ONTOLOGY_ID, name: "Sales", workspaceId: OWNER_WS, level: "view" },
    ]);
  });
});

describe("a guest at `edit` — the half of the ruling that was a stored word", () => {
  it("writes an object", async () => {
    primeShare("edit");
    await expect(updateObject(guest(), OBJECT_ID, { name: "Renamed" })).resolves.toMatchObject(
      { name: "Renamed" }
    );
    expect(mockRepo.updateObject).toHaveBeenCalled();
  });

  it("creates one (a MEMBERSHIP write, into the LENDER's container)", async () => {
    primeShare("edit");
    await createObject(guest(), { ontologyId: ONTOLOGY_ID, name: "New column" });
    expect(mockRepo.insertObject).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: OWNER_WS, createdBy: GUEST })
    );
    expect(mockRepo.insertMembership).toHaveBeenCalledWith(
      expect.objectContaining({ ontologyId: ONTOLOGY_ID, workspaceId: OWNER_WS })
    );
  });

  it("the reach read names it at EDIT", async () => {
    primeShare("edit");
    expect((await getReach(guest()))[0]).toMatchObject({ level: "edit" });
  });

  it("a guest's AGENT inherits EXACTLY that and no more (I1 / Q1)", async () => {
    primeShare("edit");
    expect((await getReach(guest({ source: "agent" })))[0]).toMatchObject({ level: "edit" });
    primeShare("view");
    await expect(
      updateObject(guest({ source: "agent" }), OBJECT_ID, { name: "x" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("a guest at `none`, and a guest with NO share row — the same nothing (I4)", () => {
  for (const [label, level] of [
    ["a stored `none`", "none" as OntologyLevel],
    ["no share row at all", null],
  ] as const) {
    it(`${label}: the snapshot is EMPTY and no object is even asked for`, async () => {
      primeShare(level);
      const snap = await getSnapshot(guest());
      expect(snap.ontologies).toEqual([]);
      expect(snap.objects).toEqual({});
      expect(mockRepo.listObjectsByIds).toHaveBeenCalledWith(expect.anything(), []);
    });

    it(`${label}: every write is 404, and so is the reach read's answer`, async () => {
      primeShare(level);
      await expect(updateObject(guest(), OBJECT_ID, { name: "x" })).rejects.toMatchObject({
        status: 404,
      });
      primeShare(level);
      await expect(deleteObject(guest(), OBJECT_ID)).rejects.toMatchObject({ status: 404 });
      primeShare(level);
      expect(await getReach(guest())).toEqual([]);
    });
  }
});

/**
 * What a guest must never reach, and why it is asserted as a floor: there is
 * no service call to drive — `withWorkspaceAuth` rejects the request before the
 * handler runs, so the only observable fact is the floor itself. Set B of
 * `app/api/channels/guest-route-floor.test.ts` proves nothing ELSE in the tree
 * drifted to `guest`; this states the two that matter for THIS feature
 * positively, beside the behaviour they bound.
 */
describe("the two lanes a guest may never reach", () => {
  const API = join(import.meta.dirname, "..", "..", "..", "app", "api");
  const floorOf = (rel: string, method: string) =>
    workspaceFloor(readFileSync(join(API, rel), "utf8"), method);

  it("THE SHARE LANE — a guest lends no ontology and re-levels nobody's share", () => {
    const rel = "ontology/ontologies/[ontologyId]/shares/route.ts";
    expect(floorOf(rel, "GET")).toBe("member");
    expect(floorOf(rel, "PUT")).toBe("member");
    expect(floorOf(rel, "DELETE")).toBe("member");
  });

  it("THE AGENTS TOGGLE — `agentsMayEdit` rides the ontology PATCH, which stays `member`", () => {
    // The toggle is a CONTAINMENT control on the OWNER's own agents
    // (`schema.ts › OntologyUpdateSchema.agentsMayEdit`). A guest cannot
    // rename an ontology either; both facts are this one floor.
    expect(floorOf("ontology/ontologies/[ontologyId]/route.ts", "PATCH")).toBe("member");
    expect(floorOf("ontology/ontologies/[ontologyId]/route.ts", "DELETE")).toBe("member");
    expect(floorOf("ontology/ontologies/route.ts", "POST")).toBe("member");
  });
});
