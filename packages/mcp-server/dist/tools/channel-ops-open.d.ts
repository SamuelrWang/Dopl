/**
 * `dopl_channel` ROOM-LIFECYCLE op handlers: open (create a channel, or a
 * direct 1:1) and invite (add a workspace member). ⚠ `channel-` filename prefix
 * required by the parity split-scan (parity.test.ts).
 *
 * ⚠ Every string below is server NARRATION with no untrusted framing, and two
 * peer-authored values reach it:
 *   - `ch.name` / `channel.name` — `resolveChannelOr` lists PUBLIC channels the
 *     caller was never invited to, so the name can come from someone the agent
 *     never contacted. Neutralized at every site.
 *   - `member.label` (`profiles.display_name`) — already render-safe from
 *     `resolveMemberOr`. ⚠ Do NOT neutralize twice.
 */
import type { ChannelVisibility, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** Options for opOpen — a normal channel, or a `direct` message with `member`. */
interface OpenOptions {
    direct?: boolean;
    member?: string;
    name?: string;
    topic?: string;
    visibility?: ChannelVisibility;
}
export declare function opOpen(client: DoplClient, opts: OpenOptions): Promise<ToolResponse>;
export declare function opInvite(client: DoplClient, channelRef: string, memberRef: string): Promise<ToolResponse>;
export {};
