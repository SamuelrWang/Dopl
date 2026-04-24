import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "@/features/clusters/slug";

/**
 * Fork (import) a published cluster into the current user's workspace:
 * creates a new `clusters` row, copies panels/brain, creates canvas
 * panels, records the fork in `cluster_forks`, and atomically bumps
 * the source's fork_count (RPC preferred, read-then-write fallback).
 *
 * Prevents self-fork and duplicate forks via the
 * (source_published_cluster_id, forked_by_user_id) UNIQUE constraint
 * on `cluster_forks`.
 */
export async function forkPublishedCluster(
  slug: string,
  userId: string
): Promise<{ clusterSlug: string; entryIds: string[] }> {
  const db = supabaseAdmin();

  // Load the published cluster
  const { data: pc, error: pcError } = await db
    .from("published_clusters")
    .select("id, cluster_id, title, slug, user_id")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (pcError || !pc) throw new Error(`Published cluster not found: ${slug}`);

  // Prevent self-fork
  if (pc.user_id === userId) throw new Error("Cannot import your own cluster");

  // Check for existing fork (UNIQUE constraint)
  const { data: existingFork } = await db
    .from("cluster_forks")
    .select("id")
    .eq("source_published_cluster_id", pc.id)
    .eq("forked_by_user_id", userId)
    .single();

  if (existingFork) throw new Error("You have already imported this cluster");

  // Load published panels
  const { data: panels } = await db
    .from("published_cluster_panels")
    .select("entry_id, title, summary, source_url, x, y")
    .eq("published_cluster_id", pc.id);

  const entryIds = (panels || []).map((p) => p.entry_id);

  // Load brain
  const { data: brain } = await db
    .from("published_cluster_brains")
    .select("instructions")
    .eq("published_cluster_id", pc.id)
    .single();

  // Create a new cluster for the user
  const { data: existingSlugs } = await db
    .from("clusters")
    .select("slug")
    .eq("user_id", userId);
  const slugList = (existingSlugs || []).map((r) => r.slug);
  const newSlug = slugifyClusterName(pc.title, slugList);

  const { data: newCluster, error: clusterError } = await db
    .from("clusters")
    .insert({
      name: pc.title,
      slug: newSlug,
      user_id: userId,
      forked_from_slug: pc.slug,
      forked_from_title: pc.title,
    })
    .select("id, slug")
    .single();

  if (clusterError || !newCluster) throw clusterError || new Error("Failed to create cluster");

  // Add entries to the new cluster
  if (entryIds.length > 0) {
    const clusterPanelRows = entryIds.map((eid) => ({
      cluster_id: newCluster.id,
      entry_id: eid,
    }));
    await db.from("cluster_panels").insert(clusterPanelRows);

    // Add entries to user's canvas
    for (const panel of panels || []) {
      await db
        .from("canvas_panels")
        .upsert(
          {
            user_id: userId,
            entry_id: panel.entry_id,
            title: panel.title,
            summary: panel.summary,
            source_url: panel.source_url,
            x: panel.x,
            y: panel.y,
          },
          { onConflict: "user_id,entry_id" }
        );
    }
  }

  // Copy brain instructions
  if (brain?.instructions) {
    await db.from("cluster_brains").insert({
      cluster_id: newCluster.id,
      user_id: userId,
      instructions: brain.instructions,
    });
  }

  // Record the fork
  await db.from("cluster_forks").insert({
    source_published_cluster_id: pc.id,
    forked_by_user_id: userId,
    created_cluster_id: newCluster.id,
  });

  // Atomic increment fork count via RPC, fallback to manual update
  const { error: rpcError } = await db.rpc("increment_fork_count", { pc_id: pc.id });
  if (rpcError) {
    // Fallback: read current count and increment
    const { data: current } = await db
      .from("published_clusters")
      .select("fork_count")
      .eq("id", pc.id)
      .single();
    if (current) {
      await db
        .from("published_clusters")
        .update({ fork_count: (current.fork_count || 0) + 1 })
        .eq("id", pc.id);
    }
  }

  return {
    clusterSlug: newCluster.slug,
    entryIds,
  };
}
