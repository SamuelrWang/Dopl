/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 * Resolve the addressing, make the call, map the 4xx, hand the outcome to the
 * modules that narrate it.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. The `thread` op
 * param folds into `metadata.taskId` and `task_*` kinds keep their stored
 * names; only the agent-facing surface says `thread`.
 *
 * ⚠ PEER-CONTROLLED TEXT. Every string below is server NARRATION with no
 * untrusted framing, and two peer-authored values splice into it:
 *   - `ch.name` — `resolveChannelOr` lists PUBLIC channels the caller was never
 *     invited to, so the name can come from someone the agent never contacted.
 *   - `toLabel` (`profiles.display_name`) — already render-safe:
 *     `resolveMemberOr` neutralizes at the source. ⚠ Do NOT neutralize twice.
 *
 * ⚠ A post addresses a PERSON or nobody; `intent` decides whether even that
 * reaches their machine. There is no agent-addressing param.
 */
import type { ChannelMessageInput, DoplClient, MessageIntent } from "@dopl/client";
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
    /**
     * CHAT vs REQUEST — whether this post may reach the addressee's machine.
     * Absent = `request`: `to` addresses and a DIRECT channel's auto-address
     * fires. `chat` skips the auto-address server-side.
     *
     * ⚠ `chat` beside a `to` is a CONTRADICTION, refused here before the call
     * (see {@link CHAT_ADDRESSED_REFUSAL}) and by the route as
     * `CHANNEL_CHAT_ADDRESSED`.
     */
    intent?: MessageIntent;
    /**
     * Caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes nothing
     * this op does — only what the result may claim about waiting for the reply.
     */
    runtime?: string | null;
}
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
