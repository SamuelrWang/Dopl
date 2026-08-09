/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in.
 *
 * Split out of `server.ts` (§2, the layer rule): membership caching,
 * slug→id resolution and the "you must pass `workspace=`" refusal are one
 * responsibility — resolving a target — distinct from registering tools
 * (`registrar.ts`), gating ops (`gating.ts`) or writing the briefing
 * (`instructions.ts`).
 *
 * FAIL-CLOSED IS THE POINT AND IT DID NOT MOVE. A blank `workspace=` is
 * rejected by the caller in `registrar.ts`; a caller with 0 or 2+ memberships
 * and no pin gets {@link WorkspaceDirectory.noWorkspaceError} rather than a
 * guessed workspace; and a boot directory load that FAILED does not seed the
 * cache, so the first resolution retries instead of serving a bogus empty list
 * for a full TTL.
 */

import type { DoplClient, WorkspaceListItem, WorkspaceRole } from "@dopl/client";
import type { ToolResponse } from "./tools/respond.js";
import { inlineOr } from "./tools/narration.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";

/**
 * Snapshot of the session's default workspace, resolved once at boot from
 * the caller's membership directory (a request X-Workspace-Id pin, else the
 * sole membership). Read by `appendDoplStatus`. Null when the caller has 0
 * or 2+ memberships and sent no pin — in that state a no-arg tool call is
 * refused (the wrapper demands `workspace=`), so nothing is silently
 * routed to a guessed workspace.
 */
export interface ActiveWorkspaceState {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
}

/**
 * How the workspace a call actually hit was chosen — surfaced verbatim in
 * the `_dopl_status` footer so the agent can positively confirm targeting.
 */
export type WorkspaceSource = "per-call arg" | "sole membership" | "header pin";

export interface EffectiveWorkspace extends ActiveWorkspaceState {
  source: WorkspaceSource;
}

/** The boot-resolved directory state this module is constructed from. */
export interface WorkspaceDirectoryOptions {
  /**
   * The caller's full active-membership directory, from the boot
   * `listWorkspaces()` call. Seeds the cache so per-call `workspace=`
   * resolution needs no extra loopback.
   */
  directory?: WorkspaceListItem[];
  /**
   * True when the boot `listWorkspaces()` call FAILED (transient), as opposed
   * to a genuine empty directory. Steers the refusal copy toward "couldn't
   * load — retry" instead of "you have none", and suppresses seeding the cache
   * with a bogus empty directory so a later `workspace=` resolution retries.
   */
  directoryLoadFailed?: boolean;
}

export interface WorkspaceDirectory {
  /** The caller's memberships, cached for {@link WORKSPACE_CACHE_TTL_MS}. */
  getWorkspaceList(): Promise<WorkspaceListItem[]>;
  /** A slug-or-UUID `workspace=` ref resolved against those memberships. */
  resolveWorkspaceRef(ref: string): Promise<WorkspaceListItem | null>;
  /** The isError response for a no-`workspace=` call with no session default. */
  noWorkspaceError(): Promise<ToolResponse>;
}

/**
 * Cache TTL for the user's workspace memberships (slug→id resolution).
 * Seeded from the boot `listWorkspaces()` call; refreshed on demand after it.
 */
const WORKSPACE_CACHE_TTL_MS = 60_000;

export function createWorkspaceDirectory(
  client: DoplClient,
  options: WorkspaceDirectoryOptions = {},
): WorkspaceDirectory {
  // Seed from the boot directory — but NOT when the boot load failed, or we'd
  // cache a bogus empty list for the full TTL and mask the failure. Leaving it
  // null lets the first `workspace=` / no-default path retry the load.
  let workspaceListCache: { workspaces: WorkspaceListItem[]; loadedAt: number } | null =
    options.directory && !options.directoryLoadFailed
      ? { workspaces: options.directory, loadedAt: Date.now() }
      : null;

  async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
    if (
      workspaceListCache &&
      Date.now() - workspaceListCache.loadedAt < WORKSPACE_CACHE_TTL_MS
    ) {
      return workspaceListCache.workspaces;
    }
    const result = await client.listWorkspaces();
    workspaceListCache = {
      workspaces: result.workspaces,
      loadedAt: Date.now(),
    };
    return result.workspaces;
  }

  async function resolveWorkspaceRef(
    ref: string,
  ): Promise<WorkspaceListItem | null> {
    // Audit B11: a workspace slug shaped like a UUID (lowercase hex
    // with hyphens) is theoretically possible. Matching on id alone
    // would miss the slug, forcing a wasteful refresh on the second
    // pass. Cheap to try both id and slug on the first pass.
    let list = await getWorkspaceList();
    let match = list.find((w) => w.id === ref || w.slug === ref);
    if (match) return match;
    // Force-refresh once — covers the case where the user was added to
    // a new workspace mid-session and the cache hasn't ticked over.
    workspaceListCache = null;
    list = await getWorkspaceList();
    match = list.find((w) => w.id === ref || w.slug === ref);
    return match ?? null;
  }

  /**
   * The isError response for a no-`workspace=` call that has no session
   * default (M-3). Lists the caller's workspaces so the agent can retry
   * with an explicit `workspace=`; mirrors the backend WORKSPACE_REQUIRED
   * envelope in intent. Reads the boot-seeded directory (cached — no extra
   * loopback on the happy path).
   */
  async function noWorkspaceError(): Promise<ToolResponse> {
    let list: WorkspaceListItem[];
    // Start from the boot-time load state; a fresh successful load below
    // supersedes it (the cache is left unseeded when boot failed, so this
    // actually retries rather than returning a stale empty list).
    let loadFailed = options.directoryLoadFailed ?? false;
    try {
      list = await getWorkspaceList();
      loadFailed = false;
    } catch {
      list = options.directory ?? [];
    }
    if (list.length === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: loadFailed
              ? "We couldn't load your workspace memberships just now — this looks like a transient backend issue, not that you have none. Retry in a moment, and reconnect if it persists."
              : "You're not an active member of any workspace, so there's nothing to act on. Create one in the Dopl web app, then reconnect.",
          },
        ],
      };
    }
    const lines = [
      `This connection has no default workspace because you belong to ${list.length} workspaces. Pass \`workspace=<slug_or_id>\` on this call — pick one:`,
      "",
      UNTRUSTED_DIRECTORY_NOTE,
      "",
    ];
    for (const w of list) {
      lines.push(`- ${inlineOr(w.name, UNNAMED_WORKSPACE)} (slug: \`${w.slug}\`, role: ${w.role})`);
    }
    return {
      isError: true,
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }

  return { getWorkspaceList, resolveWorkspaceRef, noWorkspaceError };
}
