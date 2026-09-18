import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  meetsLevel,
  type OntologyContext,
  type OntologyLevel,
} from "../types";

/**
 * The ontology visibility rule, in TypeScript — the twin of
 * `supabase/migrations/20261001130000_ontology_readable.sql`'s
 * `dopl_ontology_readable` / `dopl_ontology_writable`
 * (`docs/specs/home-ontology.md` §3.2, slice S1).
 *
 * Two statements of one rule, deliberately. Every ontology read runs on the
 * SERVICE-ROLE client (`./repository.ts`), so the predicate below is the fence
 * that actually runs and the policy is the one that runs the day a read moves
 * to `readClient()` or a realtime subscriber opens a channel. What stops them
 * drifting is `scripts/check-rls-pair-gate.ts` (they exist in pairs) and
 * `./rls-redteam.test.ts` (they agree, arm for arm).
 *
 * The ladder is not declared here. `../types.ts › ONTOLOGY_LEVELS` /
 * `› meetsLevel` / `› narrowerLevel` own it — the SHARE DIALOG needs the same
 * rungs and this module is `server-only`. The SQL rank
 * (`dopl_ontology_level_rank`) is already the second statement it is allowed.
 *
 * The arm correspondence, since the halves use different vocabularies:
 *
 * | SQL (`dopl_ontology_readable`)                                    | here                                    |
 * |-------------------------------------------------------------------|-----------------------------------------|
 * | `is_current_workspace_member(c.workspace_id,'viewer')`            | `cluster.workspaceId === ctx.workspaceId` |
 * | `NOT dopl_credential_is_shared()`                                 | `!isSharedCredential(ctx)`              |
 * | `dopl_ontology_level_rank(dopl_ontology_share_level(c.id)) >= 1`  | `reach.get(cluster.id) >= 'view'`       |
 *
 * The first row is NOT an equality, and this is the one place that says so.
 * `withWorkspaceAuth` resolves ONE container and proves membership OF IT, so a
 * `true` here is always a `true` in
 * SQL; the converse is FALSE, because `./service-audience.ts ›
 * OntologyAudience.workspaceIds` reads WIDER (the caller's personal shelf, and
 * the LENDER's container behind a share). A DIVERGENCE, not a mirror:
 *
 * | the cluster's container `W`                        | SQL arm 1 | `inOwnContainer` |
 * |----------------------------------------------------|-----------|------------------|
 * | `W === ctx.workspaceId`                             | true      | **true**         |
 * | `W` = the caller's own personal shelf, standing in a room | true | **false**   |
 * | `W` = another container the caller is a member of    | true      | **false**        |
 * | `W` = a container the caller is not in               | false     | **false**        |
 *
 * So this module is strictly NARROWER than its SQL twin — the safe direction,
 * and still a divergence. Row 2 is restored, and only row 2, by
 * `./service-audience.ts › levelForCluster`'s `created_by === userId` arm.
 * Row 3 stays refused on purpose: a cluster in somebody else's link container
 * reaches this caller through a SHARE or not at all. A future edit that widens
 * arm 1 to a membership READ must delete that owner arm in the same
 * change, or one rule is stated twice. Pinned in `./service-shared.test.ts ›
 * the SQL twin's arm 1`.
 *
 * The agent ceiling is not here and must not be added here. Samuel's matrix
 * caps an agent at its operator's level (I1, Q1) and gives the OWNER two extra
 * controls (`ontology_clusters.agents_may_edit`,
 * `ontology_channel_shares.owner_agents_level`) — a question about the CREDENTIAL
 * and the CHANNEL, not about the row, resolved once per request in
 * `./service-audience.ts › resolveOntologyAudience`. No policy can ask it: a
 * policy reads no `source` axis. Two layers, two questions.
 */

/** The row shape the predicate needs — never the whole cluster. */
export interface OntologyClusterScope {
  id: string;
  /** The ONTOLOGY's container: a `kind='personal'` one for a home ontology. */
  workspaceId: string;
}

/**
 * Cluster id → the caller's own HUMAN level: the maximum rung across every home
 * channel they are in that the ontology is lent to (spec I5).
 *
 * Precomputed, one read for a row set — the
 * `shared/tenancy/resource-grant-reach.ts › grantedResourceIds` shape, never a
 * query per row. SQL twin: `dopl_ontology_share_level`.
 *
 * Absent = `none`, the same answer as a stored `'none'` (spec I4): unsharing
 * DELETES the row, it never writes a level.
 */
export type OntologyShareReach = ReadonlyMap<string, OntologyLevel>;

/** The empty reach — a solo container, or a caller in no channel at all. */
export const NO_ONTOLOGY_SHARES: OntologyShareReach = new Map();

/**
 * The caller's level THROUGH A SHARE, with the refusal that rides it.
 *
 * A shared credential is never widened by a share — it has no membership
 * of the channel to read the share THROUGH, refused here as `canSeeBase` refuses
 * it before the grant set (M-10 / F-336) and as `dopl_ontology_readable`'s share
 * arm refuses it in SQL. The share arm ONLY: a shared credential locked to the
 * owner's container still reaches it through arm 1 (M-10, unchanged here).
 */
export function sharedOntologyLevel(
  ctx: OntologyContext,
  cluster: OntologyClusterScope,
  reach: OntologyShareReach
): OntologyLevel {
  if (isSharedCredential(ctx)) return "none";
  return reach.get(cluster.id) ?? "none";
}

/** Arm 1 — the container, i.e. `is_current_workspace_member(workspace_id,
 *  'viewer')` asked from the other side. In a `kind='personal'` container the
 *  only member is the OWNER, which is why the matrix's *"a share never narrows
 *  the owner"* needs no arm of its own. */
function inOwnContainer(
  ctx: OntologyContext,
  cluster: OntologyClusterScope
): boolean {
  return cluster.workspaceId === ctx.workspaceId;
}

/**
 * May the caller SEE this ontology — the container, OR a share at `view`+.
 *
 * The share is an `OR` beside a closed group, never a term inside one. A
 * share's reader is by definition NOT in the ontology's container, so an arm
 * conjoined with the container test could only narrow — the share row would be a
 * row nothing reads. The defect `20260923140000_grant_read_arm.sql` §3b records
 * for the knowledge children; pinned here in both directions.
 *
 * Q8 — the cluster is the boundary. A shared-in reader sees this cluster's
 * membership walk and nothing else; an object reachable only from another cluster
 * is not in this one.
 */
export function canSeeOntology(
  ctx: OntologyContext,
  cluster: OntologyClusterScope,
  reach: OntologyShareReach
): boolean {
  return (
    inOwnContainer(ctx, cluster) ||
    meetsLevel(sharedOntologyLevel(ctx, cluster, reach), "view")
  );
}

/**
 * May the caller EDIT this ontology — the twin of `dopl_ontology_writable`.
 *
 * `'member'` is the app-side name for the DB's legacy `'editor'` rung
 * (`20260825140000`'s rank `CASE` maps both to 1), so the container arm is
 * `is_current_workspace_member(workspace_id,'editor')` written in the role
 * vocabulary this tree actually uses.
 *
 * Q9 is not answered here, on purpose. Samuel's ruling — a WRITE needs
 * `edit` on ALL of an object's clusters (spec R5), a READ on ANY — belongs to the
 * caller that sees all of them at once (`./service-gates.ts › requireObject`).
 * An `every` here would make a single-cluster question lie.
 */
export function canEditOntology(
  ctx: OntologyContext,
  cluster: OntologyClusterScope,
  reach: OntologyShareReach
): boolean {
  return (
    (inOwnContainer(ctx, cluster) && meetsMinRole(ctx.role, "member")) ||
    meetsLevel(sharedOntologyLevel(ctx, cluster, reach), "edit")
  );
}

/** Clusters whose answer a SHARE could still change — the negation of arm 1 and
 *  of the shared-credential refusal. A deliberate mirror of the arms above
 *  (`knowledge/server/service-shared.ts › needsGrantArm`'s shape): a caller
 *  reading their OWN container's board asks the share table nothing. */
export function needsShareArm(
  ctx: OntologyContext,
  cluster: OntologyClusterScope
): boolean {
  return !inOwnContainer(ctx, cluster) && !isSharedCredential(ctx);
}
