import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";

/**
 * DATA ACCESS FOR THE **WORKSPACE-WIDE AWAIT** — the `channel`-less hold, which
 * watches every channel the caller belongs to at once.
 *
 * ⚠ ITS OWN MODULE FOR TWO REASONS, AND NEITHER IS TIDINESS.
 *  1. `repository.ts` is AT 498 OF THE 500-LINE CAP (measured 2026-08-22), so
 *     the membership∩channels read below could not go where its siblings live.
 *  2. More importantly: the per-channel await's reads are the HOTTEST path in
 *     the tree and are tuned as a set (`repository-messages.ts ›
 *     hasMessagesAfter` / `listMessages`). A second pair of queries with a
 *     DIFFERENT fence sitting in the same file is how one of them gets "unified"
 *     with the other and quietly inherits the wrong `WHERE`.
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT.** The `channelIds`
 * argument is therefore THE ENTIRE FENCE, and it must only ever be a set this
 * request has PROVEN — {@link listMemberChannelRefs} is the only legitimate
 * source of one. ⚠ Never build that array from anything a caller sent.
 */

/** One channel the caller is a member of, with the labels a workspace-wide page
 *  needs to say WHERE a message came from. */
export interface MemberChannelRef {
  id: string;
  name: string;
  slug: string;
}

/**
 * ⚠ PostgREST truncates an un-limited select SILENTLY. A workspace's channel
 * count is small (a room per working relationship), so this exists to make
 * truncation loud rather than to bound anything anyone will reach.
 */
const MEMBER_CHANNEL_LIMIT = 500;

/**
 * Cap on ONE workspace-wide await page. ⚠ The same 200 the per-channel poll
 * uses (`service-reads.ts › pollChannelMessages`), deliberately: the page is
 * wider in CHANNELS, not in messages, and a bigger cap here would let one busy
 * room's burst crowd out every other channel's message from the same page.
 */
const WORKSPACE_AWAIT_PAGE_LIMIT = 200;

/**
 * **THE PROOF OF ACCESS FOR A WORKSPACE-WIDE HOLD** — every LIVE channel in this
 * workspace that the caller is a member of.
 *
 * ⚠ **MEMBERSHIP, AND DELIBERATELY NOT `op="read"`'s VISIBILITY.** A channel
 * read admits a non-member to a PUBLIC channel (§5), and this read does not.
 * That is a NARROWING, never a widening, and it is stated rather than implied
 * because "matches what read would show" is the natural thing to assume:
 *   - the op's own contract is "every channel you are a MEMBER of";
 *   - an await is a WAKE primitive, and being woken by every public room in the
 *     workspace — rooms nobody invited this agent into — is noise that would
 *     make the workspace hold useless in exactly the workspaces it is for;
 *   - fewer rows can never be a leak, and the private-channel case (the one that
 *     would be a leak) is excluded by the same predicate either way.
 *
 * ⚠ `deleted_at IS NULL` is not optional: a soft-deleted channel is NOT-FOUND to
 * every other read, and a membership row outlives the tombstone. Without it a
 * workspace hold would keep delivering from a channel `op="read"` answers 404
 * for.
 * ⚠ ARCHIVED channels are KEPT. Archive is a sidebar state, not a revocation —
 * `resolveReadableChannelId` admits an archived channel and so does this.
 *
 * TWO QUERIES, which is the SAME budget the per-channel hold's recheck pays on a
 * private channel (`revalidateAwaitAccess`: channel + membership). The workspace
 * hold is not cheaper per recheck, and it replaces N of them.
 */
export async function listMemberChannelRefs(
  workspaceId: string,
  userId: string
): Promise<MemberChannelRef[]> {
  const db = supabaseAdmin();
  const { data: memberships, error: memberError } = await db
    .from("channel_members")
    .select("channel_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .limit(MEMBER_CHANNEL_LIMIT);
  if (memberError) throw memberError;
  const ids = (
    (memberships ?? []) as Array<{ channel_id: string }>
  ).map((m) => m.channel_id);
  if (ids.length === 0) return [];

  const { data, error } = await db
    .from("channels")
    .select("id, name, slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("id", ids)
    .limit(MEMBER_CHANNEL_LIMIT);
  if (error) throw error;
  return (data ?? []) as MemberChannelRef[];
}

/**
 * THE AUTHOR-EXCLUSION PREDICATE — `author_user_id IS NULL OR <> $1`.
 *
 * ⚠ A DELIBERATE SECOND COPY of `repository-messages.ts › excludeAuthorFilter`,
 * and the duplication is pinned by `repository-await-workspace.test.ts` rather
 * than removed. Exporting one from the other would put a shared helper between
 * two query pairs whose fences differ, which is precisely the coupling this
 * module was split to avoid — and the rule the string encodes (a NULL author is
 * never "my own post", so a SYSTEM row must NOT be dropped by an exclusion) is
 * the one thing that must not drift. See that file's docblock for the incident.
 *
 * ⚠ `userId` is a uuid at every entry (`AwaitQuerySchema`, `opAwait`'s
 * `selfUserId`), so interpolating into PostgREST's `or` grammar is safe.
 */
function excludeAuthorFilter(userId: string): string {
  return `author_user_id.is.null,author_user_id.neq.${userId}`;
}

/**
 * IS ANYTHING PAST `since` IN ANY OF THESE CHANNELS — the existence probe behind
 * one workspace-await tick.
 *
 * ⚠ MUST MIRROR {@link listWorkspaceMessagesAfter} FILTER FOR FILTER. A probe
 * that hits on a row the read then drops spins the hold (fetch, empty, continue)
 * once per tick; a probe that MISSES a row the read would return is the
 * invisibility bug. Same rule, same reason, as the per-channel pair.
 */
export async function hasWorkspaceMessagesAfter(
  channelIds: string[],
  since: number | undefined,
  excludeAuthor?: string
): Promise<boolean> {
  if (channelIds.length === 0) return false;
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("seq")
    .in("channel_id", channelIds);
  if (since !== undefined) query = query.gt("seq", since);
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * One workspace-wide await page: `seq > since` across `channelIds`, ASCENDING,
 * capped.
 *
 * ⚠ **`seq` IS WORKSPACE-GLOBAL AND GAPPY, WHICH IS THE WHOLE REASON THIS
 * WORKS.** The same property that makes a per-channel seq RANGE meaningless as a
 * message count (INVARIANTS §5) makes ONE cursor legal across every channel at
 * once: ordering by it interleaves channels in true arrival order, and a caller
 * advancing to the highest seq on the page has provably seen everything below it
 * in EVERY channel on the page. No second cursor, no per-channel bookkeeping.
 *
 * ⚠ ALWAYS CURSORED. Unlike `listMessages` there is no cursorless mode: a
 * workspace hold without a cursor would return the newest N across the whole
 * workspace, which is a firehose and not a wake. The route's schema requires
 * `since`, and this signature keeps it optional only so the type matches the
 * probe above.
 */
export async function listWorkspaceMessagesAfter(
  channelIds: string[],
  since: number | undefined,
  excludeAuthor?: string
): Promise<ChannelMessageRow[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("*")
    .in("channel_id", channelIds);
  if (since !== undefined) query = query.gt("seq", since);
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query
    .order("seq", { ascending: true })
    .limit(WORKSPACE_AWAIT_PAGE_LIMIT);
  if (error) throw error;
  return (data ?? []) as ChannelMessageRow[];
}
