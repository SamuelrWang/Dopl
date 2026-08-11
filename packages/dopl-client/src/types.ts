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

export interface WorkspaceSummary {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  publicId: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Workspace summary plus the caller's role on it. Returned by
 * `client.listWorkspaces()` so the agent can pick a workspace to switch
 * into without a second round trip to discover the role.
 */
export interface WorkspaceListItem extends WorkspaceSummary {
  role: WorkspaceRole;
}

// Mirrors the DB enum on `workspace_members.role` post the editor →
// member rename (migration 20260502130000_editor_to_member). Older
// builds of this client typed the middle role as "editor"; the value
// has been migrated in-place server-side.
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface ResolvedWorkspace {
  workspace: WorkspaceSummary;
  role: WorkspaceRole;
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
