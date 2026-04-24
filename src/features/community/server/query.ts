import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { generateEmbedding } from "@/lib/ai";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import type {
  PublishedClusterSummary,
  PublishedClusterDetail,
  PublishedPanel,
} from "./types";

/**
 * User-owned published clusters for the "My Posts" view. Always
 * user-scoped — never leaks other users' published state.
 */
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

/** Public gallery — status='published' only, paginated, optional category filter. */
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

/**
 * Full published-cluster detail for the public detail page + chat
 * context. Only surfaces approved entries — pending/denied entries
 * referenced by a published cluster do not leak into the public
 * chat context.
 */
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
    // Only surface approved entries — pending/denied entries referenced
    // by a published cluster should not leak into the public chat context.
    const [entryRowsRes, tagRowsRes] = await Promise.all([
      db
        .from("entries")
        .select(
          "id, title, summary, source_url, source_platform, readme, agents_md, thumbnail_url, use_case, complexity, content_type, manifest, ingested_at, created_at"
        )
        .in("id", entryIds)
        .eq("moderation_status", "approved"),
      // Tags live in a separate table; fetch in parallel and group by entry.
      db
        .from("tags")
        .select("entry_id, tag_type, tag_value")
        .in("entry_id", entryIds),
    ]);

    const tagsByEntry = new Map<string, Array<{ tag_type: string; tag_value: string }>>();
    for (const row of tagRowsRes.data || []) {
      const arr = tagsByEntry.get(row.entry_id) || [];
      arr.push({ tag_type: row.tag_type, tag_value: row.tag_value });
      tagsByEntry.set(row.entry_id, arr);
    }

    entries = (entryRowsRes.data || []).map((e) => {
      const manifest = e.manifest as Record<string, unknown> | null;
      // Best-effort extract source author from manifest.source_author or
      // nested shapes — mirrors what the user canvas already handles.
      const sourceAuthor =
        (manifest && typeof manifest["source_author"] === "string"
          ? (manifest["source_author"] as string)
          : null) ?? null;
      return {
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
        source_author: sourceAuthor,
        thumbnail_url: e.thumbnail_url ?? null,
        use_case: e.use_case ?? null,
        complexity: e.complexity ?? null,
        content_type: e.content_type ?? null,
        manifest: manifest,
        created_at: e.ingested_at ?? e.created_at ?? null,
        tags: tagsByEntry.get(e.id) || [],
      };
    });
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

/**
 * Semantic search across published clusters. Runs an embedding on the
 * query and calls the `search_published_clusters` RPC (cosine similarity
 * against `published_clusters.embedding`, threshold 0.4).
 */
export async function searchPublishedClusters(opts: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<PublishedClusterSummary[]> {
  const db = supabaseAdmin();
  const limit = opts.limit || 20;

  const embedding = await generateEmbedding(opts.query);

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
