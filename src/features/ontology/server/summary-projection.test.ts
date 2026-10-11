/**
 * Invariant suite — the ontology SUMMARY projection. `getSummary` only stays
 * the answer while these hold:
 *
 *   1. NO JSONB LEAVES — absent, not "empty arrays". A reused `mapObjectRow`
 *      or a `...row` spread puts hundreds of KB back on the hot path silently.
 *   2. STRUCTURE IDENTICAL to `getSnapshot`'s — `columnIds`/`childIds` must
 *      assemble the same way, so a map render swaps projections unchanged.
 *   3. THE RELATIONSHIPS TABLE IS NEVER READ — it grows with the square of the
 *      graph and no map-shaped render draws it.
 *   4. A CLIPPED READ SAYS SO — the row ceilings are only defensible while
 *      truncated is distinguishable from exhausted, and the only layer that can
 *      tell them apart is the page walk itself (`prime`'s note, Samuel #2935).
 *
 * Repository layers mocked: the projection is what's under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  OntologyListItemRow,
  OntologyMembershipRow,
  OntologyObjectSummaryRow,
} from "./dto";
import { ONTOLOGY_READ_LIMITS } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";

vi.mock("./repository", () => ({
  listMemberships: vi.fn(),
  listRelationshipsForSources: vi.fn(),
}));

vi.mock("./repository-projections", () => ({
  listOntologySummaries: vi.fn(),
  listObjectSummariesByIds: vi.fn(),
}));

// The AUDIENCE is mocked at its own repository, not stubbed out: a standard
// workspace answers `unrestricted`, which is this suite's subject (the
// projection) with the ceiling in its today's-behaviour arm.
vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(async () => "standard"),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => []),
  listSharesForChannels: vi.fn(async () => []),
}));

import * as repo from "./repository";
import * as narrow from "./repository-projections";
import { getSummary } from "./service";

const mockRepo = vi.mocked(repo);
const mockNarrow = vi.mocked(narrow);

const CTX = ontologyContextFactory()();
const ONTOLOGY = "c-1";
const COLUMN = "o-col";
const CARD = "o-card";

const ONTOLOGY_ROW: OntologyListItemRow = {
  id: ONTOLOGY,
  workspace_id: "ws-1",
  slug: "playbook",
  name: "Dopl Playbook",
  purpose: "How this workspace is meant to be used.",
  created_by: "user-1",
  agents_may_edit: true,
};

const OBJECT_ROWS: OntologyObjectSummaryRow[] = [
  { id: COLUMN, name: "Surfaces", subtitle: "What the workspace is made of" },
  { id: CARD, name: "Knowledge", subtitle: "Durable reference" },
];

const MEMBERSHIPS: OntologyMembershipRow[] = [
  {
    id: "m-1",
    workspace_id: "ws-1",
    ontology_id: ONTOLOGY,
    parent_object_id: null,
    child_object_id: COLUMN,
    position: 0,
  },
  {
    id: "m-2",
    workspace_id: "ws-1",
    ontology_id: null,
    parent_object_id: COLUMN,
    child_object_id: CARD,
    position: 0,
  },
];

/**
 * ⚠ **`truncated` IS PRIMED, NOT DERIVED FROM THE FIXTURE'S LENGTH** (Samuel
 * #2935). Each read is a `readAllPages` walk now and REPORTS whether it stopped
 * on a short page or on its `ONTOLOGY_READ_LIMITS` `hardCap`;
 * `service-reads.ts › getSummary` only ORs those answers together. Comparing a
 * row count against the asked limit is the bug this suite's invariant 4 now
 * guards against — `max_rows` answered 1,000 rows to a limit of 5,000, so
 * `1000 >= 5000` was false and a clipped map called itself complete.
 */
function prime(over: {
  ontologies?: OntologyListItemRow[];
  objects?: OntologyObjectSummaryRow[];
  memberships?: OntologyMembershipRow[];
  ontologiesTruncated?: boolean;
  objectsTruncated?: boolean;
  membershipsTruncated?: boolean;
} = {}) {
  mockNarrow.listOntologySummaries.mockResolvedValue({
    rows: over.ontologies ?? [ONTOLOGY_ROW],
    truncated: over.ontologiesTruncated ?? false,
  });
  mockNarrow.listObjectSummariesByIds.mockResolvedValue({
    rows: over.objects ?? OBJECT_ROWS,
    truncated: over.objectsTruncated ?? false,
  });
  mockRepo.listMemberships.mockResolvedValue({
    rows: over.memberships ?? MEMBERSHIPS,
    truncated: over.membershipsTruncated ?? false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("getSummary — what does NOT cross the wire", () => {
  it("ships no attributes, methods or template on any object", async () => {
    const summary = await getSummary(CTX);
    for (const object of Object.values(summary.objects)) {
      // `not.toHaveProperty`, not `toEqual([])`: an empty array claims the
      // object HAS none — a different, wrong statement.
      expect(object).not.toHaveProperty("attributes");
      expect(object).not.toHaveProperty("methods");
      expect(object).not.toHaveProperty("template");
      expect(object).not.toHaveProperty("relationships");
      expect(Object.keys(object).sort()).toEqual(["childIds", "id", "name", "subtitle"]);
    }
  });

  it("ships no ontology layout", async () => {
    const summary = await getSummary(CTX);
    for (const ontology of summary.ontologies) {
      expect(ontology).not.toHaveProperty("layout");
      expect(Object.keys(ontology).sort()).toEqual([
        "columnIds",
        "id",
        "name",
        "purpose",
        "slug",
      ]);
    }
  });

  it("never reads the relationships table — three round trips, not four", async () => {
    await getSummary(CTX);
    expect(mockRepo.listRelationshipsForSources).not.toHaveBeenCalled();
    expect(mockNarrow.listOntologySummaries).toHaveBeenCalledTimes(1);
    expect(mockNarrow.listObjectSummariesByIds).toHaveBeenCalledTimes(1);
    expect(mockRepo.listMemberships).toHaveBeenCalledTimes(1);
  });
});

describe("getSummary — the structure a map-shaped render walks", () => {
  it("assembles columnIds and childIds exactly as getSnapshot does", async () => {
    const summary = await getSummary(CTX);
    expect(summary.ontologies[0].columnIds).toEqual([COLUMN]);
    expect(summary.objects[COLUMN].childIds).toEqual([CARD]);
    expect(summary.objects[CARD].childIds).toEqual([]);
  });

  it("drops memberships pointing at an object this view did not return", async () => {
    prime({
      memberships: [
        ...MEMBERSHIPS,
        {
          id: "m-3",
          workspace_id: "ws-1",
          ontology_id: ONTOLOGY,
          parent_object_id: null,
          child_object_id: "gone",
          position: 1,
        },
      ],
    });
    const summary = await getSummary(CTX);
    expect(summary.ontologies[0].columnIds).toEqual([COLUMN]);
  });
});

describe("getSummary — the row ceilings are reported, not silent", () => {
  it("reports truncated:false for a workspace under every ceiling", async () => {
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(false);
  });

  it("reports truncated:true when the object WALK hit its hardCap", async () => {
    // A full `ONTOLOGY_READ_LIMITS.objects` set AND the walk's own clip answer.
    // The row count is here to show the shape of the case; what makes it
    // truncated is the read saying so — at-hardCap is indistinguishable from
    // exhausted, so `readAllPages` reports the pessimistic reading.
    prime({
      objects: Array.from({ length: ONTOLOGY_READ_LIMITS.objects }, (_, i) => ({
        id: `o-${i}`,
        name: `Object ${i}`,
        subtitle: "",
      })),
      objectsTruncated: true,
      memberships: [],
    });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(true);
  });

  it("reports truncated:true when the ontology walk hit its hardCap", async () => {
    prime({
      ontologies: Array.from({ length: ONTOLOGY_READ_LIMITS.ontologies }, (_, i) => ({
        id: `c-${i}`,
        workspace_id: "ws-1",
        slug: `ontology-${i}`,
        name: `Ontology ${i}`,
        purpose: "",
        created_by: "user-1",
        agents_may_edit: true,
      })),
      ontologiesTruncated: true,
      memberships: [],
    });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(true);
  });

  it("reports truncated:true when the MEMBERSHIP walk hit its hardCap", async () => {
    // The third input, and the one whose clip is worst: a short membership set
    // is a graph with whole columns missing, not a graph that says it is short.
    prime({ membershipsTruncated: true });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(true);
  });

  it("a full-length row set that the walk EXHAUSTED is not truncated", async () => {
    // The other half of the honesty rule: rows up to the cap are now actually
    // fetched, so a long answer is not by itself a clipped one.
    prime({
      objects: Array.from({ length: ONTOLOGY_READ_LIMITS.objects }, (_, i) => ({
        id: `o-${i}`,
        name: `Object ${i}`,
        subtitle: "",
      })),
      memberships: [],
    });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(false);
  });
});
