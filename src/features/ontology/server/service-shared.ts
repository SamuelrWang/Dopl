import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  meetsLevel,
  type OntologyContext,
  type OntologyLevel,
} from "../types";

/**
 * THE ONTOLOGY VISIBILITY RULE, IN TYPESCRIPT — the twin of
 * `supabase/migrations/20261001130000_ontology_readable.sql`'s
 * `dopl_ontology_readable` / `dopl_ontology_writable`
 * (`docs/specs/home-ontology.md` §3.2, slice S1).
 *
 * 🔒 **TWO STATEMENTS OF ONE RULE, DELIBERATELY.** Every ontology read runs on
 * the SERVICE-ROLE client (`./repository.ts`), so the predicate below is the
 * fence that actually runs and the policy is the one that runs the day a read
 * moves to `readClient()` or a realtime subscriber opens a channel. What stops
 * them drifting is `scripts/check-rls-pair-gate.ts` (they exist in pairs) and
 * `./rls-redteam.test.ts` (they agree, arm for arm) — adding an arm here without
 * adding it there is the failure both exist to catch.
 *
 * ⚠ **THE LADDER IS NOT DECLARED HERE.** `../types.ts › ONTOLOGY_LEVELS` /
 * `› meetsLevel` / `› narrowerLevel` own it — the SHARE DIALOG needs the same
 * rungs and this module is `server-only`. The SQL rank
 * (`dopl_ontology_level_rank`) is already the second statement it is allowed.
 *
 * ⚠ **THE ARM CORRESPONDENCE**, since the halves use different vocabularies:
 *
 * | SQL (`dopl_ontology_readable`)                                    | here                                    |
 * |-------------------------------------------------------------------|-----------------------------------------|
 * | `is_current_workspace_member(c.workspace_id,'viewer')`            | `cluster.workspaceId === ctx.workspaceId` |
 * | `NOT dopl_credential_is_shared()`                                 | `!isSharedCredential(ctx)`              |
 * | `dopl_ontology_level_rank(dopl_ontology_share_level(c.id)) >= 1`  | `reach.get(cluster.id) >= 'view'`       |
 *
 * 🔒 **THE FIRST ROW IS NOT AN EQUALITY, AND THIS IS THE ONE PLACE THAT SAYS SO
 * — read it before writing either half.** `withWorkspaceAuth` resolves ONE
 * container and proves membership OF IT, so a `true` here is always a `true` in
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
 * ⚠ **SO THIS MODULE IS STRICTLY NARROWER THAN ITS SQL TWIN** — the safe
 * direction, and still a divergence. **Row 2 is restored, and only row 2**, by
 * `./service-audience.ts › levelForCluster`'s `created_by === userId` arm.
 * **Row 3 stays refused on purpose**: a cluster in somebody else's link
 * container reaches this caller through a SHARE or not at all. ⚠ **A future edit
 * that widens arm 1 to a membership READ must delete that owner arm in the same
 * change**, or one rule is stated twice. Pinned in `./service-shared.test.ts ›
 * the SQL twin's arm 1`.
 *
 * ⚠ **THE AGENT CEILING IS NOT HERE AND MUST NOT BE ADDED HERE.** Samuel's
 * matrix caps an agent at its operator's level (I1, Q1) and gives the OWNER two
 * extra controls (`ontology_clusters.agents_may_edit`,
 * `ontology_channel_shares.owner_agents_level`) — a question about the CREDENTIAL
 * and the CHANNEL, not about the row, resolved once per request in
 * `./service-audience.ts › resolveOntologyAudience`. No policy can ask it: a
 * policy reads no `source` axis. **Two layers, two questions.**
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
 * ⚠ **PRECOMPUTED, ONE READ FOR A ROW SET** — the
 * `shared/tenancy/resource-grant-reach.ts › grantedResourceIds` shape, never a
 * query per row. SQL twin: `dopl_ontology_share_level`.
 *
 * ⚠ ABSENT = `none`, the same answer as a stored `'none'` (spec I4): unsharing
 * DELETES the row, it never writes a level.
 */
export type OntologyShareReach = ReadonlyMap<string, OntologyLevel>;

/** The empty reach — a solo container, or a caller in no channel at all. */
export const NO_ONTOLOGY_SHARES: OntologyShareReach = new Map();

/**
 * The caller's level THROUGH A SHARE, with the refusal that rides it.
 *
 * 🔒 **A SHARED CREDENTIAL IS NEVER WIDENED BY A SHARE** — it has no membership
 * of the channel to read the share THROUGH, refused here as `canSeeBase` refuses
 * it before the grant set (M-10 / F-336) and as `dopl_ontology_readable`'s share
 * arm refuses it in SQL. ⚠ THE SHARE ARM ONLY: a shared credential locked to the
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
 * MAY THE CALLER SEE THIS ONTOLOGY — the container, OR a share at `view`+.
 *
 * ⚠ **THE SHARE IS AN `OR` BESIDE A CLOSED GROUP, NEVER A TERM INSIDE ONE.** A
 * share's reader is by definition NOT in the ontology's container, so an arm
 * conjoined with the container test could only narrow — the share row would be a
 * row nothing reads. The defect `20260923140000_grant_read_arm.sql` §3b records
 * for the knowledge children; pinned here in both directions.
 *
 * ⚠ **Q8 — THE CLUSTER IS THE BOUNDARY.** A shared-in reader sees this cluster's
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
 * MAY THE CALLER EDIT THIS ONTOLOGY — the twin of `dopl_ontology_writable`.
 *
 * ⚠ `'member'` is the app-side name for the DB's legacy `'editor'` rung
 * (`20260825140000`'s rank `CASE` maps both to 1), so the container arm is
 * `is_current_workspace_member(workspace_id,'editor')` written in the role
 * vocabulary this tree actually uses.
 *
 * ⚠ **Q9 IS NOT ANSWERED HERE, ON PURPOSE.** Samuel's ruling — a WRITE needs
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
 *  of the shared-credential refusal. ⚠ A deliberate mirror of the arms above
 *  (`knowledge/server/service-shared.ts › needsGrantArm`'s shape): a caller
 *  reading their OWN container's board asks the share table nothing. */
export function needsShareArm(
  ctx: OntologyContext,
  cluster: OntologyClusterScope
): boolean {
  return !inOwnContainer(ctx, cluster) && !isSharedCredential(ctx);
}
