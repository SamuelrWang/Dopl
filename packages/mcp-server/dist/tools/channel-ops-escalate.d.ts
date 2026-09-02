/**
 * `dopl_channel` op="send" with kind="decision" — ASK A HUMAN A STRUCTURED QUESTION
 * (Samuel's ruling, 2026-08-31: agents escalate as STRUCTURE, not prose walls).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── WHAT IT IS, AND THE ONE THING EVERY LINE HERE RESPECTS ─────────────────
 * **IT IS A POST.** It goes to the channel like any other message, everyone in
 * the room reads it, and it is stored as `kind='message'`. What it adds is a
 * VALIDATED payload the surface renders as a card with buttons, and an answer
 * that comes back as an ordinary reply.
 *
 * Three consequences the copy must carry rather than paper over:
 *   1. **NOTHING PRIVATE HAPPENS HERE.** An escalation is a question about
 *      shared work asked in a shared room, so its answer is public too. An agent
 *      that expects a private reply will wait forever, so the result says where
 *      the answer arrives.
 *   2. **A CARD NOBODY IS TAGGED IN IS A CARD NOBODY SEES.** The @-tag is what
 *      puts it in a person's inbox and raises the desktop notification; the
 *      structure is what makes it answerable. The result reports the server's
 *      OWN mention resolution, because an exact-match resolver posts a mistyped
 *      tag successfully and reaches nobody.
 *   3. **THE OPTIONS ARE THE PRODUCT.** Two to six, each with a consequence.
 *      The schema enforces the bounds; the refusals here say WHY, because an
 *      opaque -32602 on `options` gets an agent to pad the list rather than
 *      collapse it.
 */
import type { ChannelEscalationInput, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * ASK.
 *
 * ⚠ EVERY REFUSAL HERE IS PRE-CALL, so "nothing was posted" is trivially true
 * and can never be confused with a delivery failure — `opPost`'s own rule for
 * the two guards at the top of that function.
 */
export declare function opEscalate(client: DoplClient, channelRef: string, escalation: ChannelEscalationInput, opts?: {
    thread?: string;
    clientMsgId?: string;
    runtime?: string | null;
}): Promise<ToolResponse>;
