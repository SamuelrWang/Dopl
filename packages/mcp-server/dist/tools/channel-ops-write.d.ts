/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or activity event). The
 * first-class thread ops moved to `channel-ops-threads.ts` at the §2 500-line
 * cap. Maps @dopl/client 4xx collisions to actionable messages. Routed from the
 * registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 *
 * PEER-CONTROLLED TEXT (Q1, write side). The read ops were swept first and the
 * write ops were never enumerated, so the same defect survived here: every
 * string below is server NARRATION — no untrusted-content framing, read by the
 * model as the tool speaking — and two peer-authored values are spliced into it.
 *
 *   - `ch.name`, at nearly every site in this file. `resolveChannelOr` lists
 *     channels including PUBLIC ones the caller was never invited to, so the
 *     name can come from someone the agent has had no contact with; the reach is
 *     lower than `op="list"`'s (the agent must name the channel) but it is not
 *     zero. `features/channels/schema.ts` bounded it at 120 characters with NO
 *     charset rule, so it could carry the newlines that forge a line — that gap
 *     is closed there too now, in the same change.
 *   - `member.label` / `toLabel` — `profiles.display_name`. Render-safe by the
 *     time it arrives: `resolveMemberOr` neutralizes at the source, so the label
 *     is spliced directly here and must NOT be neutralized twice.
 *
 * Peer TITLES (thread names) render in `threadLinkageNote` below and across
 * `channel-ops-threads.ts`; the untrusted-content headers they carry live in
 * `channel-render.ts` with the read side's, one definition each.
 */
import type { ChannelMessageInput, ChannelVisibility, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
    kind?: ChannelMessageInput["kind"];
    metadata?: Record<string, unknown>;
    clientMsgId?: string;
    /** Address the post to one member (email or user id, resolved like invite). */
    to?: string;
    /** One-line intent for the receiver's notification. */
    summary?: string;
    /** A thread id — threads this post under that thread's card (server-validated). */
    thread?: string;
}
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
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
