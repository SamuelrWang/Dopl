"use strict";
/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDITS_EXHAUSTED_CODE = void 0;
exports.ok = ok;
exports.err = err;
exports.isConflict = isConflict;
exports.isNotFound = isNotFound;
exports.isApiError = isApiError;
exports.apiMessage = apiMessage;
exports.isAlreadyExists = isAlreadyExists;
exports.creditsExhausted = creditsExhausted;
exports.entitlementDenied = entitlementDenied;
exports.missingParams = missingParams;
const tool_errors_1 = require("./tool-errors");
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function err(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
/**
 * True for an optimistic-concurrency conflict (HTTP 412). ⚠ Duck-typed on
 * `.status` to work across the @dopl/client boundary without importing the
 * error class.
 */
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
/**
 * Duck-typed match on a `@dopl/client` HTTP error's STATUS **and** its `code`.
 *
 * ⚠ **ONE COPY OF THE DUCK-TYPE, MANY SENTENCES.** Four mappers across the agent
 * and knowledge surfaces were each re-typing this five-line shape
 * (`typeof e === "object" && e !== null && e.status === … && e.code === …`), and
 * a fifth was written for the KB copy on 2026-09-02. The PREDICATE is one fact
 * about the wire; the MESSAGE is domain prose and stays with its domain, which
 * is why this exports the test rather than a message builder.
 * ⚠ Duck-typed on purpose — this package must not import the client's error
 * class to ask a question about a status code.
 */
function isApiError(e, status, code) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === status &&
        e.code === code);
}
/**
 * The SERVER's own human sentence off an api error, or null when it sent none.
 * ⚠ Prefer it over a hand-written one wherever it exists: the server knows which
 * credential class or gate refused, and this layer does not.
 */
function apiMessage(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const msg = e.apiMessage;
    return typeof msg === "string" && msg ? msg : null;
}
/** True for a 409 (name/title/slug already-exists collision). */
function isAlreadyExists(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 409);
}
/**
 * Credit allowance spent for the billing period. ⚠ ONE wording for both
 * surfaces: the registrar's up-front refusal (reading `allowed: false` off the
 * consume response, not an error) and `entitlementDenied` below.
 */
exports.CREDITS_EXHAUSTED_CODE = tool_errors_1.CREDITS_EXHAUSTED.reason;
// ⚠ THE `reason=` PREFIX IS ADDITIVE AND THE SENTENCE IS NOT REPEATED (A14).
// `credits.test.ts` pins "out of credits", which the CODE's own meaning now
// carries — so the detail adds only what the meaning does not say, rather than
// restating it a second time on the same line.
const CREDITS_EXHAUSTED_MESSAGE = (0, tool_errors_1.refusal)(tool_errors_1.CREDITS_EXHAUSTED, "Nothing was deleted — credits reset at the start of the next period, and upgrading raises the monthly allowance.");
/**
 * Plan-gate denial codes returned as a flat
 * `{ error: <code>, message, upgrade_url }` envelope. All mean "the data is
 * intact, upgrading lifts the gate". `kb_storage_full` reaches an agent through
 * the ordinary write path — `kb_*` writes are loopback HTTP into the same route
 * handlers a browser uses, so one server-side gate covers both surfaces.
 */
const ENTITLEMENT_CODES = new Set([
    "over_free_cap",
    "chat_outside_retention",
    "kb_storage_full",
    exports.CREDITS_EXHAUSTED_CODE,
]);
/** `2026-09-01T00:00:00.000Z` → `2026-09-01`, or null when it is not a date.
 *  ⚠ Null OMITS the "Resets …" sentence; printing `Invalid Date` or a raw
 *  fragment of somebody's shape change is worse than saying nothing. */
function periodEndDate(periodEnd) {
    if (typeof periodEnd !== "string")
        return null;
    const day = periodEnd.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        return null;
    return Number.isNaN(Date.parse(periodEnd)) ? null : day;
}
/** `(1,000/5,000)`, or "" when the server sent no usable counters. */
function usageSpan(used, limit) {
    if (!Number.isFinite(used) || !Number.isFinite(limit))
        return "";
    return ` (${used.toLocaleString("en-US")}/${limit.toLocaleString("en-US")})`;
}
/**
 * Credits refusal rendered exactly like an entitlement denial (message +
 * upgrade link) so an agent reads ONE shape for every plan gate. ⚠ URL comes
 * from the server's consume response — this package cannot import
 * `billing/server/entitlements.ts › upgradeUrl`.
 *
 * ⚠ **THE SENTENCE NAMES WHOSE COUNTER STOPPED, BECAUSE NOTHING IS POOLED**
 * (Samuel, 2026-09-07). A `seat` refusal is about the caller's OWN allocation
 * inside that workspace — telling them "this workspace is out" would send them
 * to an admin who cannot help — and a `personal` refusal is about their home
 * space, where there is nothing to buy and therefore no link to offer.
 *
 * ⚠ **A MISSING `wallet` FALLS BACK, IT DOES NOT GUESS.** An older server omits
 * the field entirely and `null` is the unmetered posture; both render the
 * generic sentence, which is true of every wallet.
 */
function creditsExhausted(o) {
    const url = typeof o.upgradeUrl === "string" ? o.upgradeUrl : "";
    const span = usageSpan(o.used, o.limit);
    const day = periodEndDate(o.periodEnd);
    const resets = day ? ` Resets ${day}.` : "";
    if (o.wallet === "seat") {
        const head = `Your seat in this workspace is out of credits for this period${span}.${resets}`;
        return err(url
            ? `${head}\n\nUpgrade to Team for 5,000 credits per member: ${url}`
            : head);
    }
    if (o.wallet === "personal") {
        return err(`Your personal credits are used up for this month${span}.${resets}`);
    }
    return err(url
        ? `${CREDITS_EXHAUSTED_MESSAGE}\n\nUpgrade to continue: ${url}`
        : CREDITS_EXHAUSTED_MESSAGE);
}
/**
 * Plan-gate denial (403, flat entitlement envelope) → tool error, else null so
 * the caller rethrows. ⚠ Duck-typed on `.code`/`.apiMessage`/`.upgradeUrl` to
 * work across the module boundary. Surfaces the server's human message and
 * upgrade link VERBATIM, not a generic "request failed".
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
            ? "This chat is older than the free plan's history window. Nothing was deleted — upgrade to Team to restore full chat history."
            : code === exports.CREDITS_EXHAUSTED_CODE
                ? CREDITS_EXHAUSTED_MESSAGE
                : code === "kb_storage_full"
                    ? "This knowledge base has reached its storage limit. Nothing was deleted — it stays readable, and deleting files or writing a smaller one still works."
                    : "This workspace has reached its free plan object limit. Nothing was deleted — existing objects stay readable and editable.";
    const url = typeof rec.upgradeUrl === "string" ? rec.upgradeUrl : "";
    return err(url ? `${message}\n\nUpgrade to continue: ${url}` : message);
}
/**
 * Error response when any `required` param is absent for this op, else null.
 * ⚠ undefined / null / empty-string all count as absent. Lets one flat schema
 * back many ops while still rejecting under-specified calls clearly.
 */
function missingParams(op, args, required) {
    const missing = required.filter((k) => {
        const v = args[k];
        return v === undefined || v === null || v === "";
    });
    if (missing.length === 0)
        return null;
    const plural = missing.length === 1 ? "param" : "params";
    // ⚠ THE `reason=` LITERAL IS THE POINT. `tool-errors.ts` declares it once,
    // every tool's description teaches it, and this is the wire. Wording the
    // refusal by hand here is how the two spellings drift apart.
    return err((0, tool_errors_1.refusal)(tool_errors_1.MISSING_PARAMS, `op="${op}" is missing required ${plural}: ${missing.join(", ")}.`));
}
