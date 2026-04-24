import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { CanvasContextPayload } from "../canvas-context";

const supabase = supabaseAdmin();

/**
 * Cluster-brain tools are callable from two places:
 *   - From a chat panel inside a cluster (scope === "cluster").
 *     The tool's cluster_slug argument must match canvasContext.clusterSlug.
 *   - If the chat is canvas-scoped (or context is missing), the AI can
 *     edit any cluster the user owns. Ownership is enforced inside each
 *     brain endpoint via cluster.user_id checks.
 *
 * Returns a string error message if the call should be rejected, or null
 * if it's allowed to proceed.
 */
export function enforceClusterEditScope(
  targetSlug: string,
  canvasContext: CanvasContextPayload | undefined
): string | null {
  if (!targetSlug || typeof targetSlug !== "string") {
    return "cluster_slug is required.";
  }
  if (canvasContext?.scope === "cluster") {
    if (!canvasContext.clusterSlug) {
      return "This chat is inside a cluster that hasn't finished syncing yet. Try again in a moment.";
    }
    if (targetSlug !== canvasContext.clusterSlug) {
      return `This chat is scoped to cluster "${canvasContext.clusterName || canvasContext.clusterSlug}" and can only edit that cluster's brain. To edit "${targetSlug}", use a chat panel outside any cluster.`;
    }
  }
  return null;
}

/**
 * Fetch a cluster row scoped to the owner, or return an error string.
 */
export async function getClusterForUser(
  slug: string,
  userId: string
): Promise<
  | { ok: true; cluster: { id: string; slug: string; name: string } }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("user_id", userId)
    .single();
  if (error || !data) return { ok: false, error: `Cluster "${slug}" not found.` };
  return { ok: true, cluster: data };
}
