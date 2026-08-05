/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 *
 * THIS FILE IS NOW ONE OP, and that is the end of a three-step split rather
 * than an accident. It began as "the write ops"; the first-class thread ops
 * left for `channel-ops-threads.ts`, the post's result LINES left for
 * `channel-post-linkage.ts` / `channel-addressing.ts` / `channel-wake-guidance.ts`
 * / `channel-post-notes.ts`, and the room-lifecycle ops (open / invite) left
 * for `channel-ops-open.ts`. What is left is the one op every behaviour round
 * actually lands on: resolve the addressing, make the call, map the 4xx, hand
 * the outcome to the modules that narrate it.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 *
 * PEER-CONTROLLED TEXT (Q1, write side). Every string below is server NARRATION
 * — no untrusted-content framing, read by the model as the tool speaking — and
 * two peer-authored values are spliced into it.
 *
 *   - `ch.name`. `resolveChannelOr` lists channels including PUBLIC ones the
 *     caller was never invited to, so the name can come from someone the agent
 *     has had no contact with; the reach is lower than `op="list"`'s (the agent
 *     must name the channel) but it is not zero. `features/channels/schema.ts`
 *     bounded it at 120 characters with NO charset rule, so it could carry the
 *     newlines that forge a line — that gap is closed there too now.
 *   - `toLabel` — `profiles.display_name`. Render-safe by the time it arrives:
 *     `resolveMemberOr` neutralizes at the source, so the label is spliced
 *     directly here and must NOT be neutralized twice.
 *
 * Peer TITLES (thread names) render in `channel-post-linkage.ts`; the
 * untrusted-content headers they carry live in `channel-render.ts` with the
 * read side's, one definition each.
 *
 * NAMED-AGENT ADDRESSING IS GONE (channels rollback §1). `to_agent` /
 * `to_agents` / `as_agent` were resolved here through `channel-agent-refs.ts`
 * before the call; a post addresses a PERSON or nobody, and `intent` decides
 * whether even that reaches their machine.
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
     * CHAT vs REQUEST — whether this post may reach the addressee's machine at
     * all. Absent means `request`: `to` addresses, and a DIRECT channel's
     * auto-address still fires. `chat` is people talking — the auto-address is
     * skipped server-side, so nothing on the far side reads the message as an ask.
     *
     * `chat` beside a `to` is a CONTRADICTION and is refused here, before the
     * call (see {@link CHAT_ADDRESSED_REFUSAL}); the route refuses it too, with
     * `CHANNEL_CHAT_ADDRESSED`.
     */
    intent?: MessageIntent;
    /**
     * The caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes
     * nothing this op does — only what the result is willing to claim about
     * waiting for the reply. See `channel-wake-guidance.ts`.
     */
    runtime?: string | null;
}
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
