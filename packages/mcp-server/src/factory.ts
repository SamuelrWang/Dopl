/**
 * factory.ts — ⚠ side-effect-free entry for constructing a Dopl MCP server.
 * Importable by BOTH the stdio binary (`index.ts`) and the web app's HTTP route
 * WITHOUT triggering `main()`, `process.argv` parsing, or a stdio transport.
 * Keep stdio-specific bits (arg parsing, config-file workspace resolution,
 * orphan-skill cleanup) in `index.ts`.
 */

import { isStandardWorkspace } from "@dopl/client";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./tools/identity.js";

export type { CallerIdentity } from "./tools/identity.js";

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
   * Retry attempts for the initial status ping. Default 0 — fast for per-request
   * HTTP; the stdio binary passes retries because it boots once.
   */
  pingRetries?: number;
  /**
   * Boot-diagnostics sink. The stdio binary passes `console.error` so a bad key
   * surfaces at boot; the per-request HTTP route omits it to avoid per-request
   * log spam. Default: no-op.
   */
  onDiag?: (message: string) => void;
  /**
   * Who is calling and through what, resolved by the TRANSPORT — the only layer
   * that sees the credential and the request headers. ⚠ When the transport
   * supplies a user id it WINS over the status ping's: it comes from the
   * credential actually authorizing this request, not a second round-trip
   * against a second code path that fails on its own.
   */
  caller?: Partial<CallerIdentity>;
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
   * Session default workspace resolved at boot: a request X-Workspace-Id pin,
   * else the sole membership. Null on 0 or 2+ memberships with no pin — each
   * tool call must then pass `workspace=`.
   */
  activeWorkspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
  /**
   * ⚠ True when the boot `listWorkspaces()` FAILED, as distinct from a genuine
   * 0-membership directory — the refusal copy must say "couldn't load, retry",
   * not "you have no workspaces".
   */
  directoryLoadFailed: boolean;
}

/**
 * Build a fully-registered MCP server for `client`: status-ping handshake
 * (admin flag + liveness), resolve the session default workspace, register all
 * tools. Transport-agnostic — the caller attaches stdio or HTTP afterward.
 */
export async function bootServer(
  client: DoplClient,
  opts: BootOptions = {},
): Promise<BootResult> {
  const diag = opts.onDiag ?? (() => {});

  // Status ping → admin flag + user id. ⚠ Safe default on failure: non-admin.
  let isAdmin = false;
  let userId: string | null = null;
  try {
    const ping = await pingWithRetry(client, opts.pingRetries ?? 0);
    isAdmin = ping.is_admin;
    userId = ping.user_id;
  } catch (err) {
    diag(`[dopl-mcp] status ping failed (continuing as non-admin): ${errText(err)}`);
  }

  // Caller's ACTIVE memberships in ONE call, so boot never hits the header-less
  // `resolveActiveWorkspace` path. Seeds the server's workspace cache, so no
  // re-fetch. ⚠ HTTP boots once per request — do NOT add loopbacks here.
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

  // Session default: an X-Workspace-Id pin naming a membership wins; else
  // exactly one membership auto-targets; else ⚠ NO transport default — the
  // wrapper demands `workspace=` per call, so no header-less loopback fires.
  // ⚠ Only STANDARD memberships can auto-target: a home-channel container must
  // never become the workspace a no-arg tool call silently lands in. A PIN is
  // explicit addressing and still matches the full directory.
  const pin = client.getWorkspaceId();
  let active: WorkspaceListItem | null = null;
  let source: "header pin" | "sole membership" | null = null;
  if (pin) {
    active = directory.find((w) => w.id === pin || w.slug === pin) ?? null;
    if (active) {
      source = "header pin";
    } else {
      // ⚠ Make the drop observable — an X-Workspace-Id naming no active
      // membership is otherwise invisible in logs.
      diag(
        `[dopl-mcp] X-Workspace-Id pin "${pin}" matched no active membership${
          directoryLoadFailed ? " (directory load had failed)" : ""
        }; ignoring it and resolving from memberships`,
      );
    }
  }
  const listable = directory.filter(isStandardWorkspace);
  if (!active && listable.length === 1) {
    active = listable[0];
    source = "sole membership";
  }

  // 🔒 THE CONTAINER LOCK (plan §4.4 B3). A session pinned to a SHARED link
  // container — one with a PEER in it — sees and addresses that container
  // ALONE: no `list_workspaces` entry for the operator's other workspaces, no
  // `workspace=` that resolves to one, no instruction table naming any.
  //
  // ⚠ SHARED, NOT SOLO. A one-member container is the operator's own primary
  // agent surface and is deliberately untouched, exactly as the audience ceiling
  // leaves it (`knowledge/server/service-audience.ts`). The lock exists because
  // somebody ELSE is in the room.
  //
  // 🔒 ⚠ `?? 0` AND ZERO IS NOT SOLO — this is §8's stale-field rule applied in
  // the INVERTED direction, on purpose. `memberCount` is new on the cached
  // `listWorkspaces` payload; an older server sends none, and the reflex
  // fallback (treat unknown as the permissive case) would silently unlock every
  // container across the release window in which a desktop build runs against a
  // server that predates the field. Unknown = not solo = narrowed.
  //
  // ⚠ AND IT IS A TRIPWIRE. Bash can open a second, unpinned MCP connection or
  // issue the loopback HTTP directly; neither passes through this object. The
  // fences are the container-locked credential and the server-side audience
  // ceiling. Do not describe this line as containment.
  const lockedTo =
    active && !isStandardWorkspace(active) && (active.memberCount ?? 0) !== 1
      ? active
      : null;
  if (lockedTo) {
    diag(
      `[dopl-mcp] directory LOCKED to shared container ${lockedTo.slug} (${
        lockedTo.memberCount ?? "unknown"
      } active members)`,
    );
  }
  // ⚠ Clear an unresolved constructor pin so loopback calls never carry a bogus
  // X-Workspace-Id.
  client.setWorkspaceId(active ? active.id : null);

  // ⚠ ONE identity for the whole session, and the TRANSPORT's user id wins —
  // it is read off the credential doing the work, not a second loopback that
  // fails independently. Three sources let two tools on ONE connection disagree
  // about who is calling.
  const caller: CallerIdentity = {
    ...UNKNOWN_CALLER,
    ...opts.caller,
    userId: opts.caller?.userId ?? userId,
  };

  const server = createServer(client, {
    isAdmin,
    caller,
    // ⚠ Not just diagnostic — `dopl_channel` needs this id to tell a reader a
    // message is addressed to IT rather than to some other member.
    userId: caller.userId,
    directory,
    directoryLoadFailed,
    lockedTo,
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

  return {
    server,
    userId: caller.userId,
    isAdmin,
    activeWorkspace,
    directoryLoadFailed,
  };
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
