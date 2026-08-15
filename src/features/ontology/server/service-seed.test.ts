/**
 * The ontology seed's WRITE SHAPE and cross-reference resolution.
 *
 * ⚠ Runs inside the post-signup redirect, so the awaited round-trip count is a
 * product property. Pins the four-statement form AND that batching cost the
 * graph nothing: same objects, parentage, ordering, resolved attribute ids and
 * relationship endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-seed");

import * as repo from "./repository";
import * as seedRepo from "./repository-seed";
import { buildOntologySeed } from "./seed";
import { seedWorkspace } from "./service-seed";
import type { OntologySeedRefs } from "./service-seed";

const WS = "ws-1";
const USER = "user-1";
const CLUSTER = "cluster-1";

const SEED = buildOntologySeed();

/** Refs as the orchestrator threads them in: every key/slug resolves. */
const REFS: OntologySeedRefs = {
  entryIdByKey: {
    "what-is-dopl": "entry-1",
    "the-mcp-tools": "entry-2",
    "the-session-ritual": "entry-3",
    "building-the-ontology": "entry-4",
    "knowledge-vs-skills": "entry-5",
  },
  skillIdBySlug: {
    "archive-a-session-to-chats": "skill-1",
    "file-knowledge-well": "skill-2",
    "author-the-ontology": "skill-3",
  },
};

type ObjectInput = Parameters<typeof seedRepo.insertObjects>[0][number];
type MembershipInput = Parameters<typeof seedRepo.insertMemberships>[0][number];

function insertedObjects(): ObjectInput[] {
  return vi.mocked(seedRepo.insertObjects).mock.calls[0][0];
}
function insertedMemberships(): MembershipInput[] {
  return vi.mocked(seedRepo.insertMemberships).mock.calls[0][0];
}
function insertedEdges() {
  return vi.mocked(seedRepo.insertRelationships).mock.calls[0][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listClusters).mockResolvedValue([]);
  vi.mocked(repo.insertCluster).mockResolvedValue({ id: CLUSTER } as never);
  vi.mocked(seedRepo.insertObjects).mockResolvedValue([]);
  vi.mocked(seedRepo.insertMemberships).mockResolvedValue(undefined);
  vi.mocked(seedRepo.insertRelationships).mockResolvedValue(undefined);
});

describe("ontology seed — write shape", () => {
  it("writes the whole cluster in four statements", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);

    expect(repo.insertCluster).toHaveBeenCalledTimes(1);
    expect(seedRepo.insertObjects).toHaveBeenCalledTimes(1);
    expect(seedRepo.insertMemberships).toHaveBeenCalledTimes(1);
    expect(seedRepo.insertRelationships).toHaveBeenCalledTimes(1);
  });

  it("never inserts an object it then updates", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);

    // subtitle/template set at insert time, not by a follow-up update.
    expect(repo.insertObject).not.toHaveBeenCalled();
    expect(repo.updateObject).not.toHaveBeenCalled();
    expect(repo.insertMembership).not.toHaveBeenCalled();
    expect(repo.replaceRelationshipsForSource).not.toHaveBeenCalled();
  });

  it("reports the objects and relationships it wrote", async () => {
    const result = await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);

    const expectedObjects =
      SEED.columns.length +
      SEED.columns.reduce((n, c) => n + c.children.length, 0);
    expect(result).toEqual({
      clusterId: CLUSTER,
      objectsCreated: expectedObjects,
      relationshipsCreated: SEED.relationships.length,
    });
    expect(insertedObjects()).toHaveLength(expectedObjects);
  });
});

describe("ontology seed — the graph the batch produces", () => {
  it("carries every column's subtitle and template on the insert", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);
    const byName = new Map(insertedObjects().map((o) => [o.name, o]));

    for (const column of SEED.columns) {
      const row = byName.get(column.name);
      expect(row).toBeDefined();
      expect(row?.subtitle).toBe(column.subtitle);
      expect(row?.template).toEqual(column.template);
    }
  });

  it("resolves every card attribute to a real knowledge/skill id", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);
    const byName = new Map(insertedObjects().map((o) => [o.name, o]));
    const known = new Set([
      ...Object.values(REFS.entryIdByKey),
      ...Object.values(REFS.skillIdBySlug),
    ]);

    let linkAttributes = 0;
    for (const column of SEED.columns) {
      for (const child of column.children) {
        const row = byName.get(child.name);
        expect(row).toBeDefined();
        const authored = child.attributes.length;
        expect(row?.attributes).toHaveLength(authored);
        for (const attr of row?.attributes ?? []) {
          if (attr.value.kind === "text") continue;
          linkAttributes += 1;
          expect(attr.value.value.length).toBeGreaterThan(0);
          for (const id of attr.value.value) expect(known.has(id)).toBe(true);
        }
      }
    }
    // ⚠ Seed order is knowledge → skills → ontology; cross-refs depend on it.
    expect(linkAttributes).toBeGreaterThan(0);
  });

  it("drops link attributes whose refs did not resolve, keeping text", async () => {
    await seedWorkspace(
      { workspaceId: WS, userId: USER },
      { entryIdByKey: {}, skillIdBySlug: {} }
    );

    for (const row of insertedObjects()) {
      for (const attr of row.attributes ?? []) {
        expect(attr.value.kind).toBe("text");
      }
    }
  });

  it("files each card under its own column, and each column under the cluster", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);
    const idByName = new Map(insertedObjects().map((o) => [o.name, o.id]));
    const memberships = insertedMemberships();

    for (const [colIndex, column] of SEED.columns.entries()) {
      const columnId = idByName.get(column.name);
      expect(memberships).toContainEqual({
        workspaceId: WS,
        clusterId: CLUSTER,
        parentObjectId: null,
        childObjectId: columnId,
        position: colIndex,
      });
      for (const [childIndex, child] of column.children.entries()) {
        expect(memberships).toContainEqual({
          workspaceId: WS,
          clusterId: null,
          parentObjectId: columnId,
          childObjectId: idByName.get(child.name),
          position: childIndex,
        });
      }
    }
    expect(memberships).toHaveLength(insertedObjects().length);
  });

  it("points every relationship at the objects it was authored against", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);
    const idByName = new Map(insertedObjects().map((o) => [o.name, o.id]));
    const nameByKey = new Map<string, string>([
      ...SEED.columns.map((c) => [c.key, c.name] as const),
      ...SEED.columns.flatMap((c) =>
        c.children.map((o) => [o.key, o.name] as const)
      ),
    ]);
    const edges = insertedEdges();

    expect(edges).toHaveLength(
      SEED.relationships.reduce((n, r) => n + r.toKeys.length, 0)
    );
    for (const rel of SEED.relationships) {
      for (const toKey of rel.toKeys) {
        expect(edges).toContainEqual(
          expect.objectContaining({
            sourceObjectId: idByName.get(nameByKey.get(rel.fromKey)!),
            targetObjectId: idByName.get(nameByKey.get(toKey)!),
            label: rel.label,
          })
        );
      }
    }
    const bySource = new Map<string, number[]>();
    for (const e of edges) {
      bySource.set(e.sourceObjectId, [
        ...(bySource.get(e.sourceObjectId) ?? []),
        e.position,
      ]);
    }
    for (const positions of bySource.values()) {
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it("gives every object a distinct id", async () => {
    await seedWorkspace({ workspaceId: WS, userId: USER }, REFS);
    const ids = insertedObjects().map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
