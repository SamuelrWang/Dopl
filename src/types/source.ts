export type SourceType =
  | "tweet_text"
  | "tweet_thread"
  | "image"
  | "code_screenshot"
  | "architecture_diagram"
  | "blog_post"
  | "github_repo"
  | "github_file"
  | "other";

export interface Source {
  id: string;
  entry_id: string;
  url: string | null;
  source_type: SourceType;
  raw_content: string | null;
  extracted_content: string | null;
  content_metadata: Record<string, unknown> | null;
  storage_path: string | null;
  mime_type: string | null;
  parent_source_id: string | null;
  depth: number;
  created_at: string;
}
