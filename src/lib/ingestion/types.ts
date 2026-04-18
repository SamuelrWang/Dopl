export type ContentType = "setup" | "knowledge" | "resource" | "article" | "tutorial" | "reference";

export interface IngestInput {
  url: string;
  content: {
    text: string;
    images?: string[]; // base64 encoded
    links?: string[];
  };
  /** Supabase auth UUID of the user initiating the ingestion. Stored as
   * entries.ingested_by so admins can attribute entries and the owner
   * can later bypass the moderation filter on their own entries. */
  userId?: string;
}

export type SourceStatus = "ok" | "failed" | "skipped";

export type SourceStatusReason =
  | "http_4xx"
  | "http_5xx"
  | "timeout"
  | "access_denied_body"
  | "empty_content"
  | "unsupported_content_type"
  | "duplicate_url"
  | "extractor_error";

export interface ExtractedSource {
  url?: string;
  sourceType:
    | "post_text"
    | "tweet_text"
    | "tweet_thread"
    | "image"
    | "code_screenshot"
    | "architecture_diagram"
    | "blog_post"
    | "github_repo"
    | "github_file"
    | "instagram_post"
    | "reddit_post"
    | "other";
  rawContent: string;
  extractedContent?: string;
  contentMetadata?: Record<string, unknown>;
  parentSourceId?: string;
  depth: number;
  childLinks?: string[];
  /**
   * When omitted, `storeSources` treats the row as 'ok'. Explicit 'failed'
   * / 'skipped' rows are audit breadcrumbs for URLs the extractor
   * attempted but couldn't retrieve — they surface as `fetch_warnings`
   * on the prepare response so the agent knows what's missing.
   */
  status?: SourceStatus;
  statusReason?: SourceStatusReason;
  fetchStatusCode?: number;
}

export interface LinkFollowResult {
  url: string;
  type: "blog" | "github_repo" | "github_file" | "tweet" | "instagram" | "reddit" | "other";
  content: string;
  childLinks: string[];
  metadata: Record<string, unknown>;
}

export interface GeneratedArtifacts {
  title: string;
  summary: string;
  useCase: string;
  complexity: "simple" | "moderate" | "complex" | "advanced";
  readme: string;
  agentsMd: string;
  manifest: Record<string, unknown>;
  tags: { tagType: string; tagValue: string }[];
}

export interface ChunkData {
  content: string;
  chunkType: "readme" | "agents_md" | "raw_content" | "content" | "descriptor";
  chunkIndex: number;
}

export interface IngestionLog {
  entryId: string;
  step: string;
  status: "started" | "completed" | "error";
  details?: Record<string, unknown>;
  durationMs?: number;
}
