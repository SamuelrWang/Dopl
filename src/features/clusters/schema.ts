import { safeLabel } from "@/shared/lib/safe-label";

/**
 * A cluster name is printed by `dopl_map` at session start (every cluster, one
 * line each) and by every `dopl_cluster` result, so it is a label an agent
 * reads as the server speaking. Charset-bounded per `@/shared/lib/safe-label`.
 *
 * `clusters_editor_update` is a `public` UPDATE policy and `authenticated`
 * holds the UPDATE privilege, so any workspace editor can rename a cluster
 * straight through PostgREST without passing this schema: the matching DB
 * CHECK is the half that actually holds, and this is the half that produces a
 * readable error. `description` stays prose.
 *
 * Lives here rather than in the route so the collection route (POST) and the
 * `[slug]` route (PATCH) share one definition instead of importing each
 * other's module.
 */
export const ClusterNameSchema = safeLabel("Cluster name", 120);
