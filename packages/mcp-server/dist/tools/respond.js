"use strict";
/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.err = err;
exports.isConflict = isConflict;
exports.isNotFound = isNotFound;
exports.isAlreadyExists = isAlreadyExists;
exports.entitlementDenied = entitlementDenied;
exports.missingParams = missingParams;
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function err(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
/**
 * True when a thrown error is an optimistic-concurrency conflict (HTTP
 * 412) from the Dopl API. Duck-typed on `.status` so it works across the
 * @dopl/client module boundary without importing the error class.
 */
function isConflict(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 412);
}
/**
 * True when a thrown error is a 404 from the Dopl API. Same duck-typing
 * as `isConflict` — lets a tool turn a "nothing matched" backend response
 * into a clean error instead of either an opaque throw or a false success.
 */
function isNotFound(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 404);
}
/**
 * True when a thrown error is a 409 conflict from the Dopl API (a
 * name/title/slug already-exists collision). Lets a tool surface a clean
 * "already exists" message instead of an opaque throw.
 */
function isAlreadyExists(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 409);
}
/**
 * Plan-gate denial codes the API returns as a flat `{ error: <code>,
 * message, upgrade_url }` envelope: the free-plan object cap and the
 * free-plan chat retention window. Both mean "the data is intact,
 * upgrading lifts the gate".
 */
const ENTITLEMENT_CODES = new Set(["over_free_cap", "chat_outside_retention"]);
/**
 * Turn a thrown Dopl API error into a friendly tool error when it's a
 * plan-gate denial (HTTP 403, flat entitlement envelope), else null so
 * the caller rethrows.
 *
 * Duck-typed on `.code` / `.apiMessage` / `.upgradeUrl` (populated by
 * `@dopl/client`'s DoplApiError) so it works across the module boundary
 * without importing the error class. Surfaces the server's human message
 * and upgrade link VERBATIM so the agent sees an actionable "upgrade to
 * add more" — not a generic "request failed".
 */
function entitlementDenied(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const code = e.code;
    if (typeof code !== "string" || !ENTITLEMENT_CODES.has(code)) {
        return null;
    }
    const rec = e;
    const message = typeof rec.apiMessage === "string" && rec.apiMessage
        ? rec.apiMessage
        : code === "chat_outside_retention"
            ? "This chat is older than the free plan's history window. Nothing was deleted — upgrade to Pro to restore full chat history."
            : "This workspace has reached its free plan object limit. Nothing was deleted — existing objects stay readable and editable.";
    const url = typeof rec.upgradeUrl === "string" ? rec.upgradeUrl : "";
    return err(url ? `${message}\n\nUpgrade to continue: ${url}` : message);
}
/**
 * Returns an error response when any of `required` params is absent for the
 * given op, or null when they're all present. Treats undefined / null /
 * empty-string as absent — the same "no value" semantics the old per-tool
 * Zod `.min(1)` requireds enforced. Lets a single flat schema back many ops
 * while still rejecting under-specified calls with a clear message instead
 * of a downstream throw.
 */
function missingParams(op, args, required) {
    const missing = required.filter((k) => {
        const v = args[k];
        return v === undefined || v === null || v === "";
    });
    if (missing.length === 0)
        return null;
    const plural = missing.length === 1 ? "param" : "params";
    return err(`op="${op}" is missing required ${plural}: ${missing.join(", ")}.`);
}
