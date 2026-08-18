"use strict";
/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendDoplStatus = appendDoplStatus;
exports.withDoplStatus = withDoplStatus;
const identity_js_1 = require("./tools/identity.js");
const narration_js_1 = require("./tools/narration.js");
const instructions_js_1 = require("./instructions.js");
/**
 * Append the mandatory `_dopl_status` footer. ⚠ Always reports the EFFECTIVE
 * workspace this call HIT plus a source label (`per-call arg` / `sole
 * membership` / `header pin`) — no session-default duality.
 *
 * Skipped when the handler returned `isError` (don't muddy error messages) or
 * there is no effective workspace (meta-tools with no session default).
 */
async function appendDoplStatus(response, effective, caller) {
    const res = response;
    if (res.isError)
        return res;
    if (!effective)
        return res;
    // ⚠ Name goes through the neutralizer: this footer is the agent's targeting
    // check, so it is the line worth forging, and a name is bounded only by
    // length (see UNTRUSTED_DIRECTORY_NOTE) — one newline buys a second, invented
    // `_dopl_status` key. The slug (kebab-regex) and id (server-issued) beside it
    // are the halves an owner cannot type.
    //
    // ⚠ WHO comes before WHERE: this is the one line riding every successful
    // response, and the instructions tell the agent to read it, so the immutable
    // id must be here rather than hunted for across surfaces that disagree.
    const footer = [
        "",
        "",
        "---",
        "_dopl_status:",
        (0, identity_js_1.callerStatusLine)(caller),
        `  active_workspace: ${(0, narration_js_1.inlineOr)(effective.name, instructions_js_1.UNNAMED_WORKSPACE)} (slug=\`${effective.slug}\`, id=\`${effective.id}\`, role=${effective.role})`,
        `  workspace_source: ${effective.source}`,
    ].join("\n");
    // Append to the final text block; add a new one if there is no text content.
    const content = [...res.content];
    const lastIdx = content.length - 1;
    if (lastIdx >= 0 && content[lastIdx]?.type === "text") {
        content[lastIdx] = {
            type: "text",
            text: `${content[lastIdx].text}${footer}`,
        };
    }
    else {
        content.push({ type: "text", text: footer.trimStart() });
    }
    return { ...res, content };
}
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the session default (if any).
 */
function withDoplStatus(handler, getEffective, caller) {
    return async (args) => {
        const result = await handler(args);
        return appendDoplStatus(result, getEffective(), caller);
    };
}
