/**
 * WHAT A POST'S ADDRESSING ACTUALLY DID — the result line that answers it, plus
 * the one refusal that fires when a post's addressing contradicts itself.
 *
 * It was THREE lines. Two of them described named-agent addressing — the
 * to-vs-agent conflict note and the multi-address / thread-open handshake note
 * — and went with it (channels rollback §1), along with the agent clauses of
 * the confirmation line. A post addresses a PERSON or nobody.
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
 */

import type { MessageIntent } from "@dopl/client";
import { unaddressedPostNote } from "./channel-addressing";

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
export const CHAT_ADDRESSED_REFUSAL =
  'A message with `intent`="chat" cannot be addressed — nothing was sent. "chat" means the people in the room and reaches nobody\'s machine; `to` means the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping `to`, or as a REQUEST by dropping `intent` (a request is the default).';

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
 * The address lines for one successful post.
 *
 * Empty is a legitimate answer: an ordinary addressed post in a live thread has
 * nothing to warn about and says nothing.
 */
export function postAddressLines(f: PostAddressFacts): string[] {
  return addressingNoteLines(f);
}

/**
 * The "who was this put in front of" line — or nothing, when the post named
 * somebody and there is nothing to warn about.
 *
 * CHAT IS UNADDRESSED ON PURPOSE, so it must not get the warning written for an
 * address the caller FORGOT. `unaddressedPostNote`'s remedy is "re-post it with
 * to=<one member>", which is precisely the thing an `intent:"chat"` caller
 * decided against; rendering it here would talk every deliberate chat message
 * into becoming a request. The chat line says the same fact (nothing was put in
 * front of an agent) with the opposite advice.
 */
function addressingNoteLines(f: PostAddressFacts): string[] {
  if (f.intent === "chat") {
    return [
      `CHAT — you posted this as \`intent\`="chat", so it addresses nobody: the people in **${f.safeChannelName}** can read it, no agent was put in front of it, and in a DIRECT channel the automatic address to the other member was skipped too. That is the point of the field, so this is NOT a delivery failure to repair. If you meant to ask for work, post again WITHOUT \`intent\` (a request is the default) and name who it is for.`,
    ];
  }
  const note = unaddressedPostNote({
    ref: f.channelId,
    isDirect: f.isDirect,
    addressed: !!f.toLabel,
    landedThread: f.landedThread,
  });
  return note ? [note] : [];
}
