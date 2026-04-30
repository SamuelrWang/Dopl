import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "@/features/clusters/slug";
import { ENTRY_PANEL_SIZE } from "@/features/canvas/types";
import type { Cluster } from "@/features/canvas/types";

/**
 * Fork (import) a published cluster into the current user's workspace:
 * creates a new `clusters` row, copies panels/brain, materializes
 * `canvas_panels` rows the canvas loader can deserialize, registers
 * the new cluster in `canvas_state.clusters` JSONB so the canvas
 * outlines its grouping, records the fork attribution last (UNIQUE
 * constraint locks out retries on success), and atomically bumps the
 * source's fork_count.
 *
 * Prevents self-fork and duplicate forks via the
 * (source_published_cluster_id, forked_by_user_id) UNIQUE constraint
 * on `cluster_forks`.
 */
export async function forkPublishedCluster(
  slug: string,
  userId: string,
  workspaceId: string
): Promise<{ clusterSlug: string; entryIds: string[] }> {
  const db = supabaseAdmin();

  const { data: pc, error: pcError } = await db
    .from("published_clusters")
    .select("id, cluster_id, title, slug, user_id")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (pcError || !pc) throw new Error(`Published cluster not found: ${slug}`);

  if (pc.user_id === userId) throw new Error("Cannot import your own cluster");

  const { data: existingFork } = await db
    .from("cluster_forks")
    .select("id")
    .eq("source_published_cluster_id", pc.id)
    .eq("forked_by_user_id", userId)
    .single();

  if (existingFork) throw new Error("You have already imported this cluster");

  const { data: panels, error: panelsError } = await db
    .from("published_cluster_panels")
    .select("entry_id, title, summary, source_url, x, y")
    .eq("published_cluster_id", pc.id);
  if (panelsError) throw panelsError;

  const entryIds = (panels ?? []).map((p) => p.entry_id);

  // Batch-fetch full entry rows + tags in parallel — the canvas loader's
  // `dbRowToPanel` expects every field in `panel_data` (readme, manifest,
  // thumbnail, tags, ...). Without these, panels render with empty bodies
  // even when the row passes validation.
  const [entriesRes, tagRes, brainRes] = await Promise.all([
    entryIds.length > 0
      ? db
          .from("entries")
          .select(
            "id, title, summary, source_url, source_platform, source_author, thumbnail_url, use_case, complexity, content_type, readme, agents_md, manifest"
          )
          .in("id", entryIds)
      : Promise.resolve({ data: [], error: null }),
    entryIds.length > 0
      ? db
          .from("tags")
          .select("entry_id, tag_type, tag_value")
          .in("entry_id", entryIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("published_cluster_brains")
      .select("instructions")
      .eq("published_cluster_id", pc.id)
      .maybeSingle(),
  ]);

  if (entriesRes.error) throw entriesRes.error;
  if (tagRes.error) throw tagRes.error;
  if (brainRes.error) throw brainRes.error;

  const entryById = new Map(
    (entriesRes.data ?? []).map((e) => [e.id, e] as const)
  );
  const tagsByEntry = new Map<string, { tag_type: string; tag_value: string }[]>();
  for (const t of tagRes.data ?? []) {
    const list = tagsByEntry.get(t.entry_id) ?? [];
    list.push({ tag_type: t.tag_type, tag_value: t.tag_value });
    tagsByEntry.set(t.entry_id, list);
  }
  const brain = brainRes.data;

  // Create a new cluster scoped to the active canvas. Slug uniqueness
  // is per-canvas — two canvases can each hold a "my-fork" cluster.
  const { data: existingSlugs, error: slugsError } = await db
    .from("clusters")
    .select("slug")
    .eq("workspace_id", workspaceId);
  if (slugsError) throw slugsError;

  const slugList = (existingSlugs ?? []).map((r) => r.slug);
  const newSlug = slugifyClusterName(pc.title, slugList);

  const { data: newCluster, error: clusterError } = await db
    .from("clusters")
    .insert({
      name: pc.title,
      slug: newSlug,
      user_id: userId,
      workspace_id: workspaceId,
      forked_from_slug: pc.slug,
      forked_from_title: pc.title,
    })
    .select("id, slug")
    .single();

  if (clusterError || !newCluster) {
    throw clusterError || new Error("Failed to create cluster");
  }

  const generatedPanelIds: string[] = [];

  if (entryIds.length > 0) {
    const clusterPanelRows = entryIds.map((eid) => ({
      cluster_id: newCluster.id,
      entry_id: eid,
    }));
    const { error: cpError } = await db
      .from("cluster_panels")
      .insert(clusterPanelRows);
    if (cpError) throw cpError;

    // Materialize canvas_panels rows in the exact shape `dbRowToPanel`
    // expects. Deterministic `entry-fork-${entry_id}` panel ids are
    // stable across re-fork attempts and never collide with the
    // reducer's `entry-${nextPanelId}` numeric scheme.
    for (const panel of panels ?? []) {
      const entry = entryById.get(panel.entry_id);
      const tags = (tagsByEntry.get(panel.entry_id) ?? []).map((t) => ({
        type: t.tag_type,
        value: t.tag_value,
      }));
      const panelId = `entry-fork-${panel.entry_id}`;
      generatedPanelIds.push(panelId);

      const { error } = await db.from("canvas_panels").upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          panel_id: panelId,
          panel_type: "entry",
          entry_id: panel.entry_id,
          title: entry?.title ?? panel.title,
          summary: entry?.summary ?? panel.summary,
          source_url: entry?.source_url ?? panel.source_url,
          x: panel.x,
          y: panel.y,
          width: ENTRY_PANEL_SIZE.width,
          height: ENTRY_PANEL_SIZE.height,
          panel_data: {
            sourcePlatform: entry?.source_platform ?? null,
            sourceAuthor: entry?.source_author ?? null,
            thumbnailUrl: entry?.thumbnail_url ?? null,
            useCase: entry?.use_case ?? null,
            complexity: entry?.complexity ?? null,
            contentType: entry?.content_type ?? null,
            tags,
            readme: entry?.readme ?? "",
            agentsMd: entry?.agents_md ?? "",
            manifest: entry?.manifest ?? {},
            createdAt: new Date().toISOString(),
          },
        },
        { onConflict: "workspace_id,panel_id" }
      );
      if (error) throw error;
    }
  }

  if (brain?.instructions) {
    const { error: brainErr } = await db.from("cluster_brains").insert({
      cluster_id: newCluster.id,
      user_id: userId,
      workspace_id: workspaceId,
      instructions: brain.instructions,
    });
    if (brainErr) throw brainErr;
  }

  // Register the cluster in canvas_state.clusters JSONB so the canvas
  // loader includes it in the client state. Mirrors the pattern in
  // clusters/server/service.ts so cluster ids stay consistent across
  // origin paths (UI vs MCP vs fork).
  const { data: csRow, error: csReadError } = await db
    .from("canvas_state")
    .select("clusters")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (csReadError) throw csReadError;

  const existingClusters: Cluster[] = Array.isArray(csRow?.clusters)
    ? (csRow.clusters as Cluster[])
    : [];

  const newClusterEntry: Cluster = {
    id: `cluster-${newCluster.id}`,
    name: pc.title,
    panelIds: generatedPanelIds,
    createdAt: new Date().toISOString(),
    dbId: newCluster.id,
    slug: newCluster.slug,
  };

  const { error: csError } = await db
    .from("canvas_state")
    .upsert(
      {
        user_id: userId,
        workspace_id: workspaceId,
        clusters: [...existingClusters, newClusterEntry],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );
  if (csError) throw csError;

  // Atomic increment via RPC, fallback to read-then-write. The named
  // RPC may not exist in current migrations; the fallback covers it.
  const { error: rpcError } = await db.rpc("increment_fork_count", {
    pc_id: pc.id,
  });
  if (rpcError) {
    const { data: current, error: readErr } = await db
      .from("published_clusters")
      .select("fork_count")
      .eq("id", pc.id)
      .single();
    if (readErr) throw readErr;
    if (current) {
      const { error: updateErr } = await db
        .from("published_clusters")
        .update({ fork_count: (current.fork_count || 0) + 1 })
        .eq("id", pc.id);
      if (updateErr) throw updateErr;
    }
  }

  // Record the fork LAST. The UNIQUE (source_published_cluster_id,
  // forked_by_user_id) constraint locks out retries — only attribute
  // once everything above succeeded so a partial failure is retryable.
  const { error: forkRowError } = await db.from("cluster_forks").insert({
    source_published_cluster_id: pc.id,
    forked_by_user_id: userId,
    created_cluster_id: newCluster.id,
  });
  if (forkRowError) throw forkRowError;

  return {
    clusterSlug: newCluster.slug,
    entryIds,
  };
}
