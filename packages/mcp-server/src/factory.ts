/**
 * factory.ts — side-effect-free entry for constructing a Dopl MCP server.
 *
 * Importable by BOTH the stdio binary (`index.ts`) and the remote HTTP
 * route in the web app, WITHOUT triggering `main()`, `process.argv`
 * parsing, or a stdio transport. The stdio-specific bits (arg parsing,
 * config-file workspace resolution, orphan-skill cleanup) stay in
 * `index.ts`; everything transport-agnostic lives here.
 */

import type { DoplClient } from "@dopl/client";
import { createServer } from "./server.js";

export { createServer, SERVER_INSTRUCTIONS } from "./server.js";
export { clientIdentifier, packageVersion } from "./version.js";

/** The concrete MCP server type, without importing the SDK type directly. */
export type DoplMcpServer = ReturnType<typeof createServer>;

export interface BootOptions {
  /**
   * OAuth scopes granted for this session, if any. Stage 3 (OAuth) gates
   * write/admin tools on these; absent ⇒ full access (stdio + bearer key).
   */
  scopes?: string[];
  /**
   * Retry attempts for the initial status ping. Default 0 (single attempt —
   * fast for per-request HTTP). The stdio binary passes a few retries because
   * it boots once and tolerates a cold backend.
   */
  pingRetries?: number;
  /**
   * Sink for boot diagnostics (status-ping / canvas-handshake failures).
   * The stdio binary passes `console.error` so a bad key or unreachable
   * backend surfaces at boot; the per-request HTTP route can omit it (or
   * route to its own logger) to avoid log spam on every request. Default: no-op.
   */
  onDiag?: (message: string) => void;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface BootResult {
  server: DoplMcpServer;
  /** Authenticated user id from the status ping (null if the ping failed). */
  userId: string | null;
  isAdmin: boolean;
  /** Resolved active canvas, for the caller to log/report. Null if unresolved. */
  activeWorkspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
}

/**
 * Build a fully-registered MCP server for `client`: run the status-ping
 * handshake (admin flag + liveness), resolve the active workspace, and
 * register all tools. Transport-agnostic — the caller attaches stdio or
 * HTTP afterward.
 */
export async function bootServer(
  client: DoplClient,
  opts: BootOptions = {},
): Promise<BootResult> {
  const diag = opts.onDiag ?? (() => {});

  // Status ping → admin flag + user id. Safe default on failure: non-admin.
  // (No tools are admin-gated currently; the flag is retained for future use.)
  let isAdmin = false;
  let userId: string | null = null;
  try {
    const ping = await pingWithRetry(client, opts.pingRetries ?? 0);
    isAdmin = ping.is_admin;
    userId = ping.user_id;
  } catch (err) {
    diag(`[dopl-mcp] status ping failed (continuing as non-admin): ${errText(err)}`);
  }

  // Workspace handshake — confirm the active canvas + the caller's role.
  // Non-fatal: workspace-targeting tools return clear errors and the caller
  // decides how to surface "no active canvas".
  let handshake: Awaited<ReturnType<DoplClient["getActiveWorkspace"]>> | null =
    null;
  try {
    handshake = await client.getActiveWorkspace();
  } catch (err) {
    diag(`[dopl-mcp] canvas handshake failed: ${errText(err)}`);
    handshake = null;
  }
  if (handshake?.workspace) {
    client.setWorkspaceId(handshake.workspace.id);
  }

  const server = createServer(client, {
    isAdmin,
    workspace: handshake?.workspace ?? null,
    role: handshake?.role ?? null,
    scopes: opts.scopes,
  });

  const activeWorkspace = handshake?.workspace
    ? {
        id: handshake.workspace.id,
        name: handshake.workspace.name,
        slug: handshake.workspace.slug,
        role: handshake.role ?? "viewer",
      }
    : null;

  return { server, userId, isAdmin, activeWorkspace };
}

async function pingWithRetry(
  client: DoplClient,
  retries: number,
): Promise<{ is_admin: boolean; user_id: string | null }> {
  const delays = [1000, 2000, 4000].slice(0, Math.max(0, retries));
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await client.pingMcpStatus();
    } catch (err) {
      if (attempt === delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  // Unreachable — the loop either returns or throws on the last attempt.
  return { is_admin: false, user_id: null };
}
