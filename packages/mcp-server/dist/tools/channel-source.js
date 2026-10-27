"use strict";
/**
 * **WHICH DEVICE A MEMBER WROTE FROM, AS AN AGENT READS IT** — the server-stamped
 * `metadata.source` (docs/specs/device-aware-messages.md) rendered as one compact tag,
 * plus ONE guidance line when the member is on glasses.
 *
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY, declared in `glasses-reply-guidance.ts` (a leaf the
 * Device SDK imports too) and re-exported here. The desktop feeds its sessions the same line
 * (`dopl-desktop-app/main/message-source.js`), which a desktop test holds byte-equal to this.
 * ⚠ SAID ONCE PER PAGE, never per message: MCP payload size is a budget (`tool-budget.test.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceTag = exports.GLASSES_REPLY_GUIDANCE = void 0;
exports.viaTag = viaTag;
exports.sourceGuidance = sourceGuidance;
const glasses_reply_guidance_js_1 = require("./glasses-reply-guidance.js");
Object.defineProperty(exports, "GLASSES_REPLY_GUIDANCE", { enumerable: true, get: function () { return glasses_reply_guidance_js_1.GLASSES_REPLY_GUIDANCE; } });
const narration_js_1 = require("./narration.js");
const KINDS = new Set(["glasses", "computer", "web", "phone"]);
function readStamp(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const { kind, label } = raw;
    if (typeof kind !== "string" || !KINDS.has(kind))
        return null;
    return { kind, label: typeof label === "string" ? label : null };
}
const rawSource = (m) => m.metadata?.source;
/** ` · via glasses (`Even G2`)`, ` · via web`, or "" for a missing / unreadable stamp. */
function viaTag(raw) {
    const source = readStamp(raw);
    if (!source)
        return "";
    const label = source.kind === "web" || !source.label ? null : (0, narration_js_1.neutralizeInline)(source.label);
    return ` · via ${source.kind}${label ? ` (${label})` : ""}`;
}
/** {@link viaTag} for one transcript line; "" on an agent line. */
const sourceTag = (m) => (m.authorKind === "agent" ? "" : viaTag(rawSource(m)));
exports.sourceTag = sourceTag;
/** The guidance line when the NEWEST member line on the page came from glasses, else null. */
function sourceGuidance(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].authorKind === "agent")
            continue;
        return readStamp(rawSource(messages[i]))?.kind === "glasses" ? `_${glasses_reply_guidance_js_1.GLASSES_REPLY_GUIDANCE}_` : null;
    }
    return null;
}
