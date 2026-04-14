// ── Entry types (mirrored from src/types/entry.ts) ─────────────────

export interface Entry {
  id: string;
  source_url: string;
  source_platform: string;
  source_author: string | null;
  source_date: string | null;
  readme: string | null;
  agents_md: string | null;
  manifest: ManifestJson | null;
  title: string | null;
  summary: string | null;
  use_case: string | null;
  complexity: "simple" | "moderate" | "complex" | "advanced" | null;
  status: "pending" | "processing" | "complete" | "error";
  raw_content: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  thumbnail_url: string | null;
  ingested_at: string | null;
}

export interface ManifestJson {
  version: string;
  title: string;
  description: string;
  use_case: { primary: string; secondary: string[] };
  complexity: string;
  tools: { name: string; role: string; required: boolean; alternatives?: string[] }[];
  integrations: { from: string; to: string; method: string; description: string }[];
  languages: string[];
  frameworks: string[];
  patterns: string[];
  estimated_setup_time: string;
  tags: string[];
}

// ── Canvas types (mirrored from MCP types) ─────────────────────────

export interface CanvasPanel {
  id: string;
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  x: number;
  y: number;
  added_at: string;
}

// ── Cluster types ──────────────────────────────────────────────────

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  panel_count: number;
}

export interface ClusterDetail extends ClusterRow {
  entries: {
    entry_id: string;
    title: string | null;
    summary: string | null;
    readme: string | null;
    agents_md: string | null;
  }[];
}

// ── Search types ───────────────────────────────────────────────────

export interface SearchResult {
  entries: {
    entry_id: string;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    relevance_explanation?: string;
  }[];
  synthesis?: {
    recommendation: string;
    composite_approach?: string;
  };
}

// ── Chat types ─────────────────────────────────────────────────────

export interface EntryReference {
  entry_id: string;
  title?: string;
  summary?: string;
  source_url?: string;
  complexity?: string;
}

export type ChatMessage =
  | { role: "user"; type: "text"; content: string }
  | { role: "ai"; type: "text"; content: string }
  | { role: "ai"; type: "streaming"; content: string }
  | { role: "ai"; type: "tool_activity"; toolName: string; status: "calling" | "done"; summary?: string }
  | { role: "ai"; type: "entry_cards"; entries: EntryReference[] };

// ── Ingestion types ────────────────────────────────────────────────

export interface IngestResponse {
  entry_id: string;
  status: string;
  stream_url?: string;
  title?: string | null;
}

export interface IngestionProgressEvent {
  type: string;
  message: string;
  step?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Page extraction types ──────────────────────────────────────────

export interface ExtractedPage {
  title: string;
  content: string;
  excerpt: string;
  url: string;
  siteName?: string;
  byline?: string;
  contentType: "article" | "tweet" | "github" | "reddit" | "generic";
  wordCount: number;
}
