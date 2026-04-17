export interface DoplEntry {
  id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string | null;
  use_case: string | null;
  complexity: string | null;
  status: "pending" | "pending_ingestion" | "processing" | "complete" | "error";
  readme: string | null;
  agents_md: string | null;
  manifest: Record<string, unknown> | null;
  // Skeleton-tier entries (ingestion_tier === "skeleton") carry ONLY the
  // descriptor — readme, agents_md, and manifest are null for them.
  // Render descriptor as the primary body when ingestion_tier is
  // "skeleton".
  descriptor?: string | null;
  ingestion_tier?: "skeleton" | "full" | null;
  tags?: { tag_type: string; tag_value: string }[];
  sources?: { source_type: string; url: string | null }[];
}

// SearchResult after the client-only-synthesis pivot: `synthesis` and
// per-entry `relevance_explanation` fields are gone. Agents format
// recommendations and relevance blurbs in their own context.
export interface SearchResult {
  entries: {
    entry_id: string;
    slug: string | null;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    descriptor?: string | null;
    ingestion_tier?: "skeleton" | "full" | null;
  }[];
}

/**
 * Response from POST /api/build after the client-only-synthesis pivot.
 * Server retrieves candidate entries and returns a pre-substituted
 * synthesis prompt. The agent runs the prompt in its own context.
 */
export interface BuildResult {
  status: "ready" | "no_matches";
  brief: string;
  constraints:
    | {
        preferred_tools?: string[];
        excluded_tools?: string[];
        max_complexity?: string;
        budget_context?: string;
      }
    | null;
  entries: Array<{
    entry_id: string;
    slug: string | null;
    title: string | null;
    similarity: number;
  }>;
  prompt: string;
  instructions: string;
}

export interface ListResult {
  entries: DoplEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ── Cluster types ────────────────────────────────────────────────────

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  panel_count: number;
}

export interface ClusterDetailEntry {
  entry_id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  readme: string | null;
  agents_md: string | null;
}

export interface ClusterDetail extends ClusterRow {
  entries: ClusterDetailEntry[];
}

// ── Canvas types ────────────────────────────────────────────────────

export interface CanvasPanel {
  id: string;
  entry_id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  x: number;
  y: number;
  added_at: string;
}

export interface ClusterQueryResult {
  cluster_slug: string;
  results: {
    entry_id: string;
    slug: string | null;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
  }[];
}

// ── Skill generation types ─────────────────────────────────────────

export interface BrainMemory {
  id: string;
  content: string;
}

export interface BrainData {
  instructions: string;
  memories: BrainMemory[];
}

export interface ClusterSkillParams {
  slug: string;
  name: string;
  brain: BrainData;
  entries: ClusterDetailEntry[];
}

export interface ClusterSummary {
  slug: string;
  name: string;
  oneLiner: string;
  tools: string[];
}

// ── Agent-driven ingestion types ──────────────────────────────────

/**
 * Response from POST /api/ingest/prepare. The agent runs the prompts in
 * its own Claude context and follows up with POST /api/ingest/submit.
 */
export interface PrepareIngestResult {
  status: "ready" | "already_exists";
  entry_id: string;
  slug: string | null;
  title?: string | null;
  message?: string;
  // Only set when status === "ready":
  source_url?: string;
  source_platform?: string;
  thumbnail_url?: string | null;
  gathered_content?: string;
  gathered_content_chars?: number;
  images?: Array<{
    image_id: string;
    base64: string;
    mimeType: string;
  }>;
  prompts?: {
    content_type: string;
    classify_content: string;
    manifest_template: string;
    readme_templates: {
      setup: string;
      knowledge: string;
      article: string;
      reference: string;
    };
    agents_md_templates: {
      setup: string;
      knowledge: string;
      reference: string;
    };
    tags_fallback: string;
    image_vision: string;
  };
  instructions?: string;
}

/**
 * Input payload the agent assembles after running the prepare prompts.
 * Mirrors IngestSubmitSchema in src/types/api.ts.
 */
export interface SubmitIngestedEntryInput {
  entry_id: string;
  content_type:
    | "setup"
    | "tutorial"
    | "knowledge"
    | "article"
    | "reference"
    | "resource";
  source_type: string;
  manifest: Record<string, unknown> & {
    title: string;
    description: string;
    use_case: { primary: string; secondary?: string[] };
    complexity: "simple" | "moderate" | "complex" | "advanced";
  };
  readme: string;
  agents_md: string;
  tags: Array<{ tag_type: string; tag_value: string }>;
  image_analyses?: Array<{
    image_id?: string;
    source_type:
      | "code_screenshot"
      | "architecture_diagram"
      | "image"
      | "other";
    raw_content: string;
    extracted_content: string;
    metadata?: Record<string, unknown>;
  }>;
  content_classification?: {
    sections?: Array<{
      title: string;
      classification: "EXECUTABLE" | "TACTICAL" | "CONTEXT" | "SKIP";
      reason: string;
      content_preview: string;
    }>;
    stats?: Record<string, unknown>;
    preservation_notes?: string[];
  };
}

export interface SubmitIngestedEntryResult {
  status: "complete";
  entry_id: string;
  slug: string;
  title: string;
  use_case: string;
  complexity: string;
  content_type: string;
}

// ── Pending ingestion status (site-chat queued URLs) ─────────────────

export interface PendingIngestItem {
  entry_id: string;
  url: string;
  queued_at: string;
}

/**
 * Response from GET /api/ingest/pending. Surfaced to the agent via the
 * `_dopl_status` footer the MCP server appends to every tool response,
 * and via the `list_pending_ingests` tool.
 */
export interface PendingStatus {
  pending_ingestions: number;
  recent: PendingIngestItem[];
}
