import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { isStandardWorkspace, type WorkspaceKind } from "@/features/workspaces/types";

/**
 * 🔒 **IS A CHANNEL A SCOPE A RESOURCE CAN BE LENT TO HERE?** — the container-KIND
 * fence on every channel-scoped grant.
 *
 * Samuel's ruling 2026-09-17: *"In workspaces, resource access is not scoped by
 * channels. It's instead scoped by teams."*
 *
 * ⚠ **FENCED BY KIND, NOT DELETED.** A home channel is a `kind='link'` container
 * holding one channel (INVARIANTS §4A), so "share into this channel" there IS the
 * container grant; `kind='home'` has one member. **Only `standard` refuses.**
 *
 * Three doors, one rule:
 *   - WRITE — {@link assertChannelScopeAllowedInContainer}: `shared/grants/service.ts ›
 *     assertGrantableScope` and `knowledge/server/service-channel-grants.ts ›
 *     setChannelKnowledgeGrant`. Refuses with {@link SCOPE_NOT_ALLOWED_IN_WORKSPACE}.
 *   - READ — {@link channelsWhereScopeIsIgnored}: `resource-grant-reach.ts ›
 *     grantedResourceIds` drops rows an old write left behind.
 *   - DISPLAY — {@link channelScopeAllowedForKind}, the synchronous half, for a route
 *     that already holds `auth.workspaceKind` and is deciding what to RENDER.
 *
 * ⚠ **THE WRITE DOOR TAKES A CONTAINER ID, THE READ DOOR TAKES CHANNEL IDS.** Every
 * write door has already resolved the channel to its container (that resolution is its
 * 404 fence); the read path holds only `scope_id`s.
 */

/** The refusal's code. ⚠ ONE string for both write doors, so a client branches on the
 *  rule rather than on a route. */
export const SCOPE_NOT_ALLOWED_IN_WORKSPACE = "SCOPE_NOT_ALLOWED_IN_WORKSPACE";

/** The refusal, worded once. ⚠ It NAMES THE RULE and the remedy: a caller told only
 *  "forbidden" goes and greps the repo. */
export function channelScopeRefusal(): HttpError {
  return new HttpError(
    400,
    SCOPE_NOT_ALLOWED_IN_WORKSPACE,
    "In a workspace, resources are scoped to the whole workspace, not to one " +
      "channel — everyone in the workspace reaches them. Narrow access with a " +
      "TEAM instead. Channel scope exists only for home channels."
  );
}

/**
 * 🔒 **THE RULE ITSELF, AND THE ONLY SPELLING OF IT.** Every other function here and
 * every route that renders a channel-sharing control asks THIS.
 *
 * ⚠ **A POSITIVE TEST OF THE KIND THE RULING NAMES** (`isStandardWorkspace`,
 * `(kind ?? "standard") === "standard"`, F-295). A `=== "link"` spelling would silently
 * refuse every kind added to the union later, `home` included. ⚠ An ABSENT kind is
 * `standard` and refuses; that is the same fail-closed reading the SQL twin's
 * `COALESCE(kind,'standard')` takes.
 *
 * ⚠ **THE THREE-STATEMENT SPELLING IS PART OF IT** (F-564,
 * `workspaces/home-channel-derivation.test.ts`): `!isStandardWorkspace(…)` reads as
 * "derive home-ness from not-standard-ness", which is the shape that census exists to
 * keep out of the tree. What this says is "a STANDARD workspace refuses".
 */
export function channelScopeAllowedForKind(
  kind: WorkspaceKind | null | undefined
): boolean {
  if (kind === null || kind === undefined) return false;
  if (isStandardWorkspace({ kind })) return false;
  return true;
}

/**
 * Ceiling on the container-kind fan.
 *
 * ⚠ **ITS OWN CONSTANT OVER ITS OWN TABLES**, like `CHANNEL_GRANT_LIMIT` (200) is: this
 * bounds `channels` and `workspaces`, not the grant fan. Its input is already a
 * `GRANT_REACH_LIMIT` page, so it can never be the binding constraint — it exists
 * because PostgREST truncates an un-limited select SILENTLY.
 */
const SCOPE_KIND_LIMIT = 500;

/** `workspaces.kind` for one container. ⚠ `null` for BOTH "no row" and "no kind" — the
 *  two answer the same way, so nothing downstream needs to tell them apart. */
async function containerKind(workspaceId: string): Promise<WorkspaceKind | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("kind")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as { kind: WorkspaceKind | null } | null)?.kind ?? null;
}

/**
 * May a resource be lent to a CHANNEL of this container?
 *
 * ⚠ **A MISSING CONTAINER ANSWERS `false`.** The row vanishing mid-request is not
 * evidence that channel scope is allowed, and every caller has already proved a
 * membership of it one fence earlier.
 */
export async function channelScopeAllowedInContainer(
  workspaceId: string
): Promise<boolean> {
  return channelScopeAllowedForKind(await containerKind(workspaceId));
}

/** The write-door half: {@link channelScopeAllowedInContainer} or the refusal. */
export async function assertChannelScopeAllowedInContainer(
  workspaceId: string
): Promise<void> {
  if (!(await channelScopeAllowedInContainer(workspaceId))) {
    throw channelScopeRefusal();
  }
}

/**
 * 🔒 The READ half — which of `channelIds` carry grants that must be IGNORED.
 *
 * ⚠ **TWO REASONS TO IGNORE, AND BOTH FAIL CLOSED.** A channel whose container is
 * `standard` (the ruling), and a channel whose container cannot be read at all (the row
 * is gone, so the grant is about to be collected by `drop_resource_grants_for_scope`).
 *
 * ⚠ TWO QUERIES, and NEITHER runs when there is nothing to ask about.
 */
export async function channelsWhereScopeIsIgnored(
  channelIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (channelIds.length === 0) return new Set();
  const db = supabaseAdmin();
  const unique = [...new Set(channelIds)];
  const { data: channelRows, error: channelError } = await db
    .from("channels")
    .select("id, workspace_id")
    .in("id", unique)
    .limit(SCOPE_KIND_LIMIT);
  if (channelError) throw channelError;
  const containerByChannel = new Map(
    ((channelRows ?? []) as Array<{ id: string; workspace_id: string }>).map(
      (r) => [r.id, r.workspace_id] as const
    )
  );

  const containerIds = [...new Set(containerByChannel.values())];
  const kinds = new Map<string, WorkspaceKind | null>();
  if (containerIds.length > 0) {
    const { data: wsRows, error: wsError } = await db
      .from("workspaces")
      .select("id, kind")
      .in("id", containerIds)
      .limit(SCOPE_KIND_LIMIT);
    if (wsError) throw wsError;
    for (const row of (wsRows ?? []) as Array<{
      id: string;
      kind: WorkspaceKind | null;
    }>) {
      kinds.set(row.id, row.kind ?? null);
    }
  }

  // ⚠ A channel with no row, and a container with no row, both land on `undefined` and
  // both ignore. Only a container we READ and found non-standard admits.
  const ignored = new Set<string>();
  for (const channelId of unique) {
    const container = containerByChannel.get(channelId);
    const kind = container === undefined ? null : kinds.get(container) ?? null;
    if (!channelScopeAllowedForKind(kind)) ignored.add(channelId);
  }
  return ignored;
}
