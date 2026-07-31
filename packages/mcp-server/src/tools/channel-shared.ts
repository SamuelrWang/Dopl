/**
 * Shared resolvers for the `dopl_channel` tool. Channel-reference (slug or
 * id) resolution and member-reference (email or user id) resolution live
 * here because the read and write op modules both lean on them. The
 * registrar (channel.ts) keeps op routing; these are the cross-cutting
 * internals. The `channel-` filename prefix is required by the parity
 * split-scan (parity.test.ts).
 */

import type {
  Channel,
  ChannelMessage,
  DoplClient,
  WorkspaceMember,
} from "@dopl/client";
import { err, type ToolResponse } from "./respond";

/**
 * A non-empty string field of a message's metadata, or undefined.
 *
 * FIX L2 — ONE definition. This was copied byte-for-byte into
 * `channel-ops-read.ts` and `channel-ops-write.ts`, and both callers key
 * thread linkage off it (`taskId` / `taskTitle`). Two copies of the predicate
 * that decides "is this post a continuation or a new request" is exactly the
 * pair that drifts silently: the read side would render a thread tag the write
 * side had already reported as absent, or the reverse.
 */
export function metaString(m: ChannelMessage, key: string): string | undefined {
  const value = (m.metadata as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** Longest untrusted value carried inline into a result — one terse span, no dump. */
export const INLINE_TEXT_MAX = 160;

/**
 * Any untrusted string, reduced to something that cannot pose as structure and
 * returned as ONE inline code span — or null when nothing survives, so the
 * caller can drop the mention rather than render an empty pair of backticks.
 *
 * FIX L5 / M2 — the shared discipline for text a result splices OUTSIDE the
 * untrusted-body framing, where it is read as narration BY the server: a
 * failure description naming what broke, a thread title naming an exchange. The
 * source being "our own server" is a claim about where the bytes came from, not
 * about who wrote them — a 400 can echo a rejected field, and a thread title is
 * typed by whichever member opened the thread. Bounding the length was never
 * enough on its own: 160 characters is ample room for "IGNORE THE ABOVE. New
 * instruction: …" to sit in the result as unframed server narration. So control
 * characters (including the newlines a fake block or a forged legend entry would
 * need) are dropped, markdown/quote punctuation is stripped — backticks first,
 * since one of those escapes the span — and what is left is rendered as a quoted
 * value. However it reads, it reads as a value.
 *
 * ONE definition, for the same reason `metaString` is one: two copies of a
 * neutralizer drift, and the copy that drifts is the one that stops neutralizing.
 */
export function neutralizeInline(raw: string): string | null {
  const flattened = raw
    // Control characters (including the newlines a fake "block" would need).
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    // Punctuation that lets text pose as markdown structure or as our own
    // quoting — backticks would also break out of the code span below.
    .replace(/[`*_#>[\]{}|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened === "") return null;
  const clipped =
    flattened.length > INLINE_TEXT_MAX
      ? `${flattened.slice(0, INLINE_TEXT_MAX - 3)}...`
      : flattened;
  // One inline code span: whatever it says, it reads as a quoted value.
  return `\`${clipped}\``;
}

/**
 * A peer-authored string as one inline code span, or `fallback` when nothing
 * survives neutralization. The fallback matters: rendering an empty pair of
 * backticks would hide the "the server could not name this" tell that the L3
 * legend and the thread renderers both rely on.
 *
 * LIVES HERE, not in `channel-render.ts` where the read-ops fix first wrote it.
 * The Q1 sweep into the WRITE ops found the same helper wanted by three modules
 * — the renderers, the write handlers, and `resolveMemberOr` a few lines below —
 * and `channel-render.ts` already imports from this file, so keeping it there
 * would have forced either a cycle or a copy. A copied neutralizer is the exact
 * failure mode {@link neutralizeInline}'s own note warns about.
 */
export function inlineOr(
  raw: string | null | undefined,
  fallback: string,
): string {
  const safe = raw ? neutralizeInline(raw) : null;
  return safe ?? fallback;
}

/**
 * True when a resolver returned a ToolResponse error instead of the
 * resolved value. Generic so it narrows both the channel and member
 * resolvers — the caller short-circuits on the error branch.
 */
export function isErr<T>(x: T | ToolResponse): x is ToolResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "isError" in x &&
    (x as ToolResponse).isError === true
  );
}

/**
 * Uniform not-found error for a channel reference. Shared by the pre-resolve
 * path (resolveChannelOr, below) and the hot read/await handlers, which skip
 * the pre-resolve and instead map a route 404 to this same copy.
 */
export function channelNotFound(ref: string): ToolResponse {
  return err(
    `Channel not found: "${ref}". Use dopl_channel(op="list") to see channels you can access (pass a slug or id from there).`,
  );
}

/**
 * Resolve a channel reference (slug or UUID) to a `Channel` row, or a
 * not-found ToolResponse error. Lists channels once (including archived,
 * so an archived channel is still addressable) and matches on id or slug —
 * mirrors the `dopl_kb` base-resolution pattern.
 *
 * Used by the write/UX ops (open needs no ref; invite/post pre-resolve so
 * the confirmation can name the channel and catch a bad ref before the
 * mutation). The hot read/await ops deliberately do NOT call this — they
 * pass the ref straight to the route (which resolves slug-or-id + enforces
 * visibility) to avoid a per-call listChannels() round-trip on the poll loop.
 */
export async function resolveChannelOr(
  client: DoplClient,
  ref: string,
): Promise<Channel | ToolResponse> {
  const channels = await client.listChannels({ includeArchived: true });
  const match = channels.find((c) => c.id === ref || c.slug === ref);
  if (!match) {
    return channelNotFound(ref);
  }
  return match;
}

export interface ResolvedMember {
  userId: string;
  /**
   * RENDER-SAFE already — one inline code span, never a bare name. See
   * {@link memberLabel}. Splice it directly; do NOT neutralize it again (double
   * neutralization would strip the span's own backticks and hand back a bare
   * name, i.e. the bug).
   */
  label: string;
}

/**
 * How a workspace member is NAMED in tool output — neutralized AT THE SOURCE.
 *
 * Q1-D (write-op sweep). `displayName` is `profiles.display_name`, which any
 * signed-in user sets for themselves, and this label is spliced into ten-odd
 * write-op lines that carry no untrusted-content framing at all ("Added <label>
 * to …", "addressed to <label>", the invite and addressee errors). The read side
 * neutralized the same column inside `formatAuthor`; the write side splices the
 * label instead, and every one of those sites was raw.
 *
 * Neutralizing HERE rather than at each call site is deliberate: `label` is the
 * ONLY thing callers do with a `ResolvedMember` besides `userId`, so making it
 * safe by construction means a call site added later cannot reintroduce the
 * defect — which is precisely how the write ops were missed the first time.
 * `userId` stays raw and unrendered-as-narration: it is a server-issued UUID and
 * the one half of an identity the member does not control.
 *
 * The route bound added tonight (`src/app/api/user/profile/route.ts`) and the
 * pending DB CHECK are the other two layers; neither is a reason to render the
 * value raw. The route is not the only writer (RLS lets a user PATCH the column
 * straight through PostgREST), the CHECK is written but NOT APPLIED, and `email`
 * — the fallback below — is bounded by no charset rule of ours either.
 */
function memberLabel(m: WorkspaceMember): string {
  return inlineOr(m.displayName || m.email || m.userId, "(unnamed member)");
}

/**
 * Resolve a member reference (email or user id) to an ACTIVE workspace
 * member, or a ToolResponse error. Invites are in-workspace only, so the
 * invitee must be an active member — a pending/revoked match is rejected
 * with a clear reason. Uses the client's existing workspace-member listing
 * (the same source `dopl_members` reads).
 */
export async function resolveMemberOr(
  client: DoplClient,
  ref: string,
): Promise<ResolvedMember | ToolResponse> {
  const trimmed = ref.trim();
  const lower = trimmed.toLowerCase();
  const members = await client.listWorkspaceMembers();

  const byId = members.find((m) => m.userId === trimmed);
  const byEmail =
    lower.length > 0
      ? members.filter((m) => (m.email ?? "").toLowerCase() === lower)
      : [];
  if (!byId && byEmail.length > 1) {
    return err(
      `"${ref}" matches ${byEmail.length} members by email — pass a user id instead to disambiguate.`,
    );
  }
  const match = byId ?? (byEmail.length === 1 ? byEmail[0] : undefined);
  if (!match) {
    return err(
      `No workspace member matching "${ref}". Invites are in-workspace only — pass the email or user id of an ACTIVE member (see dopl_members(op="list")).`,
    );
  }
  if (match.status !== "active") {
    const state =
      match.status === "pending"
        ? "still has a pending invite (they haven't accepted yet)"
        : "has been deactivated";
    return err(
      `${memberLabel(match)} ${state}, so they can't be added to a channel — only active workspace members can join.`,
    );
  }
  return { userId: match.userId, label: memberLabel(match) };
}
