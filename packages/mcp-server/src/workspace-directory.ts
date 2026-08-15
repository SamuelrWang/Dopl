/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in: membership caching, slug→id resolution, and the
 * "you must pass `workspace=`" refusal.
 *
 * ⚠ FAIL-CLOSED throughout. A blank `workspace=` is rejected by the caller in
 * `registrar.ts`; 0 or 2+ memberships with no pin gets
 * {@link WorkspaceDirectory.noWorkspaceError}, never a guessed workspace; and a
 * FAILED boot directory load does not seed the cache, so the first resolution
 * retries instead of serving a bogus empty list for a full TTL.
 */

import type { DoplClient, WorkspaceListItem, WorkspaceRole } from "@dopl/client";
import type { ToolResponse } from "./tools/respond.js";
import { inlineOr } from "./tools/narration.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";

/**
 * Session default workspace, resolved once at boot (X-Workspace-Id pin, else
 * the sole membership). Read by `appendDoplStatus`. ⚠ Null on 0 or 2+
 * memberships with no pin — a no-arg tool call is then REFUSED, so nothing is
 * silently routed to a guessed workspace.
 */
export interface ActiveWorkspaceState {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
}

/**
 * How the workspace a call hit was chosen — surfaced verbatim in the
 * `_dopl_status` footer so the agent can confirm targeting.
 */
export type WorkspaceSource = "per-call arg" | "sole membership" | "header pin";

export interface EffectiveWorkspace extends ActiveWorkspaceState {
  source: WorkspaceSource;
}

/** The boot-resolved directory state this module is constructed from. */
export interface WorkspaceDirectoryOptions {
  /**
   * Caller's full active-membership directory from the boot `listWorkspaces()`.
   * Seeds the cache so per-call `workspace=` needs no extra loopback.
   */
  directory?: WorkspaceListItem[];
  /**
   * ⚠ True when the boot `listWorkspaces()` FAILED, as opposed to a genuine
   * empty directory: steers the copy to "couldn't load — retry", and suppresses
   * seeding a bogus empty cache so a later resolution retries.
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

/** Membership cache TTL (slug→id). Seeded at boot, refreshed on demand. */
const WORKSPACE_CACHE_TTL_MS = 60_000;

export function createWorkspaceDirectory(
  client: DoplClient,
  options: WorkspaceDirectoryOptions = {},
): WorkspaceDirectory {
  // ⚠ Seed from the boot directory, but NOT when the boot load FAILED — that
  // caches a bogus empty list for a full TTL and masks the failure. Null lets
  // the first `workspace=` / no-default path retry.
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
    // ⚠ A workspace slug can be shaped like a UUID, so match id AND slug on the
    // first pass — id alone forces a wasteful refresh.
    let list = await getWorkspaceList();
    let match = list.find((w) => w.id === ref || w.slug === ref);
    if (match) return match;
    // Force-refresh once — covers a mid-session membership add.
    workspaceListCache = null;
    list = await getWorkspaceList();
    match = list.find((w) => w.id === ref || w.slug === ref);
    return match ?? null;
  }

  /**
   * isError for a no-`workspace=` call with no session default. Lists the
   * caller's workspaces so the agent can retry explicitly; mirrors the backend
   * WORKSPACE_REQUIRED envelope. Reads the boot-seeded cache — no extra
   * loopback on the happy path.
   */
  async function noWorkspaceError(): Promise<ToolResponse> {
    let list: WorkspaceListItem[];
    // Start from the boot-time load state; a fresh successful load supersedes
    // it (an unseeded cache after a failed boot means this really retries).
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
