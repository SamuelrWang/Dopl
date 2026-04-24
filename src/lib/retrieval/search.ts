import { supabaseAdmin } from "@/shared/supabase/admin";
const supabase = supabaseAdmin();
import { generateEmbedding } from "@/lib/ai";

export interface SearchResult {
  entry_id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  use_case: string | null;
  complexity: string | null;
  readme: string | null;
  agents_md: string | null;
  manifest: Record<string, unknown> | null;
  similarity: number;
  source_platform: string | null;
  created_at: string | null;
  // Skeleton-tier entries don't have readme/agents_md/manifest; the
  // descriptor is the only content they carry. Callers that want to
  // render or reason about a hit should fall back to descriptor when
  // readme is null. ingestion_tier lets the caller branch explicitly.
  descriptor: string | null;
  ingestion_tier: "skeleton" | "full" | null;
}

export async function searchEntries(
  query: string,
  options?: {
    tags?: string[];
    useCase?: string;
    complexity?: string;
    maxResults?: number;
    threshold?: number;
    entryIds?: string[];
    // Passed to the RPC's `caller_user_id` arg. Lets the owner of a
    // pending/rejected entry still find it via search while the
    // moderation_status='approved' filter applies to everyone else. Omit
    // or pass undefined for strict approved-only behavior (unauth / cron
    // paths).
    callerUserId?: string;
  }
): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc("search_entries", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: options?.threshold ?? 0.4,
    match_count: options?.maxResults || 10,
    filter_tags: options?.tags || null,
    filter_use_case: options?.useCase || null,
    filter_complexity: options?.complexity || null,
    filter_entry_ids: options?.entryIds || null,
    caller_user_id: options?.callerUserId ?? null,
  });

  if (error) {
    console.error("Search failed:", error);
    throw error;
  }

  const rpcRows = (data || []) as Omit<
    SearchResult,
    "source_platform" | "created_at" | "slug" | "descriptor" | "ingestion_tier"
  >[];

  if (rpcRows.length === 0) {
    return [];
  }

  // Hydrate columns that the RPC doesn't return. descriptor + ingestion_tier
  // matter for skeleton-tier entries — they have no readme/agents_md, so
  // the descriptor is the only readable content to hand a consumer.
  // Moderation filtering lives in the RPC itself (see the search_entries
  // migration) — no post-filter needed here.
  const ids = rpcRows.map((r) => r.entry_id);
  const { data: hydrated, error: hydrateError } = await supabase
    .from("entries")
    .select("id, slug, source_platform, created_at, descriptor, ingestion_tier")
    .in("id", ids);

  if (hydrateError) {
    console.error("Search hydration failed:", hydrateError);
    throw hydrateError;
  }

  const byId = new Map<
    string,
    {
      slug: string | null;
      source_platform: string | null;
      created_at: string | null;
      descriptor: string | null;
      ingestion_tier: "skeleton" | "full" | null;
    }
  >();
  for (const row of hydrated || []) {
    const r = row as {
      id: string;
      slug: string | null;
      source_platform: string | null;
      created_at: string | null;
      descriptor: string | null;
      ingestion_tier: "skeleton" | "full" | null;
    };
    byId.set(r.id, {
      slug: r.slug ?? null,
      source_platform: r.source_platform ?? null,
      created_at: r.created_at ?? null,
      descriptor: r.descriptor ?? null,
      ingestion_tier: r.ingestion_tier ?? null,
    });
  }

  return rpcRows.map((r) => ({
    ...r,
    slug: byId.get(r.entry_id)?.slug ?? null,
    source_platform: byId.get(r.entry_id)?.source_platform ?? null,
    created_at: byId.get(r.entry_id)?.created_at ?? null,
    descriptor: byId.get(r.entry_id)?.descriptor ?? null,
    ingestion_tier: byId.get(r.entry_id)?.ingestion_tier ?? null,
  }));
}
