import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IntegrationProvider,
  IntegrationStatus,
  OAuthConnection,
  OAuthConnectionWithGrants,
} from "../types";
import { mapOAuthConnectionRow, type OAuthConnectionRow } from "./dto";

const TABLE = "oauth_connections";
const GRANTS_TABLE = "oauth_connection_grants";
const COLUMNS =
  "id, user_id, provider, alias, composio_connection_id, status, account_email, account_label, scopes, last_used_at, created_at, updated_at";

export type ConnectionWithBrokerId = {
  connection: OAuthConnection;
  brokerConnectionId: string;
};

function rowOrThrow(
  row: OAuthConnectionRow | null | undefined
): OAuthConnectionRow | null {
  return row ?? null;
}

// ── Reads ────────────────────────────────────────────────────────────

/** Every connection the user owns, across all providers. */
export async function listConnectionsForUser(
  client: SupabaseClient,
  args: { userId: string }
): Promise<OAuthConnection[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listConnectionsForUser failed: ${error.message}`);
  return ((data as OAuthConnectionRow[] | null) ?? []).map(
    mapOAuthConnectionRow
  );
}

/** All connections for one provider (multi-account aware). */
export async function listConnectionsForProvider(
  client: SupabaseClient,
  args: { userId: string; provider: IntegrationProvider }
): Promise<OAuthConnection[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .order("created_at", { ascending: false });
  if (error)
    throw new Error(`listConnectionsForProvider failed: ${error.message}`);
  return ((data as OAuthConnectionRow[] | null) ?? []).map(
    mapOAuthConnectionRow
  );
}

/**
 * Find a connection by (user, provider, alias?) and return its broker id.
 * When `alias` is omitted, returns the most-recently-used (or most-
 * recently-created) connection — used by the action-execute path when
 * the agent didn't explicitly pick an account.
 */
export async function findConnectionWithBrokerId(
  client: SupabaseClient,
  args: {
    userId: string;
    provider: IntegrationProvider;
    alias?: string;
  }
): Promise<ConnectionWithBrokerId | null> {
  let query = client
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", args.userId)
    .eq("provider", args.provider);
  if (args.alias) query = query.eq("alias", args.alias);
  const { data, error } = await query
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`findConnectionWithBrokerId failed: ${error.message}`);
  const row = rowOrThrow(data as OAuthConnectionRow | null);
  if (!row) return null;
  return {
    connection: mapOAuthConnectionRow(row),
    brokerConnectionId: row.composio_connection_id,
  };
}

/**
 * Look up by broker-connection id. Used by the OAuth callback handler
 * when the broker hands us back an id we wrote during initiate.
 */
export async function findConnectionByBrokerId(
  client: SupabaseClient,
  brokerConnectionId: string
): Promise<ConnectionWithBrokerId | null> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("composio_connection_id", brokerConnectionId)
    .maybeSingle();
  if (error)
    throw new Error(`findConnectionByBrokerId failed: ${error.message}`);
  const row = rowOrThrow(data as OAuthConnectionRow | null);
  if (!row) return null;
  return {
    connection: mapOAuthConnectionRow(row),
    brokerConnectionId: row.composio_connection_id,
  };
}

/**
 * Same as `findConnectionWithBrokerId` but additionally requires that
 * the connection be granted to a specific workspace. Returns null if
 * the connection exists but isn't granted there. Used by every
 * service-actions / read code path so cross-workspace leakage is
 * impossible at the lookup level.
 *
 * Implementation: two queries — (a) list grant rows for the workspace,
 * (b) fetch matching connections filtered by user, provider, and the
 * grant set. This avoids PostgREST's `!inner` relation-filter
 * shorthand (which was reading wrong when `alias?` was supplied —
 * the in-memory `.find()` after `.limit(1)` would miss matching rows
 * past the first), at the cost of one extra round-trip.
 */
export async function findConnectionForWorkspace(
  client: SupabaseClient,
  args: {
    userId: string;
    provider: IntegrationProvider;
    workspaceId: string;
    alias?: string;
  }
): Promise<ConnectionWithBrokerId | null> {
  const { data: grantRows, error: grantsErr } = await client
    .from(GRANTS_TABLE)
    .select("connection_id")
    .eq("workspace_id", args.workspaceId);
  if (grantsErr)
    throw new Error(`findConnectionForWorkspace(grants) failed: ${grantsErr.message}`);
  const ids = ((grantRows as Array<{ connection_id: string }> | null) ?? []).map(
    (r) => r.connection_id
  );
  if (ids.length === 0) return null;

  let query = client
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .in("id", ids);
  if (args.alias) query = query.eq("alias", args.alias);
  const { data, error } = await query
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`findConnectionForWorkspace failed: ${error.message}`);
  const row = rowOrThrow(data as OAuthConnectionRow | null);
  if (!row) return null;
  return {
    connection: mapOAuthConnectionRow(row),
    brokerConnectionId: row.composio_connection_id,
  };
}

/**
 * Confirm the caller owns this connection. Used by service paths that
 * mutate or delete a connection by id (disconnect, update grants).
 * Returns the row id when ownership matches, null otherwise.
 */
export async function verifyConnectionOwnership(
  client: SupabaseClient,
  connectionId: string,
  userId: string
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from(TABLE)
    .select("id")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`verifyConnectionOwnership failed: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

/**
 * Drop every `pending:%` placeholder row for this user + provider.
 * Called from `connectIntegration` before initiating a fresh handshake
 * so retried connect attempts don't accumulate stale rows. The real
 * row will replace the placeholder once the OAuth callback fires.
 */
export async function deleteStalePendingForProvider(
  client: SupabaseClient,
  args: { userId: string; provider: IntegrationProvider }
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .delete()
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .like("alias", "pending:%");
  if (error)
    throw new Error(`deleteStalePendingForProvider failed: ${error.message}`);
}

// ── Writes ───────────────────────────────────────────────────────────

export async function upsertConnection(
  client: SupabaseClient,
  args: {
    userId: string;
    provider: IntegrationProvider;
    alias: string;
    brokerConnectionId: string;
    status: IntegrationStatus;
    accountEmail?: string | null;
    accountLabel?: string | null;
    scopes?: string[];
  }
): Promise<OAuthConnection> {
  const { data, error } = await client
    .from(TABLE)
    .upsert(
      {
        user_id: args.userId,
        provider: args.provider,
        alias: args.alias,
        composio_connection_id: args.brokerConnectionId,
        status: args.status,
        account_email: args.accountEmail ?? null,
        account_label: args.accountLabel ?? null,
        scopes: args.scopes ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,alias" }
    )
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`upsertConnection failed: ${error.message}`);
  return mapOAuthConnectionRow(data as OAuthConnectionRow);
}

export async function updateConnectionStatus(
  client: SupabaseClient,
  args: { id: string; status: IntegrationStatus }
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({ status: args.status, updated_at: new Date().toISOString() })
    .eq("id", args.id);
  if (error) throw new Error(`updateConnectionStatus failed: ${error.message}`);
}

export async function updateConnectionAccountInfo(
  client: SupabaseClient,
  args: {
    id: string;
    alias?: string;
    accountEmail?: string | null;
    accountLabel?: string | null;
  }
): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (args.alias !== undefined) patch.alias = args.alias;
  if (args.accountEmail !== undefined) patch.account_email = args.accountEmail;
  if (args.accountLabel !== undefined) patch.account_label = args.accountLabel;
  const { error } = await client.from(TABLE).update(patch).eq("id", args.id);
  if (error)
    throw new Error(`updateConnectionAccountInfo failed: ${error.message}`);
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

// ── Grants ───────────────────────────────────────────────────────────

export async function listGrants(
  client: SupabaseClient,
  connectionId: string
): Promise<string[]> {
  const { data, error } = await client
    .from(GRANTS_TABLE)
    .select("workspace_id")
    .eq("connection_id", connectionId);
  if (error) throw new Error(`listGrants failed: ${error.message}`);
  return ((data as Array<{ workspace_id: string }> | null) ?? []).map(
    (r) => r.workspace_id
  );
}

/**
 * For the /settings/integrations page: every connection the user owns,
 * each with its workspace grants list. Two queries (connections +
 * grants), joined in memory — at typical scale (~10 connections × ~20
 * workspaces) this is cheaper than a JSON-aggregated single query.
 */
export async function listConnectionsWithGrantsForUser(
  client: SupabaseClient,
  args: { userId: string }
): Promise<OAuthConnectionWithGrants[]> {
  const connections = await listConnectionsForUser(client, args);
  if (connections.length === 0) return [];
  const ids = connections.map((c) => c.id);
  const { data, error } = await client
    .from(GRANTS_TABLE)
    .select("connection_id, workspace_id")
    .in("connection_id", ids);
  if (error)
    throw new Error(`listConnectionsWithGrantsForUser failed: ${error.message}`);
  const grantsByConnection = new Map<string, string[]>();
  for (const row of (data as Array<{ connection_id: string; workspace_id: string }> | null) ??
    []) {
    const existing = grantsByConnection.get(row.connection_id) ?? [];
    existing.push(row.workspace_id);
    grantsByConnection.set(row.connection_id, existing);
  }
  return connections.map((c) => ({
    ...c,
    grantedWorkspaceIds: grantsByConnection.get(c.id) ?? [],
  }));
}

export async function setGrants(
  client: SupabaseClient,
  args: { connectionId: string; workspaceIds: string[] }
): Promise<void> {
  // Two-phase: drop existing grants for this connection, insert new
  // set. Keeps the operation atomic from the caller's perspective and
  // sidesteps the pain of computing diffs.
  const del = await client
    .from(GRANTS_TABLE)
    .delete()
    .eq("connection_id", args.connectionId);
  if (del.error) throw new Error(`setGrants(delete) failed: ${del.error.message}`);
  if (args.workspaceIds.length === 0) return;
  const rows = args.workspaceIds.map((workspaceId) => ({
    connection_id: args.connectionId,
    workspace_id: workspaceId,
  }));
  const ins = await client.from(GRANTS_TABLE).insert(rows);
  if (ins.error) throw new Error(`setGrants(insert) failed: ${ins.error.message}`);
}

export async function addGrants(
  client: SupabaseClient,
  args: { connectionId: string; workspaceIds: string[] }
): Promise<void> {
  if (args.workspaceIds.length === 0) return;
  const rows = args.workspaceIds.map((workspaceId) => ({
    connection_id: args.connectionId,
    workspace_id: workspaceId,
  }));
  const { error } = await client
    .from(GRANTS_TABLE)
    .upsert(rows, { onConflict: "connection_id,workspace_id" });
  if (error) throw new Error(`addGrants failed: ${error.message}`);
}
