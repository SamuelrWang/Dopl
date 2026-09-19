"use strict";
/**
 * `dopl_channel` API-ERROR CLASSIFICATION — ⚠ what a 4xx MEANS is read off the
 * error CODE, never guessed from the status. A bare `status === 400` branch
 * blames whichever param happened to be set, so an over-length title comes back
 * as "invite them first" and `op="rooms" action="invite"` then answers "already a member".
 *
 * `DoplApiError` parses `{ error: { code, message } }` into `.code` /
 * `.apiMessage` (packages/dopl-client/src/errors.ts) and every channels-route
 * 400 carries one — `HttpError.toResponseBody()` makes that unconditional.
 * Duck-typed here so nothing imports the error class across the @dopl/client
 * boundary (same discipline as `respond.ts`'s isNotFound / isConflict).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (parity.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_CAPS_NOTE = void 0;
exports.isBadRequest = isBadRequest;
exports.isForbidden = isForbidden;
exports.classifyBadRequest = classifyBadRequest;
exports.classifyForbidden = classifyForbidden;
exports.serverDetail = serverDetail;
const channel_shared_1 = require("./channel-shared");
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
        // ⚠ **THE UNION RESOLVER'S OWN REFUSAL** (2026-09-02, B4/B8). `to` names one
        // party in either namespace, and a name that resolves to NOBODY is a 400
        // rather than a silent `delivery=none` — the server's own message lists the
        // live agent handles and the channel's members, so `serverDetail` carries
        // the remedy and this arm only has to say nothing was sent.
        case "CHANNEL_RECIPIENT_UNRESOLVED":
            return "recipient_unresolved";
        case "CHANNEL_TASK_NOT_IN_CHANNEL":
            return "thread_not_in_channel";
        case "CHANNEL_TASK_SELF_TARGET":
            return "self_target";
        case "VALIDATION_FAILED":
        case "INVALID_JSON":
        case "BAD_REQUEST":
            return "invalid_request";
        // ⚠ `WORKSPACE_REQUIRED` SHARED THIS ARM UNTIL 2026-09-02 and is gone with
        // the default workspace: `workspaces/server/service.ts` raises ONE code now.
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
        case "CHANNEL_LIFECYCLE_KIND_FORBIDDEN":
            return "lifecycle_kind";
        default:
            return "unknown";
    }
}
/**
 * The server's own message as a trailing clause, or "" when there is nothing to
 * add. ⚠ NEUTRALIZED: "our own server said it" names where the bytes came from,
 * not who wrote them — a 400 routinely echoes a rejected field and a not-found
 * names a counterparty-supplied ref, and an error line is unframed narration.
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
 * Route-enforced caps, quoted in invalid-request messages so an agent has a
 * number to act on. ⚠ HAND-COPIED from `src/features/channels/schema.ts`, and
 * `channel-schema.ts`'s zod mirrors the same numbers — sync all three.
 *
 * ⚠ **IT IS PER-CALL TEXT, NOT PUSHED PROSE**, and that is why it can afford to be complete
 * where a `.describe()` cannot. It is governed by `write-result-budget.test.ts`, not by the
 * connection budget (`tool-budget.test.ts`), so a cap listed here costs only the callers who
 * actually got a 400 — which is exactly the audience that needs the number.
 *
 * ⚠ **`body` HAS THREE CAPS, NOT ONE, AND LISTING ONLY THE LOOSEST WAS THE DEFECT** (S50,
 * 2026-09-18). One published param feeds three routes: `op="send"` at 16000
 * (`schema.ts › ChannelMessageCreateSchema`), `op="manage" action="direct"` at 4000
 * (`schema-direction.ts`), and `op="manage" action="launch"` at 2000 — the goal
 * (`schema-launch.ts › LaunchCreateSchema.goal`). An agent told "body <=16000" after a launch
 * was rejected has been handed the one number that does not apply to its call.
 * ⚠ **`name` WAS MISSING ENTIRELY** for the same reason — it carries no `.max()` in the
 * published shape because it serves four actions, and the launch/rename arms cap at 60
 * (`LaunchCreateSchema.agentName`, `AgentDirectiveCreateSchema`'s rename arm, and
 * `main/agent-names.js › MAX_NAME` at the far end).
 */
exports.FIELD_CAPS_NOTE = "Field caps: summary <=200 characters, body <=16000 on op=\"send\" but <=4000 as a direction and <=2000 as a launch goal, name <=60, client_msg_id <=200.";
