/**
 * `dopl_channel` ROOM-LIFECYCLE op handlers: open (create a channel, or open a
 * direct 1:1 message) and invite (add a workspace member to one).
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap when SHOULD-FIX-6's
 * result-line extraction alone left that file at 503. The seam is the one its
 * own header had been describing for three waves without acting on: these two
 * ops make a ROOM and decide WHO IS IN IT, `post` decides what is said in it.
 * They share no state, no error mapping and no narration beyond `NO_NAME` — and
 * `post` is where every behaviour round lands, while these two have not changed
 * in shape since v1.1. `channel-ops-agents.ts` drew the same line for the AGENT
 * roster; this is the human half of it.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 *
 * PEER-CONTROLLED TEXT (Q1, write side). Every string below is server NARRATION
 * — no untrusted-content framing, read by the model as the tool speaking — and
 * two peer-authored values reach it:
 *
 *   - `ch.name` / `channel.name`. `resolveChannelOr` lists channels including
 *     PUBLIC ones the caller was never invited to, so the name can come from
 *     someone the agent has had no contact with. Neutralized at every site.
 *   - `member.label` — `profiles.display_name`. Render-safe by the time it
 *     arrives: `resolveMemberOr` neutralizes at the source, so the label is
 *     spliced directly and must NOT be neutralized twice.
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
