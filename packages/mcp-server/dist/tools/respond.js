"use strict";
/**
 * Response + op-dispatch helpers for the `dopl_<domain>` tools: one `op` discriminator over a flat
 * schema, with each op's required params checked at runtime by {@link missingParams}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDITS_EXHAUSTED_CODE = void 0;
exports.ok = ok;
exports.err = err;
exports.isConflict = isConflict;
exports.isNotFound = isNotFound;
exports.isApiError = isApiError;
exports.apiErrorCode = apiErrorCode;
exports.apiMessage = apiMessage;
exports.sessionRequired = sessionRequired;
exports.isAlreadyExists = isAlreadyExists;
exports.creditsExhausted = creditsExhausted;
exports.entitlementDenied = entitlementDenied;
exports.missingParams = missingParams;
exports.unusedParams = unusedParams;
exports.strictParams = strictParams;
const call_ref_js_1 = require("../call-ref.js");
const tool_errors_1 = require("./tool-errors");
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function err(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
/** HTTP 412. Duck-typed so this package need not import the client's error class. */
function isConflict(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 412);
}
/** True for a 404. Same duck-typing as `isConflict`. */
function isNotFound(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 404);
}
/** Duck-typed match on a `@dopl/client` error's status and code. */
function isApiError(e, status, code) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === status &&
        e.code === code);
}
/** The `code` a DoplApiError carries, or null (duck-typed, like {@link isApiError}). */
function apiErrorCode(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const code = e.code;
    return typeof code === "string" && code.length > 0 ? code : null;
}
/** The server's own sentence, or null. Prefer it: the server knows which gate refused. */
function apiMessage(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const msg = e.apiMessage;
    return typeof msg === "string" && msg ? msg : null;
}
/**
 * 403 `SESSION_REQUIRED` = an app-only (`sessionOnly`) route, not a grantable permission; any other
 * error → null. No production caller yet; tested in `knowledge-refusals.test.ts`.
 */
function sessionRequired(e, op) {
    if (!isApiError(e, 403, "SESSION_REQUIRED"))
        return null;
    return err((0, tool_errors_1.refusal)(tool_errors_1.SESSION_REQUIRED, `${(0, call_ref_js_1.calledAs)(op)} is app-only and NOTHING changed. Your token is an agent credential, which this route refuses whatever scopes it carries — there is no permission to request and no other route in. Ask your operator to do it in the Dopl app.`));
}
/** True for a 409 (name/title/slug already-exists collision). */
function isAlreadyExists(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 409);
}
/** Credit allowance spent for the billing period. */
exports.CREDITS_EXHAUSTED_CODE = tool_errors_1.CREDITS_EXHAUSTED.reason;
// The code's meaning already says "out of credits" (pinned by `credits.test.ts`); don't repeat it.
const CREDITS_EXHAUSTED_MESSAGE = (0, tool_errors_1.refusal)(tool_errors_1.CREDITS_EXHAUSTED, "Nothing was deleted — credits reset at the start of the next period, and upgrading raises the monthly allowance.");
// Plan-gate codes (flat `{ error, message, upgrade_url }` envelope); the data is always intact.
const ENTITLEMENT_CODES = new Set([
    "over_free_cap",
    "chat_outside_retention",
    "kb_storage_full",
    exports.CREDITS_EXHAUSTED_CODE,
]);
/** ISO timestamp → `YYYY-MM-DD`, or null (which omits the "Resets …" sentence). */
function periodEndDate(periodEnd) {
    if (typeof periodEnd !== "string")
        return null;
    const day = periodEnd.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        return null;
    return Number.isNaN(Date.parse(periodEnd)) ? null : day;
}
/**
 * ` for 5,000 credits <unit>`, or `""`: the whole clause goes, never a figureless preposition.
 * `0` means no offer to size (degraded answers send it), not an allowance of zero.
 */
function upgradeFigure(credits, unit) {
    if (!Number.isFinite(credits) || credits <= 0)
        return "";
    return ` for ${credits.toLocaleString("en-US")} credits ${unit}`;
}
/** `(1,000/5,000)`, or "" when the server sent no usable counters. */
function usageSpan(used, limit) {
    if (!Number.isFinite(used) || !Number.isFinite(limit))
        return "";
    return ` (${used.toLocaleString("en-US")}/${limit.toLocaleString("en-US")})`;
}
/**
 * Credits refusal in the entitlement shape. Names whose counter stopped (nothing is pooled); the
 * upgrade line is decided by `upgradeUrl`, never by the wallet; no `wallet` → the generic sentence.
 */
function creditsExhausted(o) {
    const url = typeof o.upgradeUrl === "string" ? o.upgradeUrl : "";
    const span = usageSpan(o.used, o.limit);
    const day = periodEndDate(o.periodEnd);
    const resets = day ? ` Resets ${day}.` : "";
    if (o.wallet === "seat") {
        const head = `Your seat in this workspace is out of credits for this period${span}.${resets}`;
        const buys = upgradeFigure(o.upgradeCredits, "per member");
        return err(url ? `${head}\n\nUpgrade to Team${buys}: ${url}` : head);
    }
    if (o.wallet === "personal") {
        const head = `Your personal credits are used up for this month${span}.${resets}`;
        const buys = upgradeFigure(o.upgradeCredits, "a month");
        return err(url ? `${head}\n\nUpgrade to Pro${buys}: ${url}` : head);
    }
    return err(url
        ? `${CREDITS_EXHAUSTED_MESSAGE}\n\nUpgrade to continue: ${url}`
        : CREDITS_EXHAUSTED_MESSAGE);
}
/** Plan-gate 403 → tool error with the server's message and upgrade link verbatim; else null. */
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
            ? "This chat is older than the free plan's history window. Nothing was deleted — upgrade to Team to restore full chat history."
            : code === exports.CREDITS_EXHAUSTED_CODE
                ? CREDITS_EXHAUSTED_MESSAGE
                : code === "kb_storage_full"
                    ? "This knowledge base has reached its storage limit. Nothing was deleted — it stays readable, and deleting files or writing a smaller one still works."
                    : "This workspace has reached its free plan object limit. Nothing was deleted — existing objects stay readable and editable.";
    const url = typeof rec.upgradeUrl === "string" ? rec.upgradeUrl : "";
    return err(url ? `${message}\n\nUpgrade to continue: ${url}` : message);
}
/** Refusal when any `required` param is absent (undefined, null or ""), else null. */
function missingParams(op, args, required) {
    const missing = required.filter((k) => {
        const v = args[k];
        return v === undefined || v === null || v === "";
    });
    if (missing.length === 0)
        return null;
    const plural = missing.length === 1 ? "param" : "params";
    // Through the declared code, so the wire matches the `reason=` every description teaches.
    return err((0, tool_errors_1.refusal)(tool_errors_1.MISSING_PARAMS, `${(0, call_ref_js_1.calledAs)(op)} is missing required ${plural}: ${missing.join(", ")}.`));
}
/**
 * Refusal when a param the op does NOT take was sent (a flat schema cannot say "this key belongs to
 * that op"), else null. `allowed` is the op's own keys; `op`/`action` always pass. An ignored param
 * would narrate success over an argument that did nothing.
 */
function unusedParams(op, args, allowed) {
    const own = new Set(["op", "action", ...allowed]);
    const stray = Object.keys(args).filter((k) => !own.has(k) && args[k] !== undefined);
    if (stray.length === 0)
        return null;
    return err((0, tool_errors_1.refusal)(tool_errors_1.UNUSED_PARAM, `${(0, call_ref_js_1.calledAs)(op)} does not take: ${stray.join(", ")}. It takes: ${allowed.join(", ")}.`));
}
/** An op's whole param contract in one call: `missingParams` over `required`, then `unusedParams`
 *  over `required` + `optional`. */
function strictParams(op, args, required, optional = []) {
    return missingParams(op, args, required) ?? unusedParams(op, args, [...required, ...optional]);
}
