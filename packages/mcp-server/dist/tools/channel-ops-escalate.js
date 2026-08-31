"use strict";
/**
 * `dopl_channel` op="escalate" — ASK A HUMAN A STRUCTURED QUESTION
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.opEscalate = opEscalate;
const respond_1 = require("./respond");
const channel_escalate_render_1 = require("./channel-escalate-render");
const channel_ops_write_1 = require("./channel-ops-write");
/**
 * The bounds, RESTATED as literals rather than imported from the schema.
 *
 * ⚠ They are the same numbers `channel-schema.ts` publishes, and the duplication
 * is the same trade `GROUP_CHANNEL_MIN_MEMBERS` makes (INVARIANTS §5): the
 * schema's copy is what an MCP client validates against, and this copy is what
 * the SENTENCE is built from. `channel-escalate.test.ts` pins them equal.
 */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
/**
 * ASK.
 *
 * ⚠ EVERY REFUSAL HERE IS PRE-CALL, so "nothing was posted" is trivially true
 * and can never be confused with a delivery failure — `opPost`'s own rule for
 * the two guards at the top of that function.
 */
async function opEscalate(client, channelRef, escalation, opts = {}) {
    // ⚠ THE SCHEMA ALREADY ENFORCES BOTH BOUNDS AND THIS IS NOT A SECOND FENCE —
    // it is the SENTENCE. A zod -32602 on `options` tells an agent the array was
    // wrong and nothing about which direction to move, and the two directions have
    // opposite remedies: one option means DO IT, seven means COLLAPSE THEM.
    if (escalation.options.length < MIN_OPTIONS) {
        return (0, respond_1.err)(`Nothing was posted. An escalation offers ${MIN_OPTIONS}-${MAX_OPTIONS} options and you gave ${escalation.options.length} — **one option is not a question.** If there is only one way forward, that is a decision you already have: take it, and report it with dopl_channel(op="milestone", thread="<id>", body="<one line>"). If you are asking permission for that one path, the second option is what happens if they say no — write it out.`);
    }
    if (escalation.options.length > MAX_OPTIONS) {
        return (0, respond_1.err)(`Nothing was posted. An escalation offers at most ${MAX_OPTIONS} options and you gave ${escalation.options.length} — past that it is the wall of prose this op exists to replace, with numbers on it. Collapse the near-duplicates into the decision they actually differ on, and put what you dropped into \`context\` in one line if it matters.`);
    }
    // ⚠ REFUSED, NEVER DROPPED. A dropped recommendation posts a card that
    // recommends nothing over an agent that believes it recommended something —
    // the narrate-success-over-invisible-failure shape `strictInput` refuses one
    // layer up. The server refuses it too; this arm exists so the sentence is a
    // sentence.
    if (escalation.recommendation != null &&
        escalation.recommendation.index >= escalation.options.length) {
        return (0, respond_1.err)(`Nothing was posted. \`recommendation.index\` is ${escalation.recommendation.index}, which is outside your own \`options\` list (${escalation.options.length} of them, indexed 0-${escalation.options.length - 1}). It is 0-based — the first option is 0. Re-send with the index of the option you meant, or omit \`recommendation\` entirely.`);
    }
    // ⚠ THE BODY IS COMPOSED, NOT SUPPLIED, AND IT CARRIES ALL FOUR FIELDS. That
    // is what makes the card DEGRADE rather than vanish on every surface that does
    // not know `metadata.escalation` — op="read", a plain browser, the pop-out,
    // and any desktop older than the card. See `channel-escalate-render.ts`.
    const body = (0, channel_escalate_render_1.escalationBody)(escalation);
    // ⚠ DELEGATES rather than growing a second delivery path — `op="milestone"`'s
    // precedent. `kind` is left at the default `message` and MUST stay there:
    // `dopl-desktop-app/main/targeting.js › classify` returns `ignore` for every
    // other kind, so a card on one could never notify the human it is asking.
    // ⚠ `to` is NOT routed through: an escalation asks a PERSON to decide, and
    // addressing a member starts THEIR agent instead (INVARIANTS §5). The @-tag in
    // the body is the inbox mechanism, and it starts nobody.
    const posted = await (0, channel_ops_write_1.opPost)(client, channelRef, body, {
        escalation,
        thread: opts.thread,
        clientMsgId: opts.clientMsgId,
        runtime: opts.runtime,
    });
    if (posted.isError)
        return posted;
    return {
        ...posted,
        content: [
            ...posted.content,
            {
                type: "text",
                text: [
                    `That posted as an ESCALATION CARD: your operator (or whoever you tagged) sees the question, the options and your recommendation as buttons, and pressing one posts their choice back into this channel.`,
                    `⚠ THE ANSWER COMES BACK AS AN ORDINARY MESSAGE IN THIS CHANNEL, NOT PRIVATELY. Watch for it with dopl_channel(op="await", channel="${channelRef}", since=<the seq above>) — there is no separate place to poll and nothing else will arrive.`,
                    `⚠ ONE ANSWER, FIRST ONE WINS. Do not post the same question again while it is unanswered; a second card is a second question about one decision, and neither of you will be able to tell which answer belonged to which.`,
                ].join("\n"),
            },
        ],
    };
}
