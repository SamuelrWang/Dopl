"use strict";
/**
 * ⚠ THE ONTOLOGY'S RETIRED MCP NAMES — never accepted, only answered with their successor.
 *
 * Samuel, 2026-09-23: *"The word "cluster" is obsolete, so it needs to be completely removed."*
 * `dopl_ontology` says `ontology=`, `op="create_ontology"` and `op="update_ontology"` since then.
 * A desktop at or below 1.36.0 still frames shared ontologies as `…op "map", cluster "<id>"`
 * (`dopl-desktop-app/main/prompt-framing-ontology.js` in that build), and an agent with an older
 * transcript may send the old op names. Neither is ACCEPTED — the schema never lists them, so no
 * agent-visible text carries the old word — but the refusal names the successor, which turns a
 * dead end into one retry. This is the only file in the package that spells the old word;
 * `src/features/ontology/vocabulary.test.ts` exempts it by path.
 *
 * ⚠ REMOVAL TRIGGER: the release after `src/shared/version/desktop-floor.ts ›
 * DEFAULT_MIN_VERSION` reaches 1.37.0 (the first desktop that frames `ontology`). Delete this
 * file and its two call sites (`registrar.ts › RENAMED_ARGS`, `tools/ontology.ts`'s op enum).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_ONTOLOGY_ARGS = void 0;
exports.legacyOntologyOpMessage = legacyOntologyOpMessage;
const call_ref_js_1 = require("./call-ref.js");
/** Retired `dopl_ontology` args → the arg that replaced each. */
exports.LEGACY_ONTOLOGY_ARGS = Object.freeze({
    cluster: "ontology",
});
/** Retired `dopl_ontology` ops → the op that replaced each. */
const LEGACY_ONTOLOGY_OPS = Object.freeze({
    create_cluster: "create_ontology",
    update_cluster: "update_ontology",
});
/**
 * The op enum's error for a retired op name, or `undefined` for zod's own message. No quotes in
 * the hint: the SDK JSON-serializes the issue, so they would arrive escaped.
 */
function legacyOntologyOpMessage(issue) {
    const op = typeof issue.input === "string" ? issue.input : undefined;
    if (!op || !Object.prototype.hasOwnProperty.call(LEGACY_ONTOLOGY_OPS, op))
        return undefined;
    return (0, call_ref_js_1.legacyOnly)(`Unknown op ${op} — renamed: send op=${LEGACY_ONTOLOGY_OPS[op]}`);
}
