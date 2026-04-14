import { supabaseAdmin } from "@/lib/supabase";
import { slugifyClusterName } from "@/lib/clusters/slug";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/lib/config";
import { generateEmbedding } from "@/lib/ai";
import type {
  PublishedClusterSummary,
  PublishedClusterDetail,
  PublishedPanel,
  PublishClusterRequest,
  UpdatePublishedClusterRequest,
  PanelPositionUpdate,
} from "./types";

// ── Publish ─────────────────────────────────────────────────────────

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

  // Generate a globally unique slug for the published URL
  const { data: existingSlugs } = await db
    .from("published_clusters")
    .select("slug");
  const slugList = (existingSlugs || []).map((r) => r.slug);
  const slug = slugifyClusterName(req.title, slugList);

  // Create the published cluster record
  const { data: published, error: pubError } = await db
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
    .select("id, slug, title, description, category, thumbnail_url, fork_count, status, created_at, updated_at")
    .single();

  if (pubError || !published) {
    throw pubError || new Error("Failed to create published cluster");
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
    author: {
      id: userId,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
    },
    panel_count: entryIds.length,
  };
}

// ── List user's own posts ───────────────────────────────────────────

export async function listMyPublishedClusters(
  userId: string
): Promise<PublishedClusterSummary[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("published_clusters")
    .select("id, slug, title, description, category, thumbnail_url, fork_count, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];

  // Get panel counts
  const ids = rows.map((r) => r.id);
  const { data: panelCounts } = await db
    .from("published_cluster_panels")
    .select("published_cluster_id")
    .in("published_cluster_id", ids);

  const countMap = new Map<string, number>();
  for (const row of panelCounts || []) {
    countMap.set(
      row.published_cluster_id,
      (countMap.get(row.published_cluster_id) || 0) + 1
    );
  }

  // Get author info
  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .single();

  return rows.map((r) => ({
    ...r,
    author: {
      id: userId,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
    },
    panel_count: countMap.get(r.id) || 0,
  }));
}

// ── List public published clusters (gallery) ────────────────────────

export async function listPublishedClusters(opts?: {
  page?: number;
  limit?: number;
  sort?: "popular" | "newest";
  category?: string;
}): Promise<{ items: PublishedClusterSummary[]; total: number }> {
  const db = supabaseAdmin();
  const page = opts?.page || 1;
  const limit = opts?.limit || 20;
  const offset = (page - 1) * limit;

  let query = db
    .from("published_clusters")
    .select("id, slug, title, description, category, thumbnail_url, fork_count, status, created_at, updated_at, user_id", { count: "exact" })
    .eq("status", "published");

  if (opts?.category) {
    query = query.eq("category", opts.category);
  }

  if (opts?.sort === "popular") {
    query = query.order("fork_count", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return { items: [], total: 0 };

  // Get panel counts
  const ids = rows.map((r) => r.id);
  const { data: panelCounts } = await db
    .from("published_cluster_panels")
    .select("published_cluster_id")
    .in("published_cluster_id", ids);

  const countMap = new Map<string, number>();
  for (const row of panelCounts || []) {
    countMap.set(
      row.published_cluster_id,
      (countMap.get(row.published_cluster_id) || 0) + 1
    );
  }

  // Get unique author IDs and fetch profiles
  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", authorIds);

  const profileMap = new Map(
    (profiles || []).map((p) => [p.id, p])
  );

  const items: PublishedClusterSummary[] = rows.map((r) => {
    const profile = profileMap.get(r.user_id);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description || "",
      category: r.category,
      thumbnail_url: r.thumbnail_url,
      fork_count: r.fork_count,
      status: r.status as PublishedClusterSummary["status"],
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: {
        id: r.user_id,
        display_name: profile?.display_name || null,
        avatar_url: profile?.avatar_url || null,
      },
      panel_count: countMap.get(r.id) || 0,
    };
  });

  return { items, total: count || 0 };
}

// ── Get full published cluster detail ───────────────────────────────

export async function getPublishedCluster(
  slug: string
): Promise<PublishedClusterDetail> {
  const db = supabaseAdmin();

  // Fetch the published cluster
  const { data: pc, error } = await db
    .from("published_clusters")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !pc) {
    throw new Error(`Published cluster not found: ${slug}`);
  }

  // Fetch panels
  const { data: panels } = await db
    .from("published_cluster_panels")
    .select("id, entry_id, title, summary, source_url, x, y, width, height")
    .eq("published_cluster_id", pc.id);

  // Fetch brain
  const { data: brain } = await db
    .from("published_cluster_brains")
    .select("instructions")
    .eq("published_cluster_id", pc.id)
    .single();

  // Fetch author profile
  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, avatar_url, bio, website_url, twitter_handle, github_username")
    .eq("id", pc.user_id)
    .single();

  // Fetch entry data for chat context
  const entryIds = (panels || []).map((p) => p.entry_id);
  let entries: PublishedClusterDetail["entries"] = [];

  if (entryIds.length > 0) {
    const { data: entryRows } = await db
      .from("entries")
      .select("id, title, summary, source_url, source_platform, readme, agents_md")
      .in("id", entryIds);

    entries = (entryRows || []).map((e) => ({
      entry_id: e.id,
      title: e.title,
      summary: e.summary,
      source_url: e.source_url,
      source_platform: e.source_platform,
      readme: e.readme
        ? e.readme.slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD)
        : null,
      agents_md: e.agents_md
        ? e.agents_md.slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD)
        : null,
    }));
  }

  return {
    id: pc.id,
    cluster_id: pc.cluster_id,
    slug: pc.slug,
    title: pc.title,
    description: pc.description || "",
    category: pc.category,
    thumbnail_url: pc.thumbnail_url,
    fork_count: pc.fork_count,
    status: pc.status,
    created_at: pc.created_at,
    updated_at: pc.updated_at,
    panels: (panels || []) as PublishedPanel[],
    brain_instructions: brain?.instructions || "",
    author: {
      id: pc.user_id,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
      bio: profile?.bio || null,
      website_url: profile?.website_url || null,
      twitter_handle: profile?.twitter_handle || null,
      github_username: profile?.github_username || null,
    },
    entries,
    panel_count: (panels || []).length,
  };
}

// ── Update published cluster metadata ───────────────────────────────

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

// ── Delete (archive) published cluster ──────────────────────────────

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

// ── Update panel positions (creator editing) ────────────────────────

export async function updatePanelPositions(
  slug: string,
  userId: string,
  updates: PanelPositionUpdate[]
): Promise<void> {
  const db = supabaseAdmin();

  // Verify ownership
  const { data: pc, error: lookupError } = await db
    .from("published_clusters")
    .select("id, user_id")
    .eq("slug", slug)
    .single();

  if (lookupError || !pc) throw new Error(`Published cluster not found: ${slug}`);
  if (pc.user_id !== userId) throw new Error("Not authorized");

  // Update each panel's position
  for (const update of updates) {
    const { error } = await db
      .from("published_cluster_panels")
      .update({ x: update.x, y: update.y })
      .eq("id", update.id)
      .eq("published_cluster_id", pc.id);

    if (error) throw error;
  }
}

// ── Fork / Import ───────────────────────────────────────────────────

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

// ── Embedding helper ────────────────────────────────────────────────

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

// ── Semantic search ─────────────────────────────────────────────────

export async function searchPublishedClusters(opts: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<PublishedClusterSummary[]> {
  const db = supabaseAdmin();
  const limit = opts.limit || 20;

  // Generate embedding for the search query
  const embedding = await generateEmbedding(opts.query);

  // Call the RPC function
  const { data, error } = await db.rpc("search_published_clusters", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.4,
    match_count: limit,
    filter_category: opts.category || null,
  });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];

  // Get panel counts
  const ids = rows.map((r: { id: string }) => r.id);
  const { data: panelCounts } = await db
    .from("published_cluster_panels")
    .select("published_cluster_id")
    .in("published_cluster_id", ids);

  const countMap = new Map<string, number>();
  for (const row of panelCounts || []) {
    countMap.set(
      row.published_cluster_id,
      (countMap.get(row.published_cluster_id) || 0) + 1
    );
  }

  // Get author profiles
  const authorIds = [...new Set(rows.map((r: { user_id: string }) => r.user_id))];
  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", authorIds);

  const profileMap = new Map(
    (profiles || []).map((p: { id: string; display_name: string | null; avatar_url: string | null }) => [p.id, p])
  );

  return rows.map((r: {
    id: string;
    slug: string;
    title: string;
    description: string;
    category: string | null;
    thumbnail_url: string | null;
    fork_count: number;
    user_id: string;
    created_at: string;
    updated_at: string;
    similarity: number;
  }) => {
    const profile = profileMap.get(r.user_id);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description || "",
      category: r.category,
      thumbnail_url: r.thumbnail_url,
      fork_count: r.fork_count,
      status: "published" as const,
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: {
        id: r.user_id,
        display_name: profile?.display_name || null,
        avatar_url: profile?.avatar_url || null,
      },
      panel_count: countMap.get(r.id) || 0,
    };
  });
}
