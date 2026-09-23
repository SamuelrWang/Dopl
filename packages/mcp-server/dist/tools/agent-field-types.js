"use strict";
/**
 * `dopl_agent` custom-field TYPES (DMP-009, 2026-09-23): the product's five-word vocabulary and the
 * value check the editor's controls imply.
 *
 * ⚠ THE VALUE IS ALWAYS A STRING. `type` is the editor's input affordance (`identity-editor-rows.tsx ›
 * FieldValueInput`) and the server never validates a value against it, so the rules here are
 * exactly what that control can PRODUCE: a number box yields a decimal numeral, a date box
 * `YYYY-MM-DD`, the yes/no select `yes` / `no`; `url` stays free text there, so it is unchecked
 * here too. `""` is legal for every type (a half-filled form). An agent that sends a value the UI
 * could never have written would hand the editor a control it cannot render.
 *
 * ⚠ AN UNCHANGED FIELD ALWAYS ROUND-TRIPS: a stored row whose value predates its type is sent back
 * as-is without being checked, so a read-modify-write never loses a field it did not touch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fieldTypeRefusal = fieldTypeRefusal;
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
const tool_errors_js_1 = require("./tool-errors.js");
/** What each type accepts, and how a refusal names it. */
const RULES = {
    number: { ok: /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/, expected: "a number such as 42 or 3.5" },
    date: { ok: /^\d{4}-\d{2}-\d{2}$/, expected: "a date as YYYY-MM-DD" },
    boolean: { ok: /^(?:yes|no)$/, expected: '"yes" or "no"' },
};
function realDate(value) {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
/** Refusal naming the first field whose value its type cannot hold, else null. */
function fieldTypeRefusal(fields, stored = []) {
    for (const f of fields ?? []) {
        const type = f.type ?? "text";
        if (type === "text" || type === "url" || f.value === "")
            continue;
        const twin = stored.find((s) => s.key === f.key);
        if (twin && twin.value === f.value && (twin.type ?? "text") === type)
            continue;
        const rule = RULES[type];
        const valid = rule.ok.test(f.value) && (type !== "date" || realDate(f.value));
        if (!valid) {
            return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)(tool_errors_js_1.KB_INVALID_FIELD, `field=${(0, narration_js_1.inlineOr)(f.key, narration_js_1.NO_NAME)} type=${type} expected ${rule.expected}, or "" to leave it blank`));
        }
    }
    return null;
}
