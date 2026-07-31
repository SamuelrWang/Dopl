/**
 * Shared resolvers for the `dopl_channel` tool. Channel-reference (slug or
 * id) resolution and member-reference (email or user id) resolution live
 * here because the read and write op modules both lean on them. The
 * registrar (channel.ts) keeps op routing; these are the cross-cutting
 * internals. The `channel-` filename prefix is required by the parity
 * split-scan (parity.test.ts).
 */
import type { Channel, ChannelMessage, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
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
export declare function metaString(m: ChannelMessage, key: string): string | undefined;
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
export declare function memberNames(client: DoplClient, ref: string): Promise<Map<string, string>>;
/**
 * True when a resolver returned a ToolResponse error instead of the
 * resolved value. Generic so it narrows both the channel and member
 * resolvers — the caller short-circuits on the error branch.
 */
export declare function isErr<T>(x: T | ToolResponse): x is ToolResponse;
/**
 * Uniform not-found error for a channel reference. Shared by the pre-resolve
 * path (resolveChannelOr, below) and the hot read/await handlers, which skip
 * the pre-resolve and instead map a route 404 to this same copy.
 */
export declare function channelNotFound(ref: string): ToolResponse;
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
export declare function resolveChannelOr(client: DoplClient, ref: string): Promise<Channel | ToolResponse>;
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
 * Resolve a member reference (email or user id) to an ACTIVE workspace
 * member, or a ToolResponse error. Invites are in-workspace only, so the
 * invitee must be an active member — a pending/revoked match is rejected
 * with a clear reason. Uses the client's existing workspace-member listing
 * (the same source `dopl_members` reads).
 */
export declare function resolveMemberOr(client: DoplClient, ref: string): Promise<ResolvedMember | ToolResponse>;
