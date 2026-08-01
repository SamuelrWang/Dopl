"use strict";
/**
 * `dopl_skill` shared vocabulary: the neutralizer fallback, the op="list" scope
 * line, and the error mappers both the read and the write handlers need.
 *
 * Split out of `skills.ts` at the §2 500-line cap when the scope line landed —
 * the same read/shared/write seam `knowledge.ts` and `workflow.ts` already use,
 * chosen because these three helpers are exactly the pieces BOTH sides call
 * (`failureDetail` from op="get"/"read" and from every write; `NO_NAME` from
 * the list rows and from the write confirmations). The `skills-` filename
 * prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCOPE_NOTE = exports.NO_NAME = void 0;
exports.errorMessage = errorMessage;
exports.failureDetail = failureDetail;
exports.agentWriteDenied = agentWriteDenied;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
/**
 * A published skill is workspace-visible, so a skill's `name`, `folder`,
 * `description` and `when_to_use` can all have been typed by another member —
 * and none of them carries a charset rule (`min(1).max(120)` / `.max(2000)`,
 * features/skills/schema.ts). Two different treatments, on purpose:
 *
 *   - The NAME and the FOLDER label are values: they were spliced into a `# `
 *     heading, a `### 📁 ` heading, and a `- \`slug\` — name` row.
 *   - `description` / `when_to_use` / SKILL.md are the skill's own prose — the
 *     procedure the agent is meant to load and follow. They stay intact under
 *     op="get", which renders them on their own lines as content. In op="list"
 *     they are the triggers on a bullet row, so THAT rendering bounds them.
 */
exports.NO_NAME = "`(unnamed skill)`";
/**
 * WHAT op="list" DID NOT SAY, said on the result itself.
 *
 * `opList` applies `status === "active"`, and the server has already applied
 * `canSeeSkill` before the rows reach us. Neither filter left any trace in the
 * output, so a member who could see one of an owner's six skills read
 * "## Skills" over a single row as the workspace's skill set — and, comparing
 * notes with the owner's agent, concluded the server was broken. It was not.
 *
 * The line names the FILTERS, never a hidden count: "how many were hidden from
 * you" is a second query on every list call, and a footer that costs a round
 * trip is a worse tool than the one it fixes. Naming the filter is free.
 */
exports.SCOPE_NOTE = `Drafts and other members' private or team-scoped skills are not listed, so a count here is not the workspace's total. For the full inventory across every status and visibility: dopl_members(op="access_matrix").`;
function errorMessage(e) {
    if (e && typeof e === "object" && "message" in e) {
        return String(e.message);
    }
    return String(e);
}
/** Upstream failure text as a value — same rule as the channel await's. */
function failureDetail(e) {
    return (0, narration_1.inlineOr)(errorMessage(e), "`no detail reported`");
}
/**
 * Clean surface for the F-10 read-only-skill delete rejection. The API
 * returns 403 `SKILL_AGENT_WRITE_DISABLED` when an agent tries to delete a
 * skill flagged `agent_write_enabled=false`. Surface the server's
 * actionable message verbatim instead of a raw `CODE: message` dump.
 * Returns null otherwise so the caller falls through. Duck-typed on
 * `.status` / `.code` to avoid importing the @dopl/client error class.
 */
function agentWriteDenied(e) {
    if (typeof e !== "object" ||
        e === null ||
        e.status !== 403 ||
        e.code !== "SKILL_AGENT_WRITE_DISABLED") {
        return null;
    }
    const msg = e.apiMessage;
    return (0, respond_1.err)(typeof msg === "string" && msg
        ? msg
        : "This skill is read-only to agents — delete it from the Dopl web UI.");
}
