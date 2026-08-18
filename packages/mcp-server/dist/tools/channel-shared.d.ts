/**
 * Shared resolvers for `dopl_channel`: channel-reference (slug or id) and
 * member-reference (email or user id) resolution, leaned on by both the read
 * and write op modules. ⚠ `channel-` filename prefix required by the parity
 * split-scan (parity.test.ts).
 */
import type { Channel, ChannelMessage, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * A non-empty string field of a message's metadata, or undefined. ⚠ ONE
 * definition — both the read and write lanes key thread linkage off it
 * (`taskId` / `taskTitle`), so a second copy silently drifts and one lane
 * renders a thread tag the other reported as absent.
 */
export declare function metaString(m: ChannelMessage, key: string): string | undefined;
/**
 * ⚠ THE NEUTRALIZER LIVES IN `narration.ts` — re-exported here, never
 * re-declared. Tools with no channel in them need it too (`dopl_members`
 * renders the same `profiles.display_name`, `dopl_chats` a member-typed title,
 * `server.ts` the workspace name in the instructions block and every
 * `_dopl_status` footer), so there is exactly ONE definition.
 */
export { INLINE_TEXT_MAX, inlineOr, neutralizeInline } from "./narration";
/**
 * Channel roster as `userId → display name`, for the ids a thread row carries
 * (`createdBy`, `targetUserId`). ⚠ RAW names — the render side neutralizes
 * exactly once, in {@link memberRef}.
 *
 * ⚠ FAIL-SOFT: enrichment only. A roster that 404s, 403s or times out degrades
 * to ids, never turns a successful thread read into an error the agent retries.
 */
export declare function memberNames(client: DoplClient, ref: string): Promise<Map<string, string>>;
/**
 * True when a resolver returned a ToolResponse error instead of the value.
 * Generic so it narrows both the channel and member resolvers.
 */
export declare function isErr<T>(x: T | ToolResponse): x is ToolResponse;
/**
 * Uniform not-found for a channel reference. Shared by `resolveChannelOr` and
 * by the hot read/await handlers, which skip the pre-resolve and map a route
 * 404 to this same copy.
 */
export declare function channelNotFound(ref: string): ToolResponse;
/**
 * Resolve a channel reference (slug or UUID) to a `Channel` row, or a not-found
 * error. Lists channels once INCLUDING ARCHIVED, so an archived channel stays
 * addressable, and matches on id or slug.
 *
 * Used by the write ops so a confirmation can name the channel and a bad ref is
 * caught before the mutation. ⚠ The hot read/await ops must NOT call this —
 * they pass the ref straight to the route (which resolves slug-or-id and
 * enforces visibility), avoiding a listChannels() round-trip per poll.
 */
export declare function resolveChannelOr(client: DoplClient, ref: string): Promise<Channel | ToolResponse>;
export interface ResolvedMember {
    userId: string;
    /**
     * ⚠ RENDER-SAFE already — one inline code span, never a bare name (see
     * {@link memberLabel}). Splice directly; neutralizing again strips the span's
     * own backticks and hands back a bare name, i.e. the bug.
     */
    label: string;
}
/**
 * Resolve a member reference (email or user id) to an ACTIVE workspace member,
 * or an error. ⚠ Invites are in-workspace only, so a pending/revoked match is
 * rejected with a stated reason. Reads the same listing `dopl_members` does.
 */
export declare function resolveMemberOr(client: DoplClient, ref: string): Promise<ResolvedMember | ToolResponse>;
