"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_ADDRESSED_REFUSAL = void 0;
exports.postAddressLines = postAddressLines;
const channel_addressing_1 = require("./channel-addressing");
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
exports.CHAT_ADDRESSED_REFUSAL = 'A message with `intent`="chat" cannot be addressed — nothing was sent. "chat" means the people in the room and reaches nobody\'s machine; `to` means the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping `to`, or as a REQUEST by dropping `intent` (a request is the default).';
/**
 * Address lines for one successful post. Empty is legitimate — an ordinary
 * addressed post in a live thread has nothing to warn about.
 */
function postAddressLines(f) {
    return addressingNoteLines(f);
}
/**
 * "Who was this put in front of" — or nothing when the post named somebody.
 *
 * ⚠ CHAT IS UNADDRESSED ON PURPOSE and must NOT get the warning written for a
 * FORGOTTEN address: `unaddressedPostNote`'s remedy is "re-post it with
 * to=<one member>", exactly what an `intent:"chat"` caller decided against, so
 * rendering it talks every deliberate chat message into becoming a request. The
 * chat line states the same fact with the opposite advice.
 *
 * ⚠ BUT CHAT STILL HAS TO READ `landedThread` (fixed 2026-08-22). This branch
 * returned early and never looked at it, so a chat post THREADED into a
 * first-class exchange was told "no agent was put in front of it" — and
 * `channel-addressing.ts` fact 3 says that is false: `feedLiveSession` hands a
 * uuid-tagged message straight into the counterparty's running turn without
 * reading the addressing at all. `intent` governs ADDRESSING; the thread tag is
 * a different route into the same session, and only ADDRESSING was skipped. An
 * agent told nothing was in front of its message says the same thing again
 * louder, into a session that already has it.
 */
function addressingNoteLines(f) {
    if (f.intent === "chat") {
        // ⚠ Same predicate the non-chat path uses, for the same reason: only a
        // FIRST-CLASS (uuid) tag reaches a session. A legacy `task-…` tag groups on
        // a card and wakes nobody, so it correctly falls to the plain chat line.
        if ((0, channel_addressing_1.routesToASession)(f.landedThread)) {
            return [
                `CHAT, BUT THREADED — \`intent\`="chat" means this ADDRESSES nobody, and in a DIRECT channel it also skipped the other member. The THREAD TAG is a different route and it does not read addressing at all: a message carrying a first-class thread id is handed straight to the session the other party already has open on that thread, so this may be in front of their agent right now. So do NOT repeat it as a request — that lands as a second, unthreaded ask against work already running. If you want an answer, wait for it with dopl_channel(op="await", channel="${f.channelId}", since=<this seq>).`,
            ];
        }
        return [
            `CHAT — you posted this as \`intent\`="chat", so it addresses nobody: the people in **${f.safeChannelName}** can read it, no agent was put in front of it, and in a DIRECT channel the automatic address to the other member was skipped too. That is the point of the field, so this is NOT a delivery failure to repair. If you meant to ask for work, post again WITHOUT \`intent\` (a request is the default) and name who it is for.`,
        ];
    }
    const note = (0, channel_addressing_1.unaddressedPostNote)({
        ref: f.channelId,
        isDirect: f.isDirect,
        addressed: !!f.toLabel,
        landedThread: f.landedThread,
    });
    return note ? [note] : [];
}
