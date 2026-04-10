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
  use_case: {
    primary: string;
    secondary: string[];
  };
  complexity: string;
  tools: ManifestTool[];
  integrations: ManifestIntegration[];
  languages: string[];
  frameworks: string[];
  patterns: string[];
  estimated_setup_time: string;
  tags: string[];
}

export interface ManifestTool {
  name: string;
  role: string;
  required: boolean;
  alternatives?: string[];
}

export interface ManifestIntegration {
  from: string;
  to: string;
  method: string;
  description: string;
}
