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
 * Peer TITLES (thread names) render in `channel-post-linkage.ts` — the post's
 * did-it-thread line, split out of this file at the §2 cap — and across
 * `channel-ops-threads.ts`; the untrusted-content headers they carry live in
 * `channel-render.ts` with the read side's, one definition each.
 *
 * MULTIPLAYER: `to_agent` / `as_agent` are resolved through
 * `channel-agent-refs.ts`, which also owns how an agent handle is rendered (as a
 * value, and never without the immutable agent id beside it).
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
    /**
     * MULTIPLAYER — address the post to a named AGENT (handle or id). Addressing
     * is what makes an agent act. Addressing a HUMAN (`to`) is NOT notify-only:
     * see {@link PostOptions.asAgent}, which is what decides that.
     */
    toAgent?: string;
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
     * The caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes
     * nothing this op does — only what the result is willing to claim about
     * waiting for the reply. See `channel-wake-guidance.ts`.
     */
    runtime?: string | null;
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
