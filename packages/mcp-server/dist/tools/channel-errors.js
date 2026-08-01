"use strict";
/**
 * `dopl_channel` API-ERROR CLASSIFICATION — what a 4xx from the channels routes
 * actually means, read off the error CODE rather than guessed from the status.
 *
 * Q9 — the write ops used to catch a bare `status === 400` and answer with a
 * fixed sentence blaming the addressee. `to` is required for `create_thread`,
 * so EVERY 400 got that sentence with no fall-through: a 240-character title
 * (rejected by the route's own zod schema, before `createTask` ever ran) came
 * back as "invite Bob first", and `op="invite"` then answered "Bob is already a
 * member" — two contradictory errors, no path forward, and nothing anywhere
 * naming the real cause.
 *
 * The code was there the whole time. `DoplApiError` parses `{ error: { code,
 * message } }` into `.code` / `.apiMessage` (packages/dopl-client/src/errors.ts)
 * and every channels-route 400 carries one — `HttpError.toResponseBody()` makes
 * that unconditional. The tools simply discarded it. This module reads it,
 * duck-typed on the shape so nothing has to import the error class across the
 * @dopl/client boundary (the same discipline as `respond.ts`'s isNotFound /
 * isConflict / isAlreadyExists).
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_CAP_NOTE = exports.FIELD_CAPS_NOTE = void 0;
exports.isBadRequest = isBadRequest;
exports.isForbidden = isForbidden;
exports.classifyBadRequest = classifyBadRequest;
exports.classifyForbidden = classifyForbidden;
exports.serverDetail = serverDetail;
const channel_shared_1 = require("./channel-shared");
// The merged agent-address cap has ONE statement in this package — see
// channel-addressing.ts for why it is not the array's `.max()`.
const channel_addressing_1 = require("./channel-addressing");
/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
function isBadRequest(e) {
    return (typeof e === "object" && e !== null && e.status === 400);
}
/** Duck-typed HTTP 403 from the Dopl API (thread authorization refusals). */
function isForbidden(e) {
    return (typeof e === "object" && e !== null && e.status === 403);
}
/** The `code` a DoplApiError carries, or null when the body had none. */
function apiErrorCode(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const code = e.code;
    return typeof code === "string" && code.length > 0 ? code : null;
}
function classifyBadRequest(e) {
    switch (apiErrorCode(e)) {
        case "CHANNEL_ADDRESSEE_NOT_MEMBER":
            return "addressee_not_member";
        case "CHANNEL_TASK_NOT_IN_CHANNEL":
            return "thread_not_in_channel";
        case "CHANNEL_TASK_SELF_TARGET":
            return "self_target";
        case "VALIDATION_FAILED":
        case "INVALID_JSON":
        case "BAD_REQUEST":
            return "invalid_request";
        case "CHANNEL_PARTICIPANT_NOT_MEMBER":
            return "participant_not_member";
        case "CHANNEL_AGENT_NOT_IN_CHANNEL":
            return "agent_not_in_channel";
        case "CHANNEL_TOO_MANY_AGENTS":
            return "too_many_agents";
        case "CHANNEL_CHAT_ADDRESSED":
            return "chat_addressed";
        case "WORKSPACE_REQUIRED":
        case "WORKSPACE_INVALID":
            return "workspace";
        default:
            return "unknown";
    }
}
function classifyForbidden(e) {
    switch (apiErrorCode(e)) {
        case "CHANNEL_FORBIDDEN":
            return "not_a_member";
        case "TASK_FORBIDDEN":
            return "thread_authorization";
        case "CHANNEL_AGENT_FORBIDDEN":
            return "agent_owner";
        default:
            return "unknown";
    }
}
/**
 * The server's own human message for an error, as a trailing clause — or "" when
 * there is nothing useful to add.
 *
 * NEUTRALIZED, for the same reason `describeFailure` is (FIX L5): "our own
 * server said it" is a claim about where the bytes came from, not about who
 * wrote them. A 400 routinely echoes a rejected field, and a not-found names a
 * counterparty-supplied ref. Spliced into an error line — which is unframed
 * narration by the tool — that text would be read as ours.
 */
function serverDetail(e) {
    if (typeof e !== "object" || e === null)
        return "";
    const raw = e.apiMessage;
    if (typeof raw !== "string" || raw.trim() === "")
        return "";
    const safe = (0, channel_shared_1.neutralizeInline)(raw);
    return safe ? ` The server said: ${safe}.` : "";
}
/**
 * The caps the routes actually enforce, quoted in the invalid-request messages
 * so an agent that hit one has a number to act on. Mirrored (not re-derived)
 * from `src/features/channels/schema.ts`; the MCP zod schema in `channel.ts`
 * mirrors the same numbers so the common case never reaches the route at all.
 */
exports.FIELD_CAPS_NOTE = "Field caps: title <=200 characters, body <=16000, a post's summary <=200, a close summary <=2000, client_msg_id <=200.";
/**
 * The MERGED agent cap, said the way the surface should have said it all along.
 *
 * The sentence has to carry the merge, not just the number: a caller that hit
 * this read `to_agents.max(8)` on the schema, counted eight entries, and was
 * refused — because `to_agent` was the ninth. Telling them "at most eight" and
 * stopping there sends them back to count the same eight again.
 */
exports.AGENT_CAP_NOTE = `One post may address at most ${channel_addressing_1.MAX_ADDRESSED_AGENTS} agents in total — \`to_agent\` and \`to_agents\` are ONE address between them, merged and deduped before the limit is applied, so \`to_agent\` counts as one of the ${channel_addressing_1.MAX_ADDRESSED_AGENTS}. Naming the same agent twice (by handle and by id) collapses to one. To reach more than ${channel_addressing_1.MAX_ADDRESSED_AGENTS}, post twice.`;
