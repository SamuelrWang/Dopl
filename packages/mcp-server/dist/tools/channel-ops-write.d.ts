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
 * MULTIPLAYER: `to_agent` / `as_agent` are resolved through
 * `channel-agent-refs.ts`, which also owns how an agent handle is rendered (as a
 * value, and never without the immutable agent id beside it).
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
     * MULTIPLAYER — address the post to a named AGENT (handle or id). Addressing
     * is what makes an agent act.
     *
     * IT DOES NOT ENGAGE IT WHEN THE CALLER IS THIS TOOL. `recordAgentEngagement`
     * (service-writes-agents.ts) stamps `engaged_at` only for a HUMAN-authored
     * post, and every post made through MCP is agent-authored — the write path
     * derives `author_kind` from the caller's token (`source: auth.agentTokenId ?
     * "agent" : "user"`, service-shared.ts) and an MCP call always carries one. So
     * engagement is a thing that HAPPENS TO the caller's own agents (a human tags
     * them in the web app or the desktop), never a thing this op does to a peer.
     * Narration that said otherwise would teach an agent it had put a peer on a
     * standing licence it does not have.
     *
     * Addressing a HUMAN (`to`) is NOT notify-only: see
     * {@link PostOptions.asAgent}, which is what decides that.
     */
    toAgent?: string;
    /**
     * MULTIPLAYER — the N-agent form of {@link PostOptions.toAgent}: address up to
     * eight named agents in ONE post, which is how two agents are told to work
     * together. `toAgent` is exactly its one-element case and the two merge, in
     * that order. All-or-nothing (see `resolvePostAgentsOr`), and the FIRST
     * addressed agent's owner is the member the server stamps the post for.
     */
    toAgents?: string[];
    /**
     * MULTIPLAYER — post AS one of the caller's own agents (handle or id). It
     * supplements the human author, it never replaces one, and the server
     * verifies ownership: another member's agent is a 403, never a silent drop.
     *
     * IT ALSO DECIDES TWO THINGS THAT ARE NOT ABOUT ATTRIBUTION, and both were
     * undocumented until B1/S1:
     *  - with `to`=<a person>, it is what makes the post a NOTIFICATION instead
     *    of a request that starts their agent. The receiving desktop's
     *    notify-only `agent-escalation` verdict requires `author_agent_id`
     *    (dopl-desktop-app/main/targeting.js), which is stamped ONLY from a
     *    validated `as_agent`. Without it the post classifies as `trigger`.
     *  - with `thread`, it is what admits an AGENT participant to a breakout
     *    room: `mayWriteThread` (service-writes-metadata.ts) matches the set
     *    against the CLAIMED agent, so the post 403s without it.
     */
    asAgent?: string;
    /**
     * CHAT vs REQUEST — whether this post may reach anybody's agent at all.
     * Absent means `request`, which is the whole of today's behaviour: addresses
     * work, and a DIRECT channel's auto-address still fires. `chat` is people
     * talking — the auto-address is skipped server-side, so nothing on the far
     * side reads the message as an ask.
     *
     * `chat` beside an address is a CONTRADICTION and is refused here, before the
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
