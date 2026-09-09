import "server-only";
import type {
  OntologyCluster,
  OntologyContext,
  OntologyObject,
  OntologySnapshot,
} from "../types";
import {
  mapObjectRow,
  ONTOLOGY_READ_LIMITS,
  type OntologyClusterRow,
  type OntologyClusterSummary,
  type OntologyMembershipRow,
  type OntologyObjectSummary,
  type OntologySummary,
} from "./dto";
import * as repo from "./repository";
import * as narrow from "./repository-projections";
import { countSharesForClusters } from "./repository-shares";
import {
  audienceAdmits,
  resolveOntologyAudience,
  type OntologyAudience,
} from "./service-audience";

/**
 * 🔒 THE TWO GRAPH READS, AUDIENCE-FILTERED (spec §4 sites 2 and 3, risks
 * R1/R2).
 *
 * ⚠ **SPLIT OUT OF `service.ts` ON 2026-09-09 AT THE §1 CAP.** The seam is
 * READS vs WRITES: what lives here assembles a graph out of rows the caller may
 * see, and what stays there gates and persists a change. `service.ts`
 * re-exports both names, so no route, no MCP tool and no client moved.
 *
 * ── 🔒 THE ORDER, AND WHY IT IS NOT NEGOTIABLE ──────────────────────────────
 * ```
 * 1. resolve the audience          — one ceiling for the request
 * 2. read clusters in its SCOPE    — wider than the caller's container (the lend)
 * 3. FILTER them by level          — the authorization; step 2 is not one
 * 4. WALK memberships from those   — Q8: the cluster's membership walk IS the
 *                                    boundary, so an object reachable only from
 *                                    another cluster is not in this answer
 * 5. read objects and edges BY ID  — never by container
 * ```
 * Steps 2 and 3 are a pair. A future edit that widens the scope and keeps the
 * filter is safe; one that keeps the scope and drops the filter serves the
 * lender's entire shelf to whoever they lent ONE ontology to.
 *
 * ⚠ **ONE CONSEQUENCE FOR THE UNRESTRICTED ARM TOO, AND IT IS DELIBERATE.** The
 * walk replaces a whole-container object read, so an ORPHAN — an object no
 * membership chain reaches a cluster from — stops appearing in the snapshot
 * even in a standard workspace. That is a bug STATE rather than a product one:
 * every create writes a membership in the same call, and
 * `repository.ts › hardDeleteObject` exists precisely because a plain DELETE
 * would leave an unreachable subtree alive. Nothing renders an orphan (the
 * board and the picker both walk DOWN from `cluster.columnIds`), so what
 * changes is that it is no longer shipped. ⚠ A `kind:"ref"` attribute pointing
 * at an object in ANOTHER cluster still resolves under `unrestricted`, because
 * every cluster is a root there; under a `resolved` audience it does not, and
 * that is Q8 — the cluster's membership walk IS the boundary.
 */

/** The membership rows reachable from an ADMITTED cluster, and the objects they
 *  reach. ⚠ Rows outside the walk are DROPPED, never merely unrendered — they
 *  are what would otherwise attach a foreign column to a visible board. */
interface ClusterWalk {
  objectIds: string[];
  rows: OntologyMembershipRow[];
}

function walkAdmittedClusters(
  admittedClusterIds: Set<string>,
  memberships: OntologyMembershipRow[]
): ClusterWalk {
  const byParent = new Map<string, OntologyMembershipRow[]>();
  const roots: OntologyMembershipRow[] = [];
  for (const m of memberships) {
    if (m.cluster_id) {
      if (admittedClusterIds.has(m.cluster_id)) roots.push(m);
    } else if (m.parent_object_id) {
      const bucket = byParent.get(m.parent_object_id);
      if (bucket) bucket.push(m);
      else byParent.set(m.parent_object_id, [m]);
    }
  }

  const rows: OntologyMembershipRow[] = [];
  const seen = new Set<string>();
  const frontier: string[] = [];
  const take = (m: OntologyMembershipRow) => {
    rows.push(m);
    if (seen.has(m.child_object_id)) return;
    seen.add(m.child_object_id);
    frontier.push(m.child_object_id);
  };
  for (const m of roots) take(m);
  // ⚠ `seen` is what terminates this: a card hanging under two parents is
  // visited once, and a malformed cycle cannot spin.
  while (frontier.length > 0) {
    const parent = frontier.pop() as string;
    for (const m of byParent.get(parent) ?? []) take(m);
  }
  return { objectIds: [...seen], rows };
}

/** Whole-ontology graph in the store shape UI and MCP share, bounded by the
 *  caller's audience. Memberships and edges pointing at soft-deleted objects
 *  are dropped here, as they always were. */
export async function getSnapshot(ctx: OntologyContext): Promise<OntologySnapshot> {
  const audience = await resolveOntologyAudience(ctx);
  const [clusterRows, membershipRows] = await Promise.all([
    repo.listClusters(audience.workspaceIds),
    repo.listMemberships(audience.workspaceIds),
  ]);
  const admitted = clusterRows.filter((row) => audienceAdmits(ctx, audience, row));
  const walk = walkAdmittedClusters(new Set(admitted.map((c) => c.id)), membershipRows);

  const [objectRows, relationshipRows, shareCounts] = await Promise.all([
    repo.listObjectsByIds(audience.workspaceIds, walk.objectIds),
    repo.listRelationshipsForSources(audience.workspaceIds, walk.objectIds),
    // ⚠ ONE READ FOR THE WHOLE LIST, and it rides THIS fan rather than adding a
    // round trip — the `grantedResourceIds` shape (spec §3 reason 4).
    countSharesForClusters(ownedClusterIds(audience, admitted)),
  ]);

  const objects: Record<string, OntologyObject> = {};
  for (const row of objectRows) objects[row.id] = mapObjectRow(row);

  const clusters = admitted.map((row) =>
    mapClusterRow(row, shareCounts.get(row.id))
  );
  const clustersById = new Map(clusters.map((c) => [c.id, c]));

  for (const m of walk.rows) {
    if (!objects[m.child_object_id]) continue;
    if (m.cluster_id) {
      clustersById.get(m.cluster_id)?.columnIds.push(m.child_object_id);
    } else if (m.parent_object_id) {
      objects[m.parent_object_id]?.childIds.push(m.child_object_id);
    }
  }

  for (const r of relationshipRows) {
    const source = objects[r.source_object_id];
    if (!source || !objects[r.target_object_id]) continue;
    const edge = source.relationships.find((e) => e.label === r.label);
    if (edge) edge.targetIds.push(r.target_object_id);
    else source.relationships.push({ label: r.label, targetIds: [r.target_object_id] });
  }

  return { clusters, objects };
}

/**
 * One cluster row → the wire shape.
 *
 * 🔒 **IT CARRIES `agentsMayEdit` AND `sharedChannelCount`, AND BOTH ARE READ BY
 * THE /home CARD** (`pages/home/ontology-panels.tsx › OntologyCard` through
 * `hooks/use-ontologies.ts › ontologyListRows`). ⚠ Emitting NEITHER is not a
 * blank card — it is a card rendering the FALLBACKS, i.e. "agents may edit" for
 * an ontology whose owner turned that off, and no share line for one lent into
 * four rooms. The fallbacks exist for a STALE CACHE, never as this mapper's
 * output.
 *
 * ⚠ `sharedChannelCount` IS OMITTED, NOT ZEROED, WHEN THE CALLER DOES NOT OWN
 * THE ROW — how widely somebody else's ontology is lent is their business, and
 * `undefined` is exactly the "nobody looked" the card renders as nothing.
 */
export function mapClusterRow(
  row: OntologyClusterRow,
  sharedChannelCount?: number
): OntologyCluster {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    layout: row.layout ?? {},
    columnIds: [],
    agentsMayEdit: row.agents_may_edit,
    ...(sharedChannelCount === undefined ? {} : { sharedChannelCount }),
  };
}

/**
 * The admitted clusters the caller OWNS — the only ones a share count is
 * emitted for.
 *
 * ⚠ `unrestricted` ANSWERS NOTHING, and that is the query budget (the ceiling's
 * own first arm): a standard-workspace board never lends into a home channel, so
 * the hot path pays no share read at all.
 */
function ownedClusterIds(
  audience: OntologyAudience,
  admitted: readonly { id: string; created_by: string | null }[]
): string[] {
  if (audience.kind !== "resolved" || audience.userId === null) return [];
  const userId = audience.userId;
  return admitted.filter((c) => c.created_by === userId).map((c) => c.id);
}

/**
 * Map-shaped read: `getSnapshot`'s structure minus every JSONB column and the
 * relationships table. Backs `dopl_map`. `truncated` = clipped by
 * `ONTOLOGY_READ_LIMITS`.
 *
 * ⚠ THE SAME FENCE AS `getSnapshot`, AND R2 IS WHY IT IS SPELLED TWICE RATHER
 * THAN INHERITED: this is what `dopl_map` serves, so a leak here lands on the
 * routing surface every agent calls FIRST.
 *
 * ⚠ Relationships deliberately unfetched (nothing map-shaped draws an edge;
 * that table grows quadratically). Per-object edges stay reachable via
 * `op="get"`.
 */
export async function getSummary(ctx: OntologyContext): Promise<OntologySummary> {
  const audience = await resolveOntologyAudience(ctx);
  const [clusterRows, membershipRows] = await Promise.all([
    narrow.listClusterSummaries(audience.workspaceIds),
    repo.listMemberships(audience.workspaceIds),
  ]);
  const admitted = clusterRows.filter((row) => audienceAdmits(ctx, audience, row));
  const walk = walkAdmittedClusters(new Set(admitted.map((c) => c.id)), membershipRows);
  const objectRows = await narrow.listObjectSummariesByIds(
    audience.workspaceIds,
    walk.objectIds
  );

  const objects: Record<string, OntologyObjectSummary> = {};
  for (const row of objectRows) {
    objects[row.id] = {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      childIds: [],
    };
  }

  const clusters: OntologyClusterSummary[] = admitted.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    columnIds: [],
  }));
  const clustersById = new Map(clusters.map((c) => [c.id, c]));

  for (const m of walk.rows) {
    if (!objects[m.child_object_id]) continue;
    if (m.cluster_id) {
      clustersById.get(m.cluster_id)?.columnIds.push(m.child_object_id);
    } else if (m.parent_object_id) {
      objects[m.parent_object_id]?.childIds.push(m.child_object_id);
    }
  }

  // At-ceiling is indistinguishable from exhausted → counts as clipped.
  const truncated =
    clusterRows.length >= ONTOLOGY_READ_LIMITS.clusters ||
    objectRows.length >= ONTOLOGY_READ_LIMITS.objects ||
    membershipRows.length >= ONTOLOGY_READ_LIMITS.memberships;

  return { clusters, objects, truncated };
}
