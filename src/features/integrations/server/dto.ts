import "server-only";
import type {
  IntegrationProvider,
  IntegrationStatus,
  OAuthConnection,
} from "../types";
import { INTEGRATION_PROVIDERS } from "../types";

/** Raw shape of an `oauth_connections` row. */
export type OAuthConnectionRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  composio_connection_id: string;
  status: string;
  scopes: string[] | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUSES: ReadonlySet<IntegrationStatus> = new Set([
  "connected",
  "needs_auth",
  "error",
]);

function asProvider(value: string): IntegrationProvider {
  if ((INTEGRATION_PROVIDERS as readonly string[]).includes(value)) {
    return value as IntegrationProvider;
  }
  throw new Error(`Unknown integration provider in row: ${value}`);
}

function asStatus(value: string): IntegrationStatus {
  if (STATUSES.has(value as IntegrationStatus)) {
    return value as IntegrationStatus;
  }
  throw new Error(`Unknown integration status in row: ${value}`);
}

/**
 * Map a raw row to the camelCase domain shape, dropping
 * `composio_connection_id` so it can never accidentally leak past the
 * repository. Callers that need the broker id use a dedicated
 * repository method (`getConnectionWithBrokerId`) — kept narrow so
 * grepping for the field name surfaces every leak path.
 */
export function mapOAuthConnectionRow(row: OAuthConnectionRow): OAuthConnection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    provider: asProvider(row.provider),
    status: asStatus(row.status),
    scopes: row.scopes ?? [],
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
