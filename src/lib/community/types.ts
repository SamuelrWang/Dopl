// ── Published Cluster Types ─────────────────────────────────────────

/** Panel position/metadata in the published canvas */
export interface PublishedPanel {
  id: string;
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Summary card for gallery/listing */
export interface PublishedClusterSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  thumbnail_url: string | null;
  fork_count: number;
  status: "draft" | "published" | "archived";
  created_at: string;
  updated_at: string;
  /** Creator info from profiles */
  author: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  panel_count: number;
}

/** Full detail for the public detail page */
export interface PublishedClusterDetail extends PublishedClusterSummary {
  cluster_id: string;
  panels: PublishedPanel[];
  brain_instructions: string;
  author: PublishedClusterSummary["author"] & {
    bio: string | null;
    website_url: string | null;
    twitter_handle: string | null;
    github_username: string | null;
  };
  /** Entry data for chat context and detail display */
  entries: Array<{
    entry_id: string;
    title: string | null;
    summary: string | null;
    source_url: string | null;
    source_platform: string | null;
    readme: string | null;
    agents_md: string | null;
  }>;
}

/** Request body for publishing a cluster */
export interface PublishClusterRequest {
  title: string;
  description?: string;
  category?: string;
}

/** Request body for updating a published cluster */
export interface UpdatePublishedClusterRequest {
  title?: string;
  description?: string;
  category?: string;
  status?: "draft" | "published" | "archived";
}

/** Panel position update for creator editing */
export interface PanelPositionUpdate {
  id: string;
  x: number;
  y: number;
}
