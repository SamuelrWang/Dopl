import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { generateEmbedding } from "@/shared/lib/ai";
import { generatePublishedSlug, randomSuffix } from "./published-slug";
import type {
  PublishedClusterSummary,
  PublishClusterRequest,
} from "./types";

/**
 * Publish a user's cluster to the community gallery. Snapshots panel
 * positions, brain instructions, and kicks off an embedding generation
 * in the background.
 *
 * Slug collision handling: generatePublishedSlug includes 4 random base36
 * chars (~1.6M combinations) so collisions are rare; the UNIQUE constraint
 * + 5-attempt retry is the backstop. Mirrors the entry pipeline's
 * `persistWithSlugRetry` pattern.
 */
export async function publishCluster(
  clusterId: string,
  userId: string,
  req: PublishClusterRequest
): Promise<PublishedClusterSummary> {
  const db = supabaseAdmin();

  // Verify the cluster exists and belongs to this user
  const { data: cluster, error: clusterError } = await db
    .from("clusters")
    .select("id, slug, name, user_id")
    .eq("id", clusterId)
    .single();

  if (clusterError || !cluster) {
    throw new Error("Cluster not found");
  }
  if (cluster.user_id && cluster.user_id !== userId) {
    throw new Error("Not authorized to publish this cluster");
  }

  let slug = generatePublishedSlug(req.title);

  const MAX_SLUG_ATTEMPTS = 5;
  let published: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    category: string | null;
    thumbnail_url: string | null;
    fork_count: number;
    status: PublishedClusterSummary["status"];
    created_at: string;
    updated_at: string;
  } | null = null;
  let lastPubError: unknown = null;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const { data, error } = await db
      .from("published_clusters")
      .insert({
        cluster_id: clusterId,
        user_id: userId,
        slug,
        title: req.title,
        description: req.description || "",
        category: req.category || null,
        status: "published",
      })
      .select(
        "id, slug, title, description, category, thumbnail_url, fork_count, status, created_at, updated_at"
      )
      .single();

    if (!error && data) {
      published = data;
      break;
    }

    lastPubError = error;
    // 23505 = unique violation; retry with a fresh suffix. Anything
    // else is a real error — stop.
    if ((error as { code?: string } | null)?.code !== "23505") break;

    // Swap just the suffix, keep the readable base.
    const lastDash = slug.lastIndexOf("-");
    slug = lastDash > 0 ? `${slug.slice(0, lastDash)}-${randomSuffix()}` : `${slug}-${randomSuffix()}`;
  }

  if (!published) {
    throw lastPubError instanceof Error
      ? lastPubError
      : new Error("Failed to create published cluster (slug retries exhausted)");
  }

  // Snapshot panel positions: join cluster_panels with canvas_panels
  const { data: clusterPanels } = await db
    .from("cluster_panels")
    .select("entry_id")
    .eq("cluster_id", clusterId);

  const entryIds = (clusterPanels || []).map((p) => p.entry_id);

  if (entryIds.length > 0) {
    // Get canvas positions for these entries
    const { data: canvasPanels } = await db
      .from("canvas_panels")
      .select("entry_id, title, summary, source_url, x, y")
      .eq("user_id", userId)
      .in("entry_id", entryIds);

    const posMap = new Map(
      (canvasPanels || []).map((p) => [p.entry_id, p])
    );

    // Auto-layout entries that don't have canvas positions
    const PANEL_W = 520;
    const PANEL_H = 700;
    const GAP = 40;
    const COLS = 4;
    let autoIdx = 0;

    const panelRows = entryIds.map((eid) => {
      const cp = posMap.get(eid);
      if (cp) {
        return {
          published_cluster_id: published.id,
          entry_id: eid,
          title: cp.title,
          summary: cp.summary,
          source_url: cp.source_url,
          x: cp.x,
          y: cp.y,
          width: PANEL_W,
          height: PANEL_H,
        };
      }
      // Auto-layout in a grid
      const col = autoIdx % COLS;
      const row = Math.floor(autoIdx / COLS);
      autoIdx++;
      return {
        published_cluster_id: published.id,
        entry_id: eid,
        title: null,
        summary: null,
        source_url: null,
        x: col * (PANEL_W + GAP),
        y: row * (PANEL_H + GAP),
        width: PANEL_W,
        height: PANEL_H,
      };
    });

    // Fill in missing title/summary from entries table
    const { data: entries } = await db
      .from("entries")
      .select("id, title, summary, source_url")
      .in("id", entryIds);

    const entryMap = new Map(
      (entries || []).map((e) => [e.id, e])
    );

    for (const row of panelRows) {
      if (!row.title || !row.summary) {
        const entry = entryMap.get(row.entry_id);
        if (entry) {
          row.title = row.title || entry.title;
          row.summary = row.summary || entry.summary;
          row.source_url = row.source_url || entry.source_url;
        }
      }
    }

    const { error: panelInsertError } = await db
      .from("published_cluster_panels")
      .insert(panelRows);

    if (panelInsertError) throw panelInsertError;
  }

  // Snapshot brain instructions
  const { data: brain } = await db
    .from("cluster_brains")
    .select("instructions")
    .eq("cluster_id", clusterId)
    .single();

  if (brain?.instructions) {
    const { error: brainError } = await db
      .from("published_cluster_brains")
      .insert({
        published_cluster_id: published.id,
        instructions: brain.instructions,
      });
    if (brainError) throw brainError;
  }

  // Generate embedding for semantic search (fire-and-forget)
  generateClusterEmbedding(published.id, req.title, req.description || "", entryIds, db).catch(() => {});

  // Fetch author info for return value
  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .single();

  return {
    ...published,
    description: published.description || "",
    author: {
      id: userId,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
    },
    panel_count: entryIds.length,
  };
}

async function generateClusterEmbedding(
  publishedClusterId: string,
  title: string,
  description: string,
  entryIds: string[],
  db: ReturnType<typeof supabaseAdmin>
): Promise<void> {
  // Build text to embed: title + description + entry summaries
  let text = `${title}. ${description}`;

  if (entryIds.length > 0) {
    const { data: entries } = await db
      .from("entries")
      .select("title, summary")
      .in("id", entryIds);

    if (entries) {
      const summaries = entries
        .map((e) => [e.title, e.summary].filter(Boolean).join(": "))
        .join(". ");
      text += `. Contains: ${summaries}`;
    }
  }

  // Truncate to ~8000 chars (embedding model limit is generous but no point sending excess)
  text = text.slice(0, 8000);

  const embedding = await generateEmbedding(text);

  await db
    .from("published_clusters")
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", publishedClusterId);
}
