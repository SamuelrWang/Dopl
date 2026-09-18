import "server-only";
import * as narrow from "./repository-projections";
import { levelForCluster, resolveOntologyAudience } from "./service-audience";
import type { OntologyContext, OntologyLevel } from "../types";

/**
 * Which ontologies this request reaches, and at what rung — the smallest
 * possible ontology read, and the PRODUCER the desktop's framing block had none
 * of (F-681, closed 2026-09-09).
 *
 * It is not a gate and its output is not a capability. The one consumer is
 * `dopl-desktop-app/main/prompt-framing-ontology.js › ontologyReachLines`, which
 * INVARIANTS §4A calls a COMPENSATING CONTROL: it tells an agent what it may
 * open so it stops discovering its level by being refused. The fence is
 * `./service-audience.ts › resolveOntologyAudience` + `› levelForCluster`, which
 * runs on every read and every write regardless of what any prompt says — and it
 * is the SAME function this read composes, which is the whole point: a second
 * statement of the level would be one that drifts.
 *
 * No `channelId` argument, deliberately, and it is not an omission. The
 * ceiling is resolved per CONTAINER: `repository-shares.ts ›
 * listChannelIdsForWorkspace` folds in every channel of `ctx.workspaceId` and
 * takes the WIDER rung across them (I5). A home channel IS the one channel in a
 * `kind='link'` container (spec §1), so naming the container names the channel;
 * a `channelId` parameter would be a filter this fence does not apply, i.e. a
 * narrower answer than the server will actually enforce, which is the direction
 * that lies to an agent rather than the direction that leaks.
 *
 * `none` is dropped, not reported. The framing's own filter fails closed on
 * any rung it does not recognise, and "an ontology exists that you may not
 * touch" is a fact about somebody else's shelf.
 *
 * One read. `listClusterSummaries` carries no `layout`, no objects and no
 * memberships — this answers a question about CLUSTERS, and pulling a graph to
 * write four prompt lines is what `getSummary` is for.
 */
export interface OntologyReachEntry {
  /** The CLUSTER id — the `dopl_ontology` op's handle, spliced verbatim into the
   *  call the framing tells the agent to make. */
  id: string;
  name: string;
  /** The ONTOLOGY's container, which is the LENDER's and not the caller's — the
   *  `workspace=` argument every `dopl_ontology` op takes (INVARIANTS §10). */
  workspaceId: string;
  /** `view` | `edit`. Never `none`: those rows are not in the answer. */
  level: Exclude<OntologyLevel, "none">;
}

export async function getReach(
  ctx: OntologyContext
): Promise<OntologyReachEntry[]> {
  const audience = await resolveOntologyAudience(ctx);
  const rows = await narrow.listClusterSummaries(audience.workspaceIds);
  const out: OntologyReachEntry[] = [];
  for (const row of rows) {
    const level = levelForCluster(ctx, audience, row);
    if (level === "none") continue;
    out.push({
      id: row.id,
      name: row.name,
      workspaceId: row.workspace_id,
      level,
    });
  }
  return out;
}
