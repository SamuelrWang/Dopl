/**
 * WHAT A POST'S ADDRESSING ACTUALLY DID — the result line that answers it, plus
 * the refusal that fires when a post's addressing contradicts itself. A post
 * addresses a PERSON or nobody. ⚠ `channel-` filename prefix required by the
 * parity split-scan (parity.test.ts).
 *
 * ⚠ Every string below is server NARRATION with no untrusted framing. The two
 * peer-authored values reaching it arrive ALREADY render-safe:
 * `safeChannelName` is neutralized by its caller and a member `label` at its
 * source (`resolveMemberOr`). Neither may be neutralized AGAIN — double-wrapping
 * strips the span's own backticks and hands back the bare name.
 */
import type { MessageIntent } from "@dopl/client";
/**
 * ⚠ ONE constant for `intent:"chat"` + an address, used by BOTH places it can
 * be reached: `opPost`'s local guard (before anything is sent) and the route's
 * `CHANNEL_CHAT_ADDRESSED` 400. Two statements of one rule is how this tool's
 * copy drifted from the code repeatedly.
 *
 * ⚠ Not a validation nicety: `chat` means "reach nobody's agent" and an address
 * means "reach exactly this one". Honouring either half delivers a message
 * whose sender and whose recipient's machine disagree about what it is — the
 * silent-delivery failure the addressing contract exists to prevent. Refuse,
 * and let the CALLER choose.
 */
export declare const CHAT_ADDRESSED_REFUSAL = "A message with `intent`=\"chat\" cannot be addressed \u2014 nothing was sent. \"chat\" means the people in the room and reaches nobody's machine; `to` means the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping `to`, or as a REQUEST by dropping `intent` (a request is the default).";
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
    /** ALREADY render-safe (`resolveMemberOr`) — splice it, do not re-wrap it. */
    toLabel: string | undefined;
    /** `metadata.taskId` read back off the STORED message, not off the request. */
    landedThread: string | undefined;
}
/**
 * Address lines for one successful post. Empty is legitimate — an ordinary
 * addressed post in a live thread has nothing to warn about.
 */
export declare function postAddressLines(f: PostAddressFacts): string[];
