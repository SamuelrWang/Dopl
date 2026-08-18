"use strict";
/**
 * PARTIAL READS — ⚠ "returned nothing" and "could not ask" are not the same
 * fact. `dopl_map` and `dopl_search` fan out across domains under
 * `.catch(() => [])`; the fail-soft half is right (one broken domain must not
 * fail the call), but an uncaught SILENCE makes a 500 render as `_None._` and
 * an agent read the workspace as empty. So the catch stays and the domain that
 * could not be read is NAMED, in the scope footer the reader already meets.
 *
 * ⚠ The cause is OUR OWN vocabulary, never the error's message: a
 * `DoplApiError` message is the API body, which for a 500 can carry SQL, a
 * column list, or a constraint name — none of it useful, all of it internals in
 * a string the model repeats to the user. `causeOf` maps onto a fixed set of
 * short phrases: enough to tell a permissions problem from an outage.
 *
 * ⚠ ONE definition, both tools — the copy that drifts is the one that stops
 * warning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.causeOf = causeOf;
exports.partialRead = partialRead;
const narration_1 = require("./narration");
/**
 * A short, safe cause. ⚠ Small CLOSED vocabulary: an HTTP status (the detail
 * separating "you may not" from "it is broken") or the transport failure mode.
 * NEVER the response body, never `e.message`.
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
            // ⚠ `inlineOr` on our own vocabulary is belt-and-braces: it keeps a
            // future `causeOf` that echoes peer-authored text from becoming an
            // injection site in the one line agents trust most.
            const named = failed
                .map((f) => `${f.domain} (${(0, narration_1.inlineOr)(f.cause, "`read failed`")})`)
                .join(", ");
            return (`PARTIAL READ — ${failed.length} of ${total} ${noun} could NOT be read and contributed nothing here, ` +
                `so what they hold is missing from this result, not absent from the workspace: ${named}. ` +
                `Re-run to get a complete picture. `);
        },
    };
}
