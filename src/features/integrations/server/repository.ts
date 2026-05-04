import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IntegrationProvider,
  IntegrationStatus,
  OAuthConnection,
} from "../types";
import { mapOAuthConnectionRow, type OAuthConnectionRow } from "./dto";

const TABLE = "oauth_connections";
const COLUMNS =
  "id, workspace_id, user_id, provider, composio_connection_id, status, scopes, last_used_at, created_at, updated_at";

export type ConnectionWithBrokerId = {
  connection: OAuthConnection;
  brokerConnectionId: string;
};

function rowOrThrow(row: OAuthConnectionRow | null | undefined): OAuthConnectionRow | null {
  return row ?? null;
}

export async function listConnectionsForUser(
  client: SupabaseClient,
  args: { workspaceId: string; userId: string }
): Promise<OAuthConnection[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId);
  if (error) throw new Error(`listConnectionsForUser failed: ${error.message}`);
  return ((data as OAuthConnectionRow[] | null) ?? []).map(mapOAuthConnectionRow);
}

export async function findConnection(
  client: SupabaseClient,
  args: {
    workspaceId: string;
    userId: string;
    provider: IntegrationProvider;
  }
): Promise<OAuthConnection | null> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .maybeSingle();
  if (error) throw new Error(`findConnection failed: ${error.message}`);
  const row = rowOrThrow(data as OAuthConnectionRow | null);
  return row ? mapOAuthConnectionRow(row) : null;
}

/**
 * Same as `findConnection` but also returns the broker connection id.
 * Only callers that actually need to talk to the broker (service
 * methods that call `composioClient.*`) use this — keeping it on a
 * separate method makes the leak surface explicit.
 */
export async function findConnectionWithBrokerId(
  client: SupabaseClient,
  args: {
    workspaceId: string;
    userId: string;
    provider: IntegrationProvider;
  }
): Promise<ConnectionWithBrokerId | null> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .maybeSingle();
  if (error) throw new Error(`findConnectionWithBrokerId failed: ${error.message}`);
  const row = rowOrThrow(data as OAuthConnectionRow | null);
  if (!row) return null;
  return {
    connection: mapOAuthConnectionRow(row),
    brokerConnectionId: row.composio_connection_id,
  };
}

export async function upsertConnection(
  client: SupabaseClient,
  args: {
    workspaceId: string;
    userId: string;
    provider: IntegrationProvider;
    brokerConnectionId: string;
    status: IntegrationStatus;
    scopes?: string[];
  }
): Promise<OAuthConnection> {
  const { data, error } = await client
    .from(TABLE)
    .upsert(
      {
        workspace_id: args.workspaceId,
        user_id: args.userId,
        provider: args.provider,
        composio_connection_id: args.brokerConnectionId,
        status: args.status,
        scopes: args.scopes ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id,provider" }
    )
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`upsertConnection failed: ${error.message}`);
  return mapOAuthConnectionRow(data as OAuthConnectionRow);
}

export async function updateConnectionStatus(
  client: SupabaseClient,
  args: {
    id: string;
    status: IntegrationStatus;
  }
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({ status: args.status, updated_at: new Date().toISOString() })
    .eq("id", args.id);
  if (error) throw new Error(`updateConnectionStatus failed: ${error.message}`);
}

export async function touchConnection(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from(TABLE)
    .update({ last_used_at: now, updated_at: now })
    .eq("id", id);
  if (error) throw new Error(`touchConnection failed: ${error.message}`);
}

export async function deleteConnection(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`deleteConnection failed: ${error.message}`);
}
