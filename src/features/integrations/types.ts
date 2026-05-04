/**
 * Domain types for third-party integrations (Notion, Gmail, Drive, …).
 *
 * `OAuthConnection` is the camelCase domain shape. The DB row is
 * snake_case and contains a `composio_connection_id` that NEVER
 * appears here — it's stripped at the repository boundary in
 * `server/dto.ts`.
 */

import type { AgentIngestBundle } from "@/features/ingestion/server/agent-bundle";

export const INTEGRATION_PROVIDERS = ["notion", "gmail", "google_drive"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationStatus = "connected" | "needs_auth" | "error";

export type OAuthConnection = {
  id: string;
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Thin index entry returned by `list_integration_objects`. */
export type IntegrationObject = {
  id: string;
  title: string;
  url: string | null;
  lastModified: string | null;
};

export type IntegrationListResult = {
  objects: IntegrationObject[];
  nextCursor: string | null;
};

export type ConnectInitiation =
  | { status: "connected" }
  | { status: "needs_auth"; authUrl: string };

/**
 * Shape returned by `prepare-from-integration`. Mirrors the existing
 * `prepare_ingest` response so the agent can run the same synthesis
 * flow for both URL- and integration-sourced entries. The `prompts`
 * object is a passthrough of `AgentIngestBundle["prompts"]` — see
 * `src/features/ingestion/server/agent-bundle.ts` for its shape.
 */
export type PrepareFromIntegrationResult = {
  status: "ready";
  entry_id: string;
  slug: string;
  source_url: string;
  source_platform: string;
  thumbnail_url: string | null;
  sources: Array<{
    url: string | null;
    source_type: string;
    depth: number;
    chars: number;
  }>;
  fetch_warnings: Array<{
    url: string | null;
    reason: string;
    fetch_status_code: number | null;
  }>;
  detected_links: string[];
  images: Array<{ image_id: string; base64: string; mimeType: string }>;
  prompts: AgentIngestBundle["prompts"];
  instructions: string;
};
