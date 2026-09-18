import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { isStandardWorkspace, type WorkspaceKind } from "@/features/workspaces/types";

/**
 * 🔒 **IS A CHANNEL A SCOPE A RESOURCE CAN BE LENT TO HERE?** — the container
 * KIND fence on every channel-scoped grant (Samuel's ruling 2026-09-17).
 *
 * ── THE RULING, VERBATIM ───────────────────────────────────────────────────
 *
 * *"for workspaces, I don't want knowledge bases to be scoped to specific
 * channels. Knowledge bases and workspaces are scoped to the entire workspace,
 * not a specific channel. … There's no such thing as a knowledge base being
 * shared to just a channel, because the whole workspace is scoped. The idea of a
 * workspace is that everyone in the workspace should have access, essentially,
 * to all resources. … In workspaces, resource access is not scoped by channels.
 * It's instead scoped by teams."*
 *
 * ── WHAT IT NARROWS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
 *
 * ⚠ **THE MECHANISM IS NOT DELETED — IT IS FENCED BY CONTAINER KIND.** A HOME
 * channel is a `kind='link'` container holding exactly one channel (INVARIANTS
 * §4A), so "share into this channel" there IS the container grant and is the
 * whole of Samuel's home-channel sharing model. That behaviour is unchanged.
 * A `kind='personal'` container has one member and is likewise untouched.
 * **Only `kind='standard'` refuses.**
 *
 * ⚠ **THE TEST IS THE POSITIVE ONE** — `workspaces/types.ts ›
 * isStandardWorkspace`, `(kind ?? "standard") === "standard"` (§4A, F-295). A
 * `<> 'link'` spelling would silently refuse every kind added to the union
 * later, `personal` included, which is the inverse mistake and just as silent.
 * ⚠ It is the opposite spelling from `knowledge/server/repository-audience.ts ›
 * findWorkspaceKind`'s caller, and deliberately so: the agent CEILING asks *"is
 * this specifically a link container"* because narrowing an undesigned kind is a
 * guess, while this asks *"is this specifically a standard workspace"* because
 * refusing an undesigned kind is the same guess from the other side. Both are
 * positive tests of the kind they are about.
 *
 * ── TWO DOORS, ONE RULE ────────────────────────────────────────────────────
 *
 *   WRITE — {@link assertChannelScopeAllowedInContainer}, called by every door
 *   that can write a `scope_type='channel'` row once it has already resolved the
 *   channel's container: `shared/grants/service.ts › assertGrantableScope` and
 *   `knowledge/server/service-channel-grants.ts › setChannelKnowledgeGrant`
 *   (which `POST /api/knowledge/bases`'s `shareToChannelId` branch also passes
 *   through). It refuses with {@link SCOPE_NOT_ALLOWED_IN_WORKSPACE}.
 *
 *   READ — {@link channelsWhereScopeIsIgnored}, called by
 *   `resource-grant-reach.ts › grantedResourceIds`. An EXISTING channel-scoped
 *   row in a standard workspace stops widening anybody's read; workspace-wide
 *   visibility and TEAM grants decide, which is what the ruling names.
 *
 * ⚠ **THE WRITE DOOR TAKES A CONTAINER ID, THE READ DOOR TAKES CHANNEL IDS**,
 * and that asymmetry is the query budget rather than two rules: every write door
 * has already resolved the channel to its container by the time it asks (that
 * resolution IS its 404 fence), while the read path holds only the `scope_id`s
 * off the grant rows.
 */

/** The refusal's code. ⚠ ONE string for both write doors, so a client can branch
 *  on the rule rather than on a route. */
export const SCOPE_NOT_ALLOWED_IN_WORKSPACE = "SCOPE_NOT_ALLOWED_IN_WORKSPACE";

/** The refusal, worded once. ⚠ It NAMES THE RULE and the remedy: a caller told
 *  only "forbidden" goes and greps the repo. */
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
 * Ceiling on the container-kind fan.
 *
 * ⚠ **ITS OWN CONSTANT OVER ITS OWN TABLES**, like `CHANNEL_GRANT_LIMIT` (200)
 * and `CONTAINER_CHANNEL_LIMIT` (200) are: this bounds `channels` and
 * `workspaces`, not the grant fan. Its INPUT is already a page
 * `GRANT_REACH_LIMIT` bounded, so it can never be the binding constraint — it
 * exists because PostgREST truncates an un-limited select SILENTLY and a bound
 * nobody stated is a bound nobody can debug.
 */
const SCOPE_KIND_LIMIT = 500;

/** `workspaces.kind` for one container, or `null` when the row is gone. */
async function containerKind(workspaceId: string): Promise<WorkspaceKind | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("kind")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return ((data as { kind: WorkspaceKind | null }).kind ?? null);
}

/**
 * May a resource be lent to a CHANNEL of this container?
 *
 * ⚠ **A MISSING CONTAINER ANSWERS `false`.** The row vanishing mid-request is
 * not evidence that channel scope is allowed, and every caller has already
 * proved a membership of it one fence earlier — so `null` here means the write
 * is about to fail anyway and refusing is the honest order.
 */
export async function channelScopeAllowedInContainer(
  workspaceId: string
): Promise<boolean> {
  const kind = await containerKind(workspaceId);
  if (kind === null) return false;
  // 🔒 **A POSITIVE TEST OF THE KIND THE RULING NAMES, AND THE `if` SPELLING IS
  // PART OF IT** (F-564, `workspaces/home-channel-derivation.test.ts`). A
  // `return !isStandardWorkspace(…)` is the negation shape that census exists to
  // keep out of the tree: it reads as "derive home-ness from not-standard-ness",
  // where what this actually says is "a STANDARD workspace refuses".
  if (isStandardWorkspace({ kind })) return false;
  return true;
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
 * ⚠ **TWO REASONS TO IGNORE, AND BOTH FAIL CLOSED.** A channel whose container
 * is `standard` (the ruling), and a channel whose container cannot be read at
 * all (the row is gone, so the grant is about to be garbage-collected by
 * `drop_resource_grants_for_scope`). Neither is evidence that a read should be
 * widened.
 *
 * ⚠ TWO QUERIES, and NEITHER runs when there is nothing to ask about — the
 * channel branch of `grantedResourceIds` is already the uncommon one.
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

  const ignored = new Set<string>();
  for (const channelId of unique) {
    const container = containerByChannel.get(channelId);
    const kind = container === undefined ? undefined : kinds.get(container);
    // ⚠ `undefined` (no channel row, or no workspace row) AND `standard` both
    // ignore. Only a container we READ and found non-standard admits.
    if (kind === undefined || kind === null || isStandardWorkspace({ kind })) {
      ignored.add(channelId);
    }
  }
  return ignored;
}
