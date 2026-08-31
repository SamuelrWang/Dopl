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
     * Absent = `request`: `to` addresses, and `to` is the ONLY thing that does.
     * ⚠ A DIRECT channel's auto-address is retired (2026-08-18), so `chat` no
     * longer has an addressing fallback to skip; what it still does is STATE that
     * the post is not work for anybody, which the receiving side reads.
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
    /**
     * THE STRUCTURED ESCALATION PAYLOAD, set only by `op="escalate"`.
     *
     * ⚠ IT RIDES THIS OP RATHER THAN GROWING A SECOND DELIVERY PATH — `milestone`'s
     * precedent exactly. What `escalate` adds over `post` is a validated payload
     * and its own result guidance; the message, the addressing, the 4xx mapping
     * and every result line below are the same ones.
     *
     * ⚠ NOT `metadata`. The server strips `metadata.escalation` from caller input
     * unconditionally and re-stamps it only from this validated field, because the
     * card it renders carries buttons that write back and wake an agent.
     */
    escalation?: ChannelMessageInput["escalation"];
}
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
