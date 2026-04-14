import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { generateEmbedding } from "@/lib/ai";

export interface SearchResult {
  entry_id: string;
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
  }
): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc("search_entries", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: options?.threshold || 0.6,
    match_count: options?.maxResults || 10,
    filter_tags: options?.tags || null,
    filter_use_case: options?.useCase || null,
    filter_complexity: options?.complexity || null,
    filter_entry_ids: options?.entryIds || null,
  });

  if (error) {
    console.error("Search failed:", error);
    throw error;
  }

  const rpcRows = (data || []) as Omit<SearchResult, "source_platform" | "created_at">[];

  if (rpcRows.length === 0) {
    return [];
  }

  // Hydrate source_platform and created_at via a follow-up select.
  // The RPC (search_entries) does not return these columns.
  const ids = rpcRows.map((r) => r.entry_id);
  const { data: hydrated, error: hydrateError } = await supabase
    .from("entries")
    .select("id, source_platform, created_at")
    .in("id", ids);

  if (hydrateError) {
    console.error("Search hydration failed:", hydrateError);
    throw hydrateError;
  }

  const byId = new Map<string, { source_platform: string | null; created_at: string | null }>();
  for (const row of hydrated || []) {
    byId.set(row.id, {
      source_platform: row.source_platform ?? null,
      created_at: row.created_at ?? null,
    });
  }

  return rpcRows.map((r) => ({
    ...r,
    source_platform: byId.get(r.entry_id)?.source_platform ?? null,
    created_at: byId.get(r.entry_id)?.created_at ?? null,
  }));
}
