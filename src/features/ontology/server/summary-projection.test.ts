/**
 * INVARIANT SUITE — the ontology SUMMARY projection (launch blocker P0-3).
 *
 * `GET /api/ontology` did four parallel whole-table pulls with no bound
 * anywhere and shipped every JSONB column with them — `attributes` (schema
 * ceiling: 100 entries, text values to 4000 chars), `methods`, `template`, plus
 * each cluster's `layout`. `dopl_map`, the call the MCP server instructions
 * mandate before every agent's first substantive reply, paid all of it to
 * render cluster names and column names.
 *
 * `getSummary` is the answer, and it only stays the answer while these hold:
 *
 *   1. NO JSONB LEAVES. Not "empty arrays" — absent. A future `mapObjectRow`
 *      reused here, or a helpful `...row` spread, puts hundreds of KB back on
 *      the hot path and nothing else in the system would notice.
 *   2. THE STRUCTURE IS IDENTICAL to `getSnapshot`'s. The whole point is that a
 *      map-shaped render swaps projections without changing a line, so
 *      `columnIds` / `childIds` must assemble the same way.
 *   3. THE RELATIONSHIPS TABLE IS NEVER READ. It is the table that grows with
 *      the square of the graph and the one no map-shaped render draws.
 *   4. A CLIPPED READ SAYS SO. The new row ceilings are only defensible while
 *      a truncated view is distinguishable from an exhausted one.
 *
 * Repository layers are mocked, so this is the projection under test and
 * nothing else.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  OntologyClusterSummaryRow,
  OntologyMembershipRow,
  OntologyObjectSummaryRow,
} from "./dto";
import { ONTOLOGY_READ_LIMITS } from "./dto";

vi.mock("./repository", () => ({
  listMemberships: vi.fn(),
  listRelationships: vi.fn(),
}));

vi.mock("./repository-projections", () => ({
  listClusterSummaries: vi.fn(),
  listObjectSummaries: vi.fn(),
}));

import * as repo from "./repository";
import * as narrow from "./repository-projections";
import { getSummary } from "./service";

const mockRepo = vi.mocked(repo);
const mockNarrow = vi.mocked(narrow);

const CTX = { workspaceId: "ws-1", userId: "user-1" };
const CLUSTER = "c-1";
const COLUMN = "o-col";
const CARD = "o-card";

const CLUSTER_ROW: OntologyClusterSummaryRow = {
  id: CLUSTER,
  slug: "playbook",
  name: "Dopl Playbook",
  purpose: "How this workspace is meant to be used.",
};

const OBJECT_ROWS: OntologyObjectSummaryRow[] = [
  { id: COLUMN, name: "Surfaces", subtitle: "What the workspace is made of" },
  { id: CARD, name: "Knowledge", subtitle: "Durable reference" },
];

const MEMBERSHIPS: OntologyMembershipRow[] = [
  {
    id: "m-1",
    workspace_id: "ws-1",
    cluster_id: CLUSTER,
    parent_object_id: null,
    child_object_id: COLUMN,
    position: 0,
  },
  {
    id: "m-2",
    workspace_id: "ws-1",
    cluster_id: null,
    parent_object_id: COLUMN,
    child_object_id: CARD,
    position: 0,
  },
];

function prime(over: {
  clusters?: OntologyClusterSummaryRow[];
  objects?: OntologyObjectSummaryRow[];
  memberships?: OntologyMembershipRow[];
} = {}) {
  mockNarrow.listClusterSummaries.mockResolvedValue(over.clusters ?? [CLUSTER_ROW]);
  mockNarrow.listObjectSummaries.mockResolvedValue(over.objects ?? OBJECT_ROWS);
  mockRepo.listMemberships.mockResolvedValue(over.memberships ?? MEMBERSHIPS);
}

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("getSummary — what does NOT cross the wire", () => {
  it("ships no attributes, methods or template on any object", async () => {
    const summary = await getSummary(CTX);
    for (const object of Object.values(summary.objects)) {
      // `not.toHaveProperty`, not `toEqual([])`: an empty array is a claim that
      // the object has none, which is a different — and wrong — statement.
      expect(object).not.toHaveProperty("attributes");
      expect(object).not.toHaveProperty("methods");
      expect(object).not.toHaveProperty("template");
      expect(object).not.toHaveProperty("relationships");
      expect(Object.keys(object).sort()).toEqual(["childIds", "id", "name", "subtitle"]);
    }
  });

  it("ships no cluster layout", async () => {
    const summary = await getSummary(CTX);
    for (const cluster of summary.clusters) {
      expect(cluster).not.toHaveProperty("layout");
      expect(Object.keys(cluster).sort()).toEqual([
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
    expect(mockRepo.listRelationships).not.toHaveBeenCalled();
    expect(mockNarrow.listClusterSummaries).toHaveBeenCalledTimes(1);
    expect(mockNarrow.listObjectSummaries).toHaveBeenCalledTimes(1);
    expect(mockRepo.listMemberships).toHaveBeenCalledTimes(1);
  });
});

describe("getSummary — the structure a map-shaped render walks", () => {
  it("assembles columnIds and childIds exactly as getSnapshot does", async () => {
    const summary = await getSummary(CTX);
    expect(summary.clusters[0].columnIds).toEqual([COLUMN]);
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
          cluster_id: CLUSTER,
          parent_object_id: null,
          child_object_id: "gone",
          position: 1,
        },
      ],
    });
    const summary = await getSummary(CTX);
    expect(summary.clusters[0].columnIds).toEqual([COLUMN]);
  });
});

describe("getSummary — the row ceilings are reported, not silent", () => {
  it("reports truncated:false for a workspace under every ceiling", async () => {
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(false);
  });

  it("reports truncated:true when the object read comes back AT its ceiling", async () => {
    // At the ceiling is indistinguishable from over it, so it counts as
    // clipped — the one direction that cannot mislead a caller.
    prime({
      objects: Array.from({ length: ONTOLOGY_READ_LIMITS.objects }, (_, i) => ({
        id: `o-${i}`,
        name: `Object ${i}`,
        subtitle: "",
      })),
      memberships: [],
    });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(true);
  });

  it("reports truncated:true when the cluster read hits its ceiling", async () => {
    prime({
      clusters: Array.from({ length: ONTOLOGY_READ_LIMITS.clusters }, (_, i) => ({
        id: `c-${i}`,
        slug: `cluster-${i}`,
        name: `Cluster ${i}`,
        purpose: "",
      })),
      memberships: [],
    });
    const summary = await getSummary(CTX);
    expect(summary.truncated).toBe(true);
  });
});
