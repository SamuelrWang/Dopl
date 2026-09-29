import type { AgentApp } from "../types";

/**
 * CONNECTED AGENT APPS — the caller's OAuth grants folded into ONE row per app.
 *
 * A client like Claude or Codex registers a fresh OAuth client on every install and refresh
 * rotation leaves rows behind, so one app showed up as many "connected apps". Rows are grouped by
 * the app's name; Disconnect revokes every live credential in the group. First-party credentials
 * (the desktop's device and container-session tokens, the playground) are not agent apps: they
 * belong to a device and are never listed here.
 *
 * ⚠ THE GROUP IS NAME + REDIRECT HOST. `client_name` is self-declared at registration, so a client
 * calling itself "Claude" with another callback host must not fold into (and hide behind) the real
 * one; it gets its own row, and every row shows its host.
 */

export interface GrantRow {
  id: string;
  client_id: string;
  client_name: string | null;
  last_used_at: string | null;
  created_at: string;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  /** The registered client's redirect URIs (`oauth_clients.redirect_uris`). */
  redirect_uris: string[] | null;
}

export interface AgentAppStore {
  /** Unrevoked tokens of this user under third-party clients. */
  listGrants(userId: string): Promise<GrantRow[]>;
  revokeTokens(userId: string, ids: string[], now: string): Promise<number>;
}

const FALLBACK_NAME = "MCP client";

export function appName(clientName: string | null): string {
  return (clientName ?? "").trim() || FALLBACK_NAME;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The first redirect URI's host (`claude.ai`, `localhost`), or null when none parses. */
export function redirectHost(uris: string[] | null): string | null {
  for (const uri of uris ?? []) {
    try {
      const host = new URL(uri).hostname;
      if (host) return host;
    } catch {
      // not a URL (a custom scheme without a host): try the next one
    }
  }
  return null;
}

export function appKey(name: string, host: string | null = null): string {
  const base = slug(name) || "mcp-client";
  return host ? `${base}--${slug(host)}` : base;
}

const rowKey = (row: GrantRow) => appKey(appName(row.client_name), redirectHost(row.redirect_uris));

function isLive(row: GrantRow, now: string): boolean {
  return (
    (row.access_expires_at !== null && row.access_expires_at > now) ||
    (row.refresh_expires_at !== null && row.refresh_expires_at > now)
  );
}

function liveGroups(rows: GrantRow[], now: string): Map<string, GrantRow[]> {
  const groups = new Map<string, GrantRow[]>();
  for (const row of rows) {
    if (!isLive(row, now)) continue;
    const key = rowKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

const latest = (values: (string | null)[]) =>
  values.reduce<string | null>((max, v) => (v && (!max || v > max) ? v : max), null);

/** Most recently used first; never-used apps last, newest connection first. */
export async function listAgentApps(
  store: AgentAppStore,
  userId: string,
  now: string
): Promise<{ apps: AgentApp[] }> {
  const groups = liveGroups(await store.listGrants(userId), now);
  const apps = [...groups.entries()].map(([key, rows]) => ({
    key,
    name: appName(rows[0].client_name),
    host: redirectHost(rows[0].redirect_uris),
    connections: rows.length,
    last_used_at: latest(rows.map((r) => r.last_used_at)),
    created_at: latest(rows.map((r) => r.created_at)) ?? rows[0].created_at,
  }));
  apps.sort(
    (a, b) =>
      (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") ||
      b.created_at.localeCompare(a.created_at)
  );
  return { apps };
}

/** Revoke every live credential of one app. `0` when the caller has no such app. */
export async function disconnectAgentApp(
  store: AgentAppStore,
  userId: string,
  key: string,
  now: string
): Promise<number> {
  const rows = (await store.listGrants(userId)).filter(
    (row) => rowKey(row) === key
  );
  if (rows.length === 0) return 0;
  return store.revokeTokens(
    userId,
    rows.map((r) => r.id),
    now
  );
}
