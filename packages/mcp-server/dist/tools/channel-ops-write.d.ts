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
 * ⚠ A post addresses a PERSON or nobody, and `to` is the whole of it: with one
 * the message reaches that member's machine, without one it is chat and reaches
 * nobody. There is no agent-addressing param and no second way to say which.
 */
import type { ChannelMessageInput, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type FactValue } from "./channel-facts";
/**
 * G14 — **A MILESTONE IS ONE LINE, AND THAT IS NOW A BOUND RATHER THAN A WORD.**
 *
 * ⚠ The op shared `post`'s 16,000-character cap while three surfaces asked, in
 * prose, for "ONE LINE naming the step that just landed" — and a rule stated
 * only in prose is the rule a model spends a paragraph on. 240 characters is
 * about two lines of terminal width; the NEWLINE check is the sharper half,
 * because a multi-line milestone is a report wearing a marker's op, and the
 * card that renders it shows one line whatever it was sent.
 *
 * ⚠ **THE REFUSAL NAMES THE OTHER LANE**, since the caller has real content in
 * hand: refusing without saying where it goes is how a deliverable ends up
 * squeezed into a marker.
 */
export declare const MILESTONE_MAX_CHARS = 240;
export declare function milestoneRefusal(body: string): ToolResponse | null;
/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
    /**
     * ⚠ **NOT A CALLER'S ARGUMENT ANY MORE** (C12, 2026-09-02). `kind` left the
     * published shape — three of its five values were refused, one had its own op
     * and one was the default — and the only writer left is `op="milestone"`,
     * which fixes it to `task_progress` at the routing seam.
     */
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
    /**
     * The VERB the terse result opens with. Defaults to `posted`.
     *
     * ⚠ THE OPS THAT RIDE THIS ONE NEED THEIR OWN WORD. `milestone` and
     * `escalate` both delegate here rather than growing a second delivery path,
     * and a result that opened `posted` for all three would report the wrong act
     * — the one kind of wrong nothing downstream can detect.
     */
    resultHead?: string;
    /**
     * Facts only the CALLING op knows, appended after the shared ones. ⚠ Kept to
     * things the server observed about this write (an option count, a resolved
     * posture) — never guidance, which belongs in `channel-doctrine.ts`.
     */
    resultFacts?: Record<string, FactValue>;
}
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
