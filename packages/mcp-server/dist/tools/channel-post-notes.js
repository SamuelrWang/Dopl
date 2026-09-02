"use strict";
/**
 * THE ONE REFUSAL A POST'S ADDRESSING CAN EARN. ⚠ `channel-` filename prefix
 * required by the parity split-scan (parity.test.ts).
 *
 * ⚠ WHAT LEFT THIS FILE (T10/T12, 2026-09-02). It also held `postAddressLines`
 * — three paragraphs spliced under every successful post saying what the
 * addressing had done: the "NOT ADDRESSED" note, its threaded variant, and the
 * two chat notes. All four described a RULE that holds on every call, so all
 * four are stated once in `channel-doctrine.ts`, and the post result carries the
 * two FACTS instead: `addressed=yes|no` and `intent=request|chat`. Nothing
 * observable was dropped — `addressed=no` is the same claim the paragraph made,
 * and `intent=chat` is what kept a deliberate chat post from reading as a
 * forgotten `to`.
 *
 * ⚠ THE REFUSAL STAYS, because it is not narration under a write that
 * succeeded — it is the answer to a call that was never made.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_ADDRESSED_REFUSAL = void 0;
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
