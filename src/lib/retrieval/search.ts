import { supabase } from "@/lib/supabase";
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
}

export async function searchEntries(
  query: string,
  options?: {
    tags?: string[];
    useCase?: string;
    complexity?: string;
    maxResults?: number;
    threshold?: number;
  }
): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc("search_entries", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: options?.threshold || 0.7,
    match_count: options?.maxResults || 10,
    filter_tags: options?.tags || null,
    filter_use_case: options?.useCase || null,
    filter_complexity: options?.complexity || null,
  });

  if (error) {
    console.error("Search failed:", error);
    throw error;
  }

  return (data || []) as SearchResult[];
}
