/**
 * WHAT A POST'S ADDRESSING ACTUALLY DID — the three result lines that answer it,
 * plus the one refusal that fires when a post's addressing contradicts itself.
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap (SHOULD-FIX-6),
 * along the seam that file had already drawn twice and then stopped drawing:
 * every OTHER line of a post's result lives in its own module already —
 * `channel-post-linkage.ts` answers "did it thread?", `channel-addressing.ts`
 * owns the unaddressed rule, `channel-wake-guidance.ts` owns what may be
 * claimed about waiting. These three were the residue, and they are the same
 * kind of thing: narration ABOUT an address, assembled from a resolved post and
 * the message the server wrote back. `opPost` is left as what it should be —
 * resolve, call, map the failures, hand the outcome here.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 *
 * THE TEXT DISCIPLINE IS INHERITED, NOT RESTATED. Every string below is server
 * NARRATION with no untrusted-content framing around it. Two peer-authored
 * values reach it and both arrive ALREADY render-safe: `safeChannelName` is
 * neutralized by its caller, and a member `label` is neutralized at its source
 * (`resolveMemberOr`). Neither may be neutralized again — double-wrapping
 * strips the span's own backticks and hands back the bare name, i.e. the bug.
 * Agent handles go through `agentLabel`, which carries the immutable id.
 */
import type { ChannelAgent, MessageIntent } from "@dopl/client";
/**
 * THE ONE SENTENCE for `intent:"chat"` + an address, said in both places it can
 * be reached: `opPost`'s local guard (which catches it before anything is sent)
 * and the route's `CHANNEL_CHAT_ADDRESSED` 400 (which catches it if the two ever
 * disagree). One constant, because two statements of one rule is how the copy in
 * this tool drifted from the code three times already.
 *
 * The rule is not a validation nicety. `chat` means "reach nobody's agent" and
 * an address means "reach exactly this one"; honouring either half would deliver
 * a message whose sender and whose recipient's machine disagree about what it
 * is, which is the silent-delivery failure the whole addressing contract exists
 * to prevent. So it is refused and the CALLER chooses.
 */
export declare const CHAT_ADDRESSED_REFUSAL = "A message with `intent`=\"chat\" cannot be addressed \u2014 nothing was sent. \"chat\" means the humans in the room, reaching nobody's agent; `to` / `to_agent` / `to_agents` mean the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping the address, or as a REQUEST by dropping `intent` (a request is the default).";
/** Everything the address lines need, read off the resolved post and its echo. */
export interface PostAddressFacts {
    /** The channel's id — what a follow-up call should be given. */
    channelId: string;
    /** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
    safeChannelName: string;
    /** Whether this is a DIRECT (1:1) channel, where the server addresses for you. */
    isDirect: boolean | undefined;
    /** The post's declared intent; `chat` is unaddressed ON PURPOSE. */
    intent: MessageIntent | undefined;
    /** Every addressed agent, in the caller's order. The HEAD is load-bearing. */
    toAgents: ChannelAgent[];
    /** The `to` member's resolved user id, when one was named. */
    toUserId: string | undefined;
    /** ALREADY render-safe (`resolveMemberOr`) — splice it, do not re-wrap it. */
    toLabel: string | undefined;
    /** The seq the server gave this post — the handshake key's `<seq>`. */
    seq: number;
    /** `metadata.taskId` read back off the STORED message, not off the request. */
    landedThread: string | undefined;
}
/**
 * The address lines for one successful post, in the order they are read.
 *
 * Empty is a legitimate answer: an ordinary addressed post in a live thread has
 * nothing to warn about and says nothing.
 */
export declare function postAddressLines(f: PostAddressFacts): string[];
/**
 * The agent-identity clauses of the "Posted to ..." confirmation line.
 *
 * EVERY addressed agent is named, not just the head. A multi-address that
 * reported only the first would read exactly like a single address, which is the
 * silent-drop shape this whole result line exists to prevent. Both notes render
 * the handle WITH its id (`agentLabel`) — a handle alone is the owner's claim
 * about a name, and two rooms' agents may share one.
 */
export declare function agentAttributionNotes(toAgents: ChannelAgent[], asAgent: ChannelAgent | undefined): {
    toAgentNote: string;
    asNote: string;
};
