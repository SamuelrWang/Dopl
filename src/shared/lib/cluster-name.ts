/**
 * Canonical display form for a cluster name: trimmed, internal whitespace
 * collapsed to single underscores, and uppercased — e.g. "my analysis" →
 * "MY_ANALYSIS".
 *
 * This is the single source of truth for cluster-name casing so the stored
 * name, the canvas tab rendering, and the agent's `dopl_cluster(op=list)`
 * output all agree. The URL slug is a separate concern and stays
 * lowercase-hyphen (see features/clusters/slug.ts).
 *
 * Lives in shared/ so both the clusters server service and the canvas
 * client components can import it without a cross-feature dependency.
 */
export function normalizeClusterName(name: string): string {
  return name.trim().replace(/\s+/g, "_").toUpperCase();
}
