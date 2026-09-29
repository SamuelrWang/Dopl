"use strict";
/**
 * `dopl_show` — `dopl_channel` op="send" with `kind:"display"` (docs/specs/unified-display.md §4).
 * ONE door: the caller's arguments go to `POST /api/displays` as given (the server validates the
 * blocks, resolves the session channel, routes to channel and/or glasses, holds for `wait`), and
 * the outcome comes back as one fact line (§4.3).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_DISPLAY_REFUSAL = void 0;
exports.opShow = opShow;
const client_1 = require("@dopl/client");
const respond_1 = require("./respond");
const narration_1 = require("./narration");
exports.LEGACY_DISPLAY_REFUSAL = "Refused: displays are dopl_show (granular); nothing was sent.";
async function opShow(client, args) {
    // A legacy `kind="display"` carries no blocks and no template (its strict schema has neither).
    if (args.blocks === undefined && args.template === undefined)
        return (0, respond_1.err)(exports.LEGACY_DISPLAY_REFUSAL);
    const input = { origin: "dopl_show" };
    for (const key of ["channel", "thread", "target", "blocks", "display_id", "mention", "wait", "timeout_sec", "template", "data", "save_as", "validate_only", "client_msg_id"]) {
        if (args[key] !== undefined)
            input[key] = args[key];
    }
    let r;
    try {
        r = await client.showDisplay(input);
    }
    catch (e) {
        // The door's 4xx carries the fixable text (a validation error is `{"ok":false,"errors":[…]}`).
        if (e instanceof client_1.DoplApiError && e.status >= 400 && e.status < 500 && e.apiMessage) {
            return (0, respond_1.err)(`Nothing was shown: ${e.apiMessage}`);
        }
        throw e;
    }
    return (0, respond_1.ok)(showLine(r));
}
/** The §4.3 result line(s). */
function showLine(r) {
    if (r.preview !== undefined)
        return r.preview;
    const where = r.channel_id ? ` in #${(0, narration_1.inlineOr)(r.channel_name ?? "", r.channel_id)} · msg=${r.message_id}` : "";
    const decision = [r.decision && "decision", r.tags && `tags=${r.tags}`].filter(Boolean).join(" ");
    const facts = [
        `shown ${r.display_id}${where}`,
        ...(decision ? [decision] : []),
        `glasses=${r.glasses.replace(/^skipped:(.*)$/, "skipped($1)")}`,
        ...(r.replaced ? [`replaced=${r.replaced}${r.replaced_reason ? ` (${r.replaced_reason === "answered" ? "was answered" : r.replaced_reason})` : ""}`] : []),
    ].join(" · ");
    const a = r.answer;
    if (r.status === "answered" && a) {
        const by = r.by_handle ? ` by ${(0, narration_1.inlineOr)(r.by_handle, "")}` : "";
        return `${facts}\nanswered ${a.index + 1} ${(0, narration_1.inlineOr)(a.choice, "(no label)")}${by} via ${a.via}`;
    }
    if (r.status === "timeout" || r.status === "pending")
        return `${facts}\ntimeout: still open; the answer will arrive as their message`;
    if (r.status === "dismissed")
        return `${facts}\ndismissed on the glasses; the channel decision stays open`;
    return facts;
}
