import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  PublishedClusterSummary,
  UpdatePublishedClusterRequest,
  PanelPositionUpdate,
} from "./types";

/** Update a published cluster's metadata (title/description/category/status). */
export async function updatePublishedCluster(
  slug: string,
  userId: string,
  updates: UpdatePublishedClusterRequest
): Promise<PublishedClusterSummary> {
  const db = supabaseAdmin();

  // Verify ownership
  const { data: pc, error: lookupError } = await db
    .from("published_clusters")
    .select("id, user_id")
    .eq("slug", slug)
    .single();

  if (lookupError || !pc) throw new Error(`Published cluster not found: ${slug}`);
  if (pc.user_id !== userId) throw new Error("Not authorized");

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.title !== undefined) updateData.title = updates.title;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.status !== undefined) updateData.status = updates.status;

  const { data: updated, error: updateError } = await db
    .from("published_clusters")
    .update(updateData)
    .eq("id", pc.id)
    .select("id, slug, title, description, category, thumbnail_url, fork_count, status, created_at, updated_at")
    .single();

  if (updateError || !updated) throw updateError || new Error("Update failed");

  // Get panel count
  const { data: panelCounts } = await db
    .from("published_cluster_panels")
    .select("id")
    .eq("published_cluster_id", pc.id);

  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .single();

  return {
    ...updated,
    author: {
      id: userId,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
    },
    panel_count: (panelCounts || []).length,
  };
}

/** Archive (soft-delete) a published cluster. */
export async function deletePublishedCluster(
  slug: string,
  userId: string
): Promise<void> {
  const db = supabaseAdmin();

  const { data: pc, error: lookupError } = await db
    .from("published_clusters")
    .select("id, user_id")
    .eq("slug", slug)
    .single();

  if (lookupError || !pc) throw new Error(`Published cluster not found: ${slug}`);
  if (pc.user_id !== userId) throw new Error("Not authorized");

  const { error } = await db
    .from("published_clusters")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", pc.id);

  if (error) throw error;
}

/** Creator edits panel positions on the published snapshot. */
export async function updatePanelPositions(
  slug: string,
  userId: string,
  updates: PanelPositionUpdate[]
): Promise<void> {
  const db = supabaseAdmin();

  const { data: pc, error: lookupError } = await db
    .from("published_clusters")
    .select("id, user_id")
    .eq("slug", slug)
    .single();

  if (lookupError || !pc) throw new Error(`Published cluster not found: ${slug}`);
  if (pc.user_id !== userId) throw new Error("Not authorized");

  for (const update of updates) {
    const { error } = await db
      .from("published_cluster_panels")
      .update({ x: update.x, y: update.y })
      .eq("id", update.id)
      .eq("published_cluster_id", pc.id);

    if (error) throw error;
  }
}
