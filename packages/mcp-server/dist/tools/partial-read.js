"use strict";
/**
 * PARTIAL READS — "returned nothing" and "could not ask" are not the same fact.
 *
 * `dopl_map` and `dopl_search` each fan out across four or five domains and
 * wrap every one in `.catch(() => [])`. The fail-soft half is right: one broken
 * domain must not fail the whole call, and an agent that gets four of five
 * sections is better off than one that gets an error. What was wrong is that
 * the RESULT then asserted a fact the code never established — a knowledge
 * service returning 500 rendered as `_None._` under "Knowledge bases", and an
 * agent read the workspace as empty. Two agents did exactly that.
 *
 * So the catch stays and the SILENCE goes: a domain that could not be read is
 * named on the result, in the scope footer the reader already meets, with a
 * short cause.
 *
 * WHY THE CAUSE IS OUR OWN VOCABULARY AND NOT THE ERROR'S MESSAGE. A
 * `DoplApiError`'s message is the API's body — for a 500 that can be a Postgres
 * error carrying SQL, a column list, or a constraint name. None of that helps
 * an agent decide what to do next, and all of it is internals in a string the
 * model will happily repeat to the user. `causeOf` maps the error onto a fixed
 * set of short phrases instead: enough to tell a permissions problem from an
 * outage, nothing that leaks the inside of the server.
 *
 * ONE definition, both tools. Two copies of a "some of this is missing" notice
 * drift, and the copy that drifts is the one that stops warning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.causeOf = causeOf;
exports.partialRead = partialRead;
const narration_1 = require("./narration");
/**
 * A short, safe cause. Deliberately a small closed vocabulary: an HTTP status
 * (the one detail that separates "you may not" from "it is broken"), or the
 * transport failure mode. Never the response body, never `e.message`.
 */
function causeOf(e) {
    if (typeof e === "object" && e !== null) {
        const status = e.status;
        if (typeof status === "number")
            return `HTTP ${status}`;
        const name = e.name;
        if (name === "DoplTimeoutError")
            return "timed out";
        if (name === "DoplAbortError")
            return "cancelled";
        if (name === "DoplNetworkError")
            return "unreachable";
    }
    return "read failed";
}
function partialRead() {
    const failed = [];
    return {
        soft(domain, read, fallback) {
            return read.catch((e) => {
                failed.push({ domain, cause: causeOf(e) });
                return fallback;
            });
        },
        notice(total, noun) {
            if (failed.length === 0)
                return "";
            // `inlineOr` on our own vocabulary is belt-and-braces, not ceremony: it
            // is what keeps a future `causeOf` that echoes something peer-authored
            // from becoming an injection site in the one line agents trust most.
            const named = failed
                .map((f) => `${f.domain} (${(0, narration_1.inlineOr)(f.cause, "`read failed`")})`)
                .join(", ");
            return (`PARTIAL READ — ${failed.length} of ${total} ${noun} could NOT be read and contributed nothing here, ` +
                `so what they hold is missing from this result, not absent from the workspace: ${named}. ` +
                `Re-run to get a complete picture. `);
        },
    };
}
