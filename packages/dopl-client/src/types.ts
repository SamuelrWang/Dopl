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
  descriptor?: string | null;
  ingestion_tier?: "skeleton" | "full" | null;
  tags?: { tag_type: string; tag_value: string }[];
  sources?: { source_type: string; url: string | null }[];
}

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

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  panel_count: number;
}

export interface WorkspaceSummary {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface ResolvedWorkspace {
  workspace: WorkspaceSummary;
  role: WorkspaceRole;
}

export interface ClusterDetailEntry {
  entry_id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  readme: string | null;
  agents_md: string | null;
}

export interface ClusterAttachedKnowledgeBase {
  knowledge_base_id: string;
  slug: string;
  name: string;
  description: string | null;
  agent_write_enabled: boolean;
  added_at: string;
  entries_index: Array<{
    entry_id: string;
    title: string;
    folder_path: string | null;
  }>;
}

export interface ClusterAttachedSkill {
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "draft";
  when_to_use: string;
  body: string;
  added_at: string;
}

export interface ClusterDetail extends ClusterRow {
  entries: ClusterDetailEntry[];
  knowledge_bases: ClusterAttachedKnowledgeBase[];
  skills: ClusterAttachedSkill[];
}

export interface ClusterKnowledgeEntry {
  entry_id: string;
  knowledge_base_slug: string;
  title: string;
  body: string;
  folder_path: string | null;
  updated_at: string;
}

export interface ClusterSkillFull {
  skill_slug: string;
  name: string;
  description: string;
  when_to_use: string;
  status: "active" | "draft";
  files: Array<{
    name: string;
    body: string;
  }>;
}

export type CanvasPanelType =
  | "entry"
  | "chat"
  | "connection"
  | "browse"
  | "cluster-brain";

export interface CanvasPanel {
  id: string;
  entry_id: string | null;
  panel_type: CanvasPanelType;
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

export type MemoryScope = "workspace" | "personal";

export interface BrainMemory {
  id: string;
  content: string;
  scope?: MemoryScope;
  /** True when the memory was authored by the calling user. */
  is_mine?: boolean;
}

export interface BrainData {
  instructions: string;
  memories: BrainMemory[];
  /**
   * Monotonic counter bumped on every brain `instructions` change.
   * `sync_skills` writes this version next to the skill on disk and
   * skips re-writing when the on-disk and server versions match.
   * Defaults to 1 for newly-minted brains, 0 for "no brain row exists
   * yet" (an empty/thin-pointer skill).
   */
  brain_version?: number;
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

export interface PrepareIngestResult {
  status: "ready" | "already_exists";
  entry_id: string;
  slug: string | null;
  title?: string | null;
  message?: string;
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

export interface PendingIngestItem {
  entry_id: string;
  url: string;
  queued_at: string;
}

export interface PendingStatus {
  pending_ingestions: number;
  recent: PendingIngestItem[];
}

export interface Pack {
  id: string;
  name: string;
  description: string | null;
  sdk_version: string | null;
  repo_url: string;
  last_synced_at: string | null;
  last_commit_sha: string | null;
}

export interface PackFileMeta {
  pack_id: string;
  path: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  category: string | null;
  updated_at: string;
}

export interface PackFile extends PackFileMeta {
  body: string;
  frontmatter: Record<string, unknown>;
}
