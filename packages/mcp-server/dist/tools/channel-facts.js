"use strict";
/**
 * The terse write result: one line of `key=value` facts only this call can say. Standing rules live
 * in `channel-doctrine.ts`; a fact keeps its verdict here as a token (`tags=0/2`) (INVARIANTS §10).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_APPLICABLE = exports.FACT_VALUE_MAX = exports.WRITE_RESULT_MAX_CHARS = void 0;
exports.factsLine = factsLine;
exports.tagFact = tagFact;
exports.deliveryFact = deliveryFact;
exports.postureFacts = postureFacts;
exports.runtimeFacts = runtimeFacts;
const channel_shared_1 = require("./channel-shared");
/** Budget for one write result, held per op by `write-result-budget.test.ts` (the renderer bounds values, not lines). */
exports.WRITE_RESULT_MAX_CHARS = 300;
/** Longest rendered value; ≥45 so a legacy `task-<uuid>-<seq>` id is never clipped (its seq is the distinguishing half). */
exports.FACT_VALUE_MAX = 48;
/** Differs from what `neutralizeInline` leaves alone only by `_`; widening it can forge `key=` pairs. */
const SAFE_BARE_TOKEN = /^[A-Za-z0-9_.:@/-]+$/;
/** A value nobody reported, or that does not apply to this call. Never zero. */
exports.NOT_APPLICABLE = "-";
/** One value: booleans as `yes`/`no`; strings neutralized (INVARIANTS §10), de-backticked and clipped. */
function renderValue(value) {
    if (value === null || value === undefined)
        return exports.NOT_APPLICABLE;
    if (typeof value === "boolean")
        return value ? "yes" : "no";
    if (typeof value === "number")
        return String(value);
    // An inert token skips the neutralizer, which would blank `_` and corrupt snake_case literals.
    if (SAFE_BARE_TOKEN.test(value)) {
        return value.length > exports.FACT_VALUE_MAX
            ? `${value.slice(0, exports.FACT_VALUE_MAX - 1)}…`
            : value;
    }
    const safe = (0, channel_shared_1.neutralizeInline)(value);
    if (safe === null)
        return exports.NOT_APPLICABLE;
    const bare = safe.replace(/`/g, "").trim();
    if (!bare)
        return exports.NOT_APPLICABLE;
    const clipped = bare.length > exports.FACT_VALUE_MAX
        ? `${bare.slice(0, exports.FACT_VALUE_MAX - 1)}…`
        : bare;
    // Whitespace-bearing values are quoted so a name (e.g. an identity name) cannot invent a `key=`.
    return /\s/.test(clipped) ? `"${clipped.replace(/"/g, "'")}"` : clipped;
}
/** The one write-result renderer: a head verb, then `key=value` pairs in the caller's order. */
function factsLine(head, fields) {
    const pairs = Object.entries(fields).map(([key, value]) => `${key}=${renderValue(value)}`);
    return [head, ...pairs].join(" ");
}
/** `resolved/attempted` over member tags; agent handles resolve on the operator's machine and are never counted. */
function tagFact(resolved, attempted) {
    return attempted === 0 ? undefined : `${resolved}/${attempted}`;
}
/** `<verdict>(predicted)` at write, `(confirmed)` once the machine reports back; `undefined` = no verdict computed, not `none`. */
function deliveryFact(delivery, deliveryAt) {
    if (!delivery)
        return undefined;
    return deliveryAt ? `${delivery}(confirmed)` : `${delivery}(predicted)`;
}
/**
 * The applied posture as `posture=<tools>/<messages> chain=on|off`. `null` renders `not reported`
 * and is never back-filled from the request: the desktop may clamp without saying so.
 */
function postureFacts(d) {
    const tools = d.appliedToolMode;
    const messages = d.appliedMessageMode;
    const chain = d.appliedChain;
    return tools === null && messages === null && chain === null
        ? { posture: "not reported", chain: "not reported" }
        : {
            posture: `${tools ?? "-"}/${messages ?? "-"}`,
            chain: chain === null ? "not reported" : chain ? "on" : "off",
        };
}
/**
 * `runtime=` is the applied runtime on every launch (`null` renders `not reported`, never the request);
 * `runtimeAsked=` prints only on disagreement, `appliedModel=` only when it differs from the requested `model`.
 */
function runtimeFacts(d) {
    const applied = d.appliedRuntime ?? null;
    const asked = d.runtime ?? null;
    const facts = {
        runtime: applied ?? "not reported",
    };
    if (asked !== null && asked !== applied)
        facts.runtimeAsked = asked;
    const model = d.appliedModel ?? null;
    if (model !== null && model !== d.model)
        facts.appliedModel = model;
    return facts;
}
