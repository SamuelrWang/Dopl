/**
 * Shared resolvers for `dopl_channel` (channel by slug/id, member by email/id). The `channel-`
 * filename prefix is required by the parity split-scan.
 */
import type { Channel, ChannelMessage, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** A non-empty string metadata field; one definition, since both lanes key thread linkage off it. */
export declare function metaString(m: ChannelMessage, key: string): string | undefined;
/** The one neutralizer lives in `narration.ts`; re-exported, never re-declared. */
export { INLINE_TEXT_MAX, inlineOr, neutralizeInline } from "./narration";
/** Roster as `userId → raw name` (the render neutralizes once). Fail-soft: enrichment only, ids
 *  still render. */
export declare function memberNames(client: DoplClient, ref: string): Promise<Map<string, string>>;
/** The one `isErr` for every lane; object-guarded, so a non-object rejection never throws on `in`. */
export declare function isErr<T>(x: T | ToolResponse): x is ToolResponse;
/** Uniform channel not-found, also used by the hot read/hold paths that map a route 404. */
export declare function channelNotFound(ref: string): ToolResponse;
/** Channel by id or slug, or not-found. For write ops only: hot read/hold paths pass the ref to the
 *  route (which resolves and enforces visibility) to avoid a list per poll. */
export declare function resolveChannelOr(client: DoplClient, ref: string): Promise<Channel | ToolResponse>;
export interface ResolvedMember {
    userId: string;
    /** Already render-safe (one code span); neutralizing again strips its backticks. */
    label: string;
}
/** Member by email or user id; only an ACTIVE member resolves (pending/revoked refused, with why). */
export declare function resolveMemberOr(client: DoplClient, ref: string): Promise<ResolvedMember | ToolResponse>;
