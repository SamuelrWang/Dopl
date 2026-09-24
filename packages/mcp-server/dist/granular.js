"use strict";
/**
 * Serving a granular tool (DMP-013) from its manifest row and its text: the input schema, the
 * description, and the rewrite of a call into the bound legacy call. The registrar validates that
 * call against the legacy tool's own schema and runs the legacy pipeline, so every gate, charge and
 * tally sees legacy keys.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.granularShape = granularShape;
exports.granularDescription = granularDescription;
exports.legacyCall = legacyCall;
const zod_1 = require("zod");
const tool_manifest_js_1 = require("./tool-manifest.js");
const granular_text_js_1 = require("./granular-text.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
/** The jobs this connection serves, as [selector value, binding]; null value for a one-job tool. */
function servedJobs(t, legacy) {
    const jobs = typeof t.bind === "string" ? [[null, t.bind]] : Object.entries(t.bind);
    // A job whose legacy tool the profile did not offer is not served (dopl_only keeps two of three guides).
    return jobs.filter(([, key]) => legacy.has((0, tool_manifest_js_1.parseBinding)(key).tool));
}
/** The param as published: this tool's type or its legacy owner's, re-described, required or optional. */
function publish(schema, description, required) {
    const inner = schema instanceof zod_1.z.ZodOptional ? schema.unwrap() : schema;
    const described = inner.describe(description);
    return required ? described : described.optional();
}
/**
 * The row's params, typed by the tool's text or the first served legacy tool that publishes them,
 * plus the selector over the served jobs. Null when no job is served on this connection.
 */
function granularShape(t, legacy) {
    const jobs = servedJobs(t, legacy);
    if (jobs.length === 0)
        return null;
    const text = granular_text_js_1.GRANULAR_TEXT[t.name];
    const shapes = jobs.map(([, key]) => legacy.get((0, tool_manifest_js_1.parseBinding)(key).tool).shape);
    const shape = {};
    const selector = (0, tool_manifest_js_1.selectorOf)(t);
    if (selector) {
        const names = jobs.map(([job]) => job);
        const line = text.params?.[selector];
        const select = line ? zod_1.z.enum(names).describe(line) : zod_1.z.enum(names);
        shape[selector] = t.selectDefault && names.includes(t.selectDefault) ? select.default(t.selectDefault) : select;
    }
    const container = jobs.some(([, key]) => {
        const { tool, op } = (0, tool_manifest_js_1.parseBinding)(key);
        return (0, workspace_arg_js_1.acceptsWorkspaceArg)(tool, op);
    });
    for (const param of [...t.params, ...(t.carry ?? []), ...(container ? ["container"] : [])]) {
        const type = text.types?.[param] ?? shapes.find((s) => param in s)?.[param];
        // A param only an unserved job takes goes with that job.
        if (!type)
            continue;
        shape[param] = publish(type, text.params?.[param] ?? granular_text_js_1.SHARED_PARAMS[param], text.required?.includes(param) === true);
    }
    return shape;
}
function granularDescription(t) {
    const text = granular_text_js_1.GRANULAR_TEXT[t.name];
    return text.fenced ? `${text.description} ${granular_text_js_1.FENCE_POINTER}` : text.description;
}
/**
 * The legacy tool and args a granular call stands for: selector consumed, preset and op/action
 * written. `carried` are the params the legacy schema does not take, handed to its handler as-is.
 */
function legacyCall(t, args) {
    const selector = (0, tool_manifest_js_1.selectorOf)(t);
    const rest = {};
    const carried = {};
    for (const [key, value] of Object.entries(args)) {
        if (key === selector)
            continue;
        (t.carry?.includes(key) ? carried : rest)[key] = value;
    }
    const { tool, op } = (0, tool_manifest_js_1.parseBinding)(typeof t.bind === "string" ? t.bind : t.bind[args[selector]]);
    const [base, action] = op === undefined ? [] : op.split(".");
    return {
        tool,
        args: { ...rest, ...t.preset, ...(base !== undefined && { op: base }), ...(action !== undefined && { action }) },
        carried,
    };
}
