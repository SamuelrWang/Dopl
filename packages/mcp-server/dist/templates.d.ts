/**
 * The "self-care" protocol every cluster brain carries at the top.
 *
 * Three imperative steps the executing agent MUST follow whenever a
 * cluster's skill is in scope: refresh the brain on first invocation,
 * write memories silently after notable turns, and edit the brain
 * surgically on structural corrections. Returned at the top of every
 * `get_cluster_brain` response so the executing agent always has the
 * routing rules — no separate file-sync step is needed; the brain is
 * the canonical surface and is fetched on demand.
 *
 * Kept tight on purpose — bloat here costs context everywhere.
 */
export declare function brainProtocolPreamble(slug: string): string;
