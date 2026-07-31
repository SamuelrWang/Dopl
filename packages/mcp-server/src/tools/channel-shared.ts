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
import { inlineOr } from "./narration";
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

/**
 * THE NEUTRALIZER NOW LIVES IN `narration.ts`, and is re-exported here.
 *
 * It was written here — the read-ops fix put it in `channel-render.ts`, the
 * write-op sweep moved it here so `resolveMemberOr` below could reach it
 * without a cycle. The sweep across the REST of the MCP surface found the same
 * helper wanted by tools with no channel in them at all: `dopl_members`
 * renders the same `profiles.display_name` column, `dopl_chats` renders a
 * title another member typed, and `server.ts` splices the workspace name into
 * the MCP instructions block AND into the `_dopl_status` footer of every
 * single tool response. Keeping the definition in a file named
 * `channel-shared` would have meant either eight unrelated tools importing
 * from the channel module or — far likelier — a second copy. A copied
 * neutralizer is the exact failure mode its own note warns about, so it moved
 * rather than spread.
 *
 * RE-EXPORTED, not re-declared: the channel modules that import
 * `neutralizeInline` / `inlineOr` / `INLINE_TEXT_MAX` from here are
 * untouched, and there is still exactly ONE definition.
 */
export { INLINE_TEXT_MAX, inlineOr, neutralizeInline } from "./narration";

/**
 * The channel roster as `userId → display name`, for putting names to the ids
 * a thread row carries (`createdBy`, `targetUserId`). Raw names — the render
 * side neutralizes them, exactly once, in {@link memberRef}.
 *
 * FAIL-SOFT ON PURPOSE. This is an enrichment: a roster that 404s, 403s, or
 * times out must degrade to ids, never turn a successful thread read into an
 * error the agent might retry. The ops that call it have ALREADY established
 * the channel is visible (their own call would have 404'd first), so a failure
 * here is a second-order one.
 */
export async function memberNames(
  client: DoplClient,
  ref: string,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    for (const m of await client.listChannelMembers(ref)) {
      const name = m.displayName || m.email;
      if (m.userId && name) names.set(m.userId, name);
    }
  } catch {
    // Enrichment only — ids still render, and they are the half that matters.
  }
  return names;
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
