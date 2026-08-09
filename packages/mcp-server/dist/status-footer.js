"use strict";
/**
 * status-footer.ts — the `_dopl_status` footer (M-4), and the wrapper that
 * puts it on a meta-tool's response.
 *
 * Split out of `server.ts` (§2, the layer rule): what a successful response
 * SAYS about where it landed is a different reason to change than how a tool
 * is registered. Both registration helpers in `registrar.ts` end here, which is
 * what makes the footer uniform.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendDoplStatus = appendDoplStatus;
exports.withDoplStatus = withDoplStatus;
const identity_js_1 = require("./tools/identity.js");
const narration_js_1 = require("./tools/narration.js");
const instructions_js_1 = require("./instructions.js");
/**
 * Append the mandatory `_dopl_status` footer to a tool response (M-4). It
 * always reports the EFFECTIVE workspace this call actually hit plus a
 * source label — `per-call arg` (a `workspace=` override), `sole membership`
 * (auto-targeted single workspace), or `header pin` (a request-level
 * X-Workspace-Id). There is no session-default duality: the footer names
 * exactly where the response came from.
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages), or
 *   - there is no effective workspace to report (only reachable via the
 *     meta-tools when the caller has no session default).
 */
async function appendDoplStatus(response, effective, caller) {
    // A per-call agent locus (`as_agent`) used to ride the RESULT rather than the
    // session identity and be stripped here before the shape went out. Named
    // agents are gone (channels rollback §1) and the response is the MCP shape
    // again.
    const res = response;
    if (res.isError)
        return res;
    if (!effective)
        return res;
    // The name goes through the neutralizer and the immutable id joins the slug.
    // This footer is the agent's targeting check, so it is exactly the line worth
    // forging: the name was interpolated raw inside double quotes, and a name is
    // bounded only by length (see UNTRUSTED_DIRECTORY_NOTE), so one newline bought
    // a second, invented `_dopl_status` key. It reads as a value now, and the two
    // handles beside it — slug (kebab-regex enforced) and id (server-issued) — are
    // the halves an owner cannot type.
    // WHO comes before WHERE, deliberately. This footer is the one line that
    // rides every successful response and that the instructions tell the agent to
    // read, and until now it answered only half the question — an agent that
    // wanted to know which session it was had to go looking, and the surfaces it
    // would have found disagreed with each other. Putting the immutable id here
    // means it cannot be missed and never has to be hunted for. Terse on purpose:
    // see `callerStatusLine` for what is left out and why.
    const footer = [
        "",
        "",
        "---",
        "_dopl_status:",
        (0, identity_js_1.callerStatusLine)(caller),
        `  active_workspace: ${(0, narration_js_1.inlineOr)(effective.name, instructions_js_1.UNNAMED_WORKSPACE)} (slug=\`${effective.slug}\`, id=\`${effective.id}\`, role=${effective.role})`,
        `  workspace_source: ${effective.source}`,
    ].join("\n");
    // Append to the final text block so the agent sees the footer at the
    // end of a rendered response. If the response has no text content
    // (rare — tools always return text), add a new block.
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
 * `_dopl_status` footer reporting the session default (if any). Handlers
 * stay unaware of the mechanism.
 */
function withDoplStatus(handler, getEffective, caller) {
    return async (args) => {
        const result = await handler(args);
        return appendDoplStatus(result, getEffective(), caller);
    };
}
