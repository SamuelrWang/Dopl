/**
 * factory.ts — side-effect-free entry for constructing a Dopl MCP server.
 *
 * Importable by BOTH the stdio binary (`index.ts`) and the remote HTTP
 * route in the web app, WITHOUT triggering `main()`, `process.argv`
 * parsing, or a stdio transport. The stdio-specific bits (arg parsing,
 * config-file workspace resolution, orphan-skill cleanup) stay in
 * `index.ts`; everything transport-agnostic lives here.
 */

import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";

export { createServer, buildInstructions } from "./server.js";
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
  /**
   * The session default workspace resolved at boot from the caller's
   * membership directory — a request X-Workspace-Id pin, else the sole
   * membership. Null when the caller has 0 or 2+ memberships and sent no
   * pin (each tool call must then pass `workspace=`).
   */
  activeWorkspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
  /**
   * True when the boot `listWorkspaces()` call FAILED (transient backend /
   * network error), as distinct from a genuine 0-membership directory. Lets
   * the refusal copy say "couldn't load your workspaces (retry)" instead of
   * "you have no workspaces".
   */
  directoryLoadFailed: boolean;
}

/**
 * Build a fully-registered MCP server for `client`: run the status-ping
 * handshake (admin flag + liveness), resolve the session default workspace
 * from the caller's membership directory, and register all tools.
 * Transport-agnostic — the caller attaches stdio or HTTP afterward.
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

  // Workspace directory (M-1): the caller's ACTIVE memberships in one call.
  // Replaces the old getActiveWorkspace handshake, so boot never hits the
  // header-less `resolveActiveWorkspace` path. The result seeds the server's
  // workspace cache (createServer), so no re-fetch is needed — HTTP boots
  // once per request; do NOT add loopbacks, the net count must not increase.
  let directory: WorkspaceListItem[] = [];
  let directoryLoadFailed = false;
  try {
    const result = await client.listWorkspaces();
    directory = result.workspaces;
  } catch (err) {
    diag(`[dopl-mcp] workspace directory load failed: ${errText(err)}`);
    directory = [];
    directoryLoadFailed = true;
  }

  // Resolve the session default from the directory:
  //   - a request-level X-Workspace-Id pin (the client's constructor
  //     workspaceId) that names a membership wins → treat like single;
  //   - else exactly one membership auto-targets;
  //   - else (0 or 2+ with no pin) NO transport default — the wrapper
  //     demands `workspace=` per call, so no header-less loopback can fire.
  const pin = client.getWorkspaceId();
  let active: WorkspaceListItem | null = null;
  let source: "header pin" | "sole membership" | null = null;
  if (pin) {
    active = directory.find((w) => w.id === pin || w.slug === pin) ?? null;
    if (active) {
      source = "header pin";
    } else {
      // Keep the fallback (the stale pin is cleared below), but make the
      // silent drop observable: a request X-Workspace-Id that names no
      // active membership is otherwise invisible in logs.
      diag(
        `[dopl-mcp] X-Workspace-Id pin "${pin}" matched no active membership${
          directoryLoadFailed ? " (directory load had failed)" : ""
        }; ignoring it and resolving from memberships`,
      );
    }
  }
  if (!active && directory.length === 1) {
    active = directory[0];
    source = "sole membership";
  }
  // Clear a stale/garbage constructor pin that didn't resolve so loopback
  // calls never carry a bogus X-Workspace-Id.
  client.setWorkspaceId(active ? active.id : null);

  const server = createServer(client, {
    isAdmin,
    directory,
    directoryLoadFailed,
    workspace: active,
    role: active?.role ?? null,
    workspaceSource: source,
    scopes: opts.scopes,
  });

  const activeWorkspace = active
    ? {
        id: active.id,
        name: active.name,
        slug: active.slug,
        role: active.role,
      }
    : null;

  return { server, userId, isAdmin, activeWorkspace, directoryLoadFailed };
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
