import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { OntologyContext } from "../types";
import type { OntologyClusterRow, OntologyObjectRow } from "./dto";
import * as repo from "./repository";
import { listMembershipParents } from "./repository-projections";
import {
  audienceAdmits,
  levelForCluster,
  resolveOntologyAudience,
  type OntologyAudience,
} from "./service-audience";

/**
 * 🔒 THE GATES EVERY ONTOLOGY READ AND WRITE PASSES (spec §4 sites 2-6).
 *
 * ⚠ **404, NEVER 403** — "not shared with you", "not visible to you" and "does
 * not exist" are ONE answer, or a refusal becomes an oracle confirming a guessed
 * id (`knowledge/server/service-bases.ts › assertWithinAudience`'s rule,
 * extended to a level ladder).
 *
 * ⚠ **THE GATE LIVES HERE AND NOT BESIDE THE WRITE** — a gate beside its insert
 * is one a later edit reorders past it (the `knowledge/server/
 * service-base-gates.ts` seam, same reason).
 *
 * ⚠ **A GATE RETURNS THE ROW, AND THE ROW'S CONTAINER IS WHERE THE WRITE
 * LANDS.** A lent ontology lives in the LENDER's container, so callers MUST use
 * `row.workspace_id` — `ctx.workspaceId` would silently update nothing.
 */

/** ⚠ Depth ceiling on the upward membership walk (the board is cluster → column
 *  → card). `seen` already terminates a CYCLE — this bounds COST. */
const CLUSTER_WALK_DEPTH = 8;

/** The clusters this object belongs to, walking `ontology_memberships` UP.
 *  Empty = reachable from no cluster, which every gate below reads as "no". */
export async function clustersOfObject(
  audience: OntologyAudience,
  objectId: string
): Promise<Set<string>> {
  return (await clustersOfObjects(audience, [objectId])).get(objectId) ?? new Set();
}

/**
 * The same walk for MANY objects — one query PER LEVEL, never one per object.
 *
 * ⚠ **BATCHED BECAUSE THE CALLER IS A LIST**: `service.ts › sanitizeEdges`
 * validates every target of an edge payload, so a per-object walk would be an
 * N+1 keyed on how many edges a client sent. The bound is
 * {@link CLUSTER_WALK_DEPTH} queries whatever the batch size.
 *
 * ⚠ EACH OBJECT KEEPS ITS OWN ANSWER — the frontier carries the ROOT it
 * descends from.
 */
export async function clustersOfObjects(
  audience: OntologyAudience,
  objectIds: readonly string[]
): Promise<Map<string, Set<string>>> {
  const answer = new Map<string, Set<string>>(
    objectIds.map((id) => [id, new Set<string>()])
  );
  // node id → the roots this node is an ancestor of. ⚠ `seen` per ROOT, not
  // global: two roots sharing a parent must both collect that parent's clusters.
  let frontier = new Map<string, Set<string>>(
    objectIds.map((id) => [id, new Set([id])])
  );
  const seen = new Map<string, Set<string>>(
    objectIds.map((id) => [id, new Set([id])])
  );
  for (let depth = 0; depth < CLUSTER_WALK_DEPTH && frontier.size > 0; depth++) {
    const rows = await listMembershipParents(audience.workspaceIds, [
      ...frontier.keys(),
    ]);
    const next = new Map<string, Set<string>>();
    for (const row of rows) {
      const roots = frontier.get(row.child_object_id);
      if (!roots) continue;
      for (const root of roots) {
        if (row.cluster_id) {
          answer.get(root)?.add(row.cluster_id);
        } else if (row.parent_object_id) {
          const visited = seen.get(root) as Set<string>;
          if (visited.has(row.parent_object_id)) continue;
          visited.add(row.parent_object_id);
          const bucket = next.get(row.parent_object_id);
          if (bucket) bucket.add(root);
          else next.set(row.parent_object_id, new Set([root]));
        }
      }
    }
    frontier = next;
  }
  return answer;
}

/**
 * 🔒 **WHICH OF THESE OBJECT IDS MAY THIS CALLER SEE — Q8's boundary over a
 * SET.** Visible when ANY cluster it belongs to admits the caller at `view`
 * (Q9's read half), the same sentence `./service-reads.ts ›
 * walkAdmittedClusters` says about the board.
 *
 * ⚠ **IT IS NOT `repository.ts › filterObjectIds`, AND CONFUSING THE TWO IS THE
 * ONE WAY TO LEAK.** That one answers "is this a live row inside my READ SCOPE",
 * and the scope holds the LENDER's whole container. This applies the
 * authorization on top.
 */
export async function admittedObjectIds(
  ctx: OntologyContext,
  audience: OntologyAudience,
  objectIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(objectIds)];
  if (unique.length === 0) return new Set();
  if (audience.kind === "unrestricted") return new Set(unique);
  const byObject = await clustersOfObjects(audience, unique);
  const clusters = await repo.listClusters(audience.workspaceIds);
  const admitted = new Set(
    clusters
      .filter((c) => audienceAdmits(ctx, audience, c, "view"))
      .map((c) => c.id)
  );
  return new Set(
    unique.filter((id) => {
      for (const clusterId of byObject.get(id) ?? []) {
        if (admitted.has(clusterId)) return true;
      }
      return false;
    })
  );
}

function clusterNotFound(): HttpError {
  return HttpError.notFound("Cluster not found");
}

function objectNotFound(): HttpError {
  return HttpError.notFound("Object not found");
}

/** One cluster, fenced at `min`. ⚠ The read runs over the AUDIENCE's container
 *  set, so it FINDS a lent cluster in the lender's container and then
 *  `audienceAdmits` decides: resolution is not authorization. */
export async function requireCluster(
  ctx: OntologyContext,
  clusterId: string,
  min: "view" | "edit"
): Promise<OntologyClusterRow> {
  const audience = await resolveOntologyAudience(ctx);
  const row = await repo.findClusterById(audience.workspaceIds, clusterId);
  if (!row || !audienceAdmits(ctx, audience, row, min)) throw clusterNotFound();
  return row;
}

/**
 * 🔒 **Q9 — A WRITE NEEDS `edit` ON EVERY CLUSTER THE OBJECT BELONGS TO; A READ
 * NEEDS `view` ON ANY.** Samuel's ruling, and the sharpest consequence of R5.
 * With `some` on the write, `members_level='edit'` in one channel would silently
 * edit an ontology that channel cannot see.
 *
 * ⚠ AN OBJECT IN NO CLUSTER IS REFUSED ON BOTH — `every` over nothing is
 * vacuously true and would admit exactly the rows nothing authorises.
 */
export async function requireObject(
  ctx: OntologyContext,
  objectId: string,
  min: "view" | "edit"
): Promise<OntologyObjectRow> {
  const audience = await resolveOntologyAudience(ctx);
  const row = await repo.findObjectById(audience.workspaceIds, objectId);
  if (!row) throw objectNotFound();
  if (audience.kind === "unrestricted") return row;

  const clusterIds = await clustersOfObject(audience, objectId);
  if (clusterIds.size === 0) throw objectNotFound();
  const clusters = await repo.listClusters(audience.workspaceIds);
  const owning = clusters.filter((c) => clusterIds.has(c.id));
  // ⚠ A cluster the walk named but the read did not return is invisible to this
  // caller and must still COUNT against a write (Q9): a short list is a refusal,
  // never a smaller `every`.
  if (owning.length !== clusterIds.size) {
    if (min === "edit") throw objectNotFound();
  }
  const admits =
    min === "edit"
      ? owning.length > 0 && owning.every((c) => audienceAdmits(ctx, audience, c, "edit"))
      : owning.some((c) => audienceAdmits(ctx, audience, c, "view"));
  if (!admits) throw objectNotFound();
  return row;
}

/**
 * 🔒 THE CREATE GATE — the OWNER LANE's level: `edit` for a person, and for an
 * AGENT the solo toggle's answer (`agents_may_edit`), i.e. Samuel's *"toggle it
 * so that their agents can only view"*.
 *
 * ⚠ IT ASKS THE AUDIENCE ABOUT A CLUSTER THAT DOES NOT EXIST YET, using the
 * facts the row WILL carry (`knowledge › resolveCreateDestination`'s shape): a
 * create must not produce a row its own author cannot then edit.
 */
export async function assertCanCreateCluster(ctx: OntologyContext): Promise<void> {
  const audience = await resolveOntologyAudience(ctx);
  const level = levelForCluster(ctx, audience, {
    id: "(new)",
    workspace_id: ctx.workspaceId,
    created_by: ctx.userId,
    // The column's own default (spec §3.1) — the row this gate is asked about.
    agents_may_edit: true,
  });
  if (level !== "edit") {
    throw new HttpError(
      403,
      "ONTOLOGY_WRITE_DENIED",
      "Your agents may only view ontologies in this channel. Creating one is a " +
        "human-only act, or one your operator re-enables on the ontology itself."
    );
  }
}
