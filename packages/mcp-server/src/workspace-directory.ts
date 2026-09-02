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

import { isStandardWorkspace } from "@dopl/client";
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
 *
 * ⚠ `session pin` is the one an AGENT sets (`current_workspace(op="set")`,
 * `session-pin.ts`) and it is deliberately a DIFFERENT label from `header pin`,
 * which the transport sets: an agent debugging where its call landed must be
 * able to tell "the default I chose" from "the default my client chose".
 */
export type WorkspaceSource =
  | "per-call arg"
  | "sole membership"
  | "header pin"
  | "session pin";

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
  /**
   * 🔒 THE CONTAINER LOCK (plan §4.4 B3). When set, this session may see and
   * address exactly ONE workspace: this one. `getWorkspaceList()` answers
   * `[lockedTo]` and `resolveWorkspaceRef` answers `null` for every other ref,
   * whatever the cache holds.
   *
   * Set by `factory.ts › bootServer` when the session's pin resolves to a
   * `kind='link'` container with MORE THAN ONE active member — i.e. an agent
   * working in a room a PEER is also in. Its operator's other workspaces are
   * not that peer's business, and neither is their existence.
   *
   * ⚠ IT IS A TRIPWIRE, NOT A FENCE, AND THE DIFFERENCE MUST NOT BE DRESSED
   * AWAY. It narrows what THIS MCP connection will do. A `full`-profile session
   * has Bash and the operator's 90-day device token is on disk, so the same
   * agent can open a SECOND MCP connection with no pin, or issue the loopback
   * HTTP itself, and this object will never see either. What actually refuses
   * those is the credential lock (the token is workspace-scoped, so
   * `with-workspace-auth.ts` 403s a contradicting target) and the audience
   * ceiling in `knowledge/server/service-audience.ts`, both of which live in the
   * server that owns the rows. This lock exists so a WELL-BEHAVED agent is never
   * even shown the door — which is worth having, and is not the same as the door
   * being locked.
   */
  lockedTo?: WorkspaceListItem | null;
}

export interface WorkspaceDirectory {
  /**
   * The caller's LISTABLE memberships, cached for
   * {@link WORKSPACE_CACHE_TTL_MS}. ⚠ `kind='link'` home-channel containers are
   * excluded — they are never advertised to an agent.
   */
  getWorkspaceList(): Promise<WorkspaceListItem[]>;
  /**
   * A slug-or-UUID `workspace=` ref resolved against ALL memberships, links
   * included: explicit addressing is how a home channel is reached.
   */
  resolveWorkspaceRef(ref: string): Promise<WorkspaceListItem | null>;
  /** The isError response for a no-`workspace=` call with no session default. */
  noWorkspaceError(): Promise<ToolResponse>;
  /**
   * 🔒 THE LOCK, READABLE — the container id this session is narrowed to, or
   * null when it is not locked.
   *
   * ⚠ EXPOSED BECAUSE THE LOCK NOW HAS A CONSUMER THIS OBJECT CANNOT SERVE
   * (2026-08-28). `getWorkspaceList` narrows the WORKSPACE directory; `dopl_home`
   * and `dopl_search(scope="everywhere")` narrow a list of HOME CHANNELS, which
   * comes from `/api/home/channels` and never passes through here. Without this,
   * each of them would restate the rule — and a restated fence is the one that
   * drifts. ⚠ There is exactly ONE reader, `tools/home-scopes.ts ›
   * narrowToLock`; add a second only by routing it through that.
   */
  lockedWorkspaceId(): string | null;
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

  /** The cache, kind and all. ⚠ RESOLUTION reads this; LISTING never does. */
  async function getAllWorkspaces(): Promise<WorkspaceListItem[]> {
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

  const lockedTo = options.lockedTo ?? null;

  async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
    // 🔒 THE LOCK SHORT-CIRCUITS BEFORE THE CACHE IS EVEN READ. A locked session
    // sees its container and nothing else — including no evidence that anything
    // else exists. ⚠ It answers `[lockedTo]` rather than filtering the directory
    // through `isStandardWorkspace`, which would answer `[]`: the agent needs a
    // name to target, and hiding the room it is standing in helps nobody.
    if (lockedTo) return [lockedTo];
    return (await getAllWorkspaces()).filter(isStandardWorkspace);
  }

  async function resolveWorkspaceRef(
    ref: string,
  ): Promise<WorkspaceListItem | null> {
    // 🔒 THE LOCK ANSWERS BEFORE ANY LOOKUP, so a ref that names another
    // workspace is refused without a cache refresh — and a refused ref is
    // indistinguishable from one that names nothing, which is the same
    // no-oracle discipline the server's own 404 ordering keeps (§4).
    if (lockedTo) {
      return ref === lockedTo.id || ref === lockedTo.slug ? lockedTo : null;
    }
    // ⚠ Resolves against the UNFILTERED directory: `workspace=<link id>` is how
    // an agent acting in a home channel addresses its container, and the
    // container is deliberately absent from every listing.
    // ⚠ A workspace slug can be shaped like a UUID, so match id AND slug on the
    // first pass — id alone forces a wasteful refresh.
    let list = await getAllWorkspaces();
    let match = list.find((w) => w.id === ref || w.slug === ref);
    if (match) return match;
    // Force-refresh once — covers a mid-session membership add.
    workspaceListCache = null;
    list = await getAllWorkspaces();
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
      // ⚠ The count and the list are STANDARD memberships only (`getWorkspaceList`
      // filters through `isStandardWorkspace`). An agent that meant to act in a
      // home channel would otherwise read this as "your rooms are not here" with
      // no next step; the container id is the only handle that reaches one.
      `⚠ Home channels are not among these. They are addressed the same way — \`workspace=<container id>\` — but their ids come from \`dopl_home(op="list_channels")\`, not from this list.`,
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

  return {
    getWorkspaceList,
    resolveWorkspaceRef,
    noWorkspaceError,
    lockedWorkspaceId: () => lockedTo?.id ?? null,
  };
}
