export type KnowledgePack = {
  id: string;
  name: string;
  description: string | null;
  sdk_version: string | null;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  default_branch: string;
  manifest: Record<string, unknown> | null;
  last_synced_at: string | null;
  last_commit_sha: string | null;
};

export type KnowledgePackFile = {
  pack_id: string;
  path: string;
  title: string | null;
  summary: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  category: string | null;
  updated_at: string;
};

export type KnowledgePackFileSummary = Omit<KnowledgePackFile, "body">;
