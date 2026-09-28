"use strict";
/**
 * **WHICH DEVICE A MEMBER WROTE FROM, AS AN AGENT READS IT** — the server-stamped
 * `metadata.source` (docs/specs/device-aware-messages.md) rendered as one compact tag,
 * plus ONE guidance line when the member is on glasses.
 *
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY. The desktop feeds its sessions the same line
 * (`dopl-desktop-app/main/message-source.js`), which a desktop test holds byte-equal to this.
 * ⚠ SAID ONCE PER PAGE, never per message: MCP payload size is a budget (`tool-budget.test.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceTag = exports.GLASSES_REPLY_GUIDANCE = void 0;
exports.viaTag = viaTag;
exports.sourceGuidance = sourceGuidance;
const narration_js_1 = require("./narration.js");
exports.GLASSES_REPLY_GUIDANCE = "They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). " +
    "Choices: glasses_ask. Structured info: glasses_render (selectable:false on info-only lists). " +
    "Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.";
const KINDS = new Set(["glasses", "computer", "web", "phone"]);
function readStamp(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const { kind, label } = raw;
    if (typeof kind !== "string" || !KINDS.has(kind))
        return null;
    return { kind, label: typeof label === "string" ? label : null };
}
const sourceOf = (m) => m.authorKind === "agent" ? null : readStamp(m.metadata?.source);
/** ` · via glasses (`Even G2`)`, ` · via web`, or "" for a missing / unreadable stamp. */
function viaTag(raw) {
    const source = readStamp(raw);
    if (!source)
        return "";
    const label = source.kind === "web" || !source.label ? null : (0, narration_js_1.neutralizeInline)(source.label);
    return ` · via ${source.kind}${label ? ` (${label})` : ""}`;
}
/** {@link viaTag} for one transcript line; "" on an agent line. */
const sourceTag = (m) => m.authorKind === "agent" ? "" : viaTag(m.metadata?.source);
exports.sourceTag = sourceTag;
/** The guidance line when the NEWEST member line on the page came from glasses, else null. */
function sourceGuidance(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].authorKind === "agent")
            continue;
        return sourceOf(messages[i])?.kind === "glasses" ? `_${exports.GLASSES_REPLY_GUIDANCE}_` : null;
    }
    return null;
}
