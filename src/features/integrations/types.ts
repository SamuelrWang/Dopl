/**
 * Domain types for third-party integrations (Notion, Gmail, Drive, …).
 *
 * `OAuthConnection` is the camelCase domain shape. The DB row is
 * snake_case and contains a `composio_connection_id` that NEVER
 * appears here — it's stripped at the repository boundary in
 * `server/dto.ts`.
 *
 * Connections are USER-LEVEL: one OAuth handshake per (user, provider,
 * alias). Workspace access is a separate `oauth_connection_grants`
 * table — see `OAuthConnectionGrant` below — so a user connects once
 * and chooses which workspaces can use the connection.
 */

import type { AgentIngestBundle } from "@/features/ingestion/server/agent-bundle";

export const INTEGRATION_PROVIDERS = [
  "notion",
  "gmail",
  "google_drive",
  "github",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "slack",
  "attio",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationStatus = "connected" | "needs_auth" | "error";

export type OAuthConnection = {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  /** Auto-derived from the connected account's email at finalize time. */
  alias: string;
  status: IntegrationStatus;
  /** Email of the connected provider account, if the broker exposed it. */
  accountEmail: string | null;
  /** Human-readable label override (e.g. "Personal Gmail"). null = use alias. */
  accountLabel: string | null;
  /**
   * Real avatar URL fetched from the provider's profile API at
   * connect-time (Slack image_192, GitHub avatar_url, Notion
   * avatar_url, Google photoLink). null when the provider didn't
   * surface one; `/api/integrations/connections` falls back to
   * Gravatar derived from `accountEmail` so the UI still renders
   * something.
   */
  accountAvatarUrl: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Workspaces this connection has been granted access to. */
export type OAuthConnectionGrant = {
  connectionId: string;
  workspaceId: string;
  grantedAt: string;
};

/**
 * Connection enriched with the workspace grants list — what the
 * /settings/integrations page renders per row.
 */
export type OAuthConnectionWithGrants = OAuthConnection & {
  grantedWorkspaceIds: string[];
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

export type ReadIntegrationObjectResult = {
  provider: IntegrationProvider;
  objectId: string;
  title: string;
  url: string | null;
  lastModified: string | null;
  body: string;
};

/**
 * Result of `connectIntegration`. The auth URL is the BROKER's URL
 * (Composio's hosted OAuth handoff) — frontend opens this directly
 * in a popup. Earlier the API returned a Dopl-internal redirect URL
 * (/connect/[provider]/start); we cut out that hop now that the
 * connect call does the broker initiate inline.
 */
export type ConnectInitiation =
  | { status: "connected"; connectionId: string }
  | { status: "needs_auth"; authUrl: string; connectionId: string };

/**
 * Wire-format descriptor returned by `list_integration_actions`. Each
 * field documents one named action so the agent can pick one without
 * the broker's slug ever surfacing.
 *
 * `paramsJsonSchema` is a standard JSON Schema fragment (object-typed)
 * — the agent reads it natively. Composio's catalog returns this shape
 * directly; hand-curated actions construct an equivalent literal.
 *
 * `source` lets the agent (and us, when debugging) tell whether the
 * descriptor came from a hand-tuned override or the auto-generated
 * Composio catalog.
 */
export type IntegrationActionDescriptor = {
  name: string;
  summary: string;
  paramsJsonSchema: Record<string, unknown>;
  source: "curated" | "auto";
};

export type IntegrationActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

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
