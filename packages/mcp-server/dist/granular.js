"use strict";
/**
 * Serving a granular tool (DMP-013) from its manifest row: its input schema, its placeholder
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
/**
 * The row's params, each typed by the first bound legacy tool that publishes it, plus the selector.
 * Null when a bound legacy tool is not served on this connection (outside the profile offer).
 */
function granularShape(t, legacy) {
    const found = (0, tool_manifest_js_1.bindingsOf)(t).map((key) => legacy.get((0, tool_manifest_js_1.parseBinding)(key).tool)?.shape);
    if (found.includes(undefined))
        return null;
    const shapes = found;
    const shape = {};
    const selector = (0, tool_manifest_js_1.selectorOf)(t);
    if (selector) {
        const jobs = zod_1.z.enum(Object.keys(t.bind));
        shape[selector] = t.selectDefault ? jobs.default(t.selectDefault) : jobs;
    }
    for (const param of (0, tool_manifest_js_1.takesContainer)(t) ? [...t.params, "container"] : t.params) {
        const owner = shapes.find((s) => param in s);
        if (!owner)
            throw new Error(`${t.name}: no bound legacy tool publishes "${param}"`);
        shape[param] = owner[param];
    }
    return shape;
}
/** Placeholder until B3 writes the prose: the name as a sentence ("dopl_get_map" → "Get map."). */
function granularDescription(t) {
    const words = t.name.replace(/^dopl_/, "").replace(/_/g, " ");
    return `${words[0].toUpperCase()}${words.slice(1)}.`;
}
/** The legacy tool and args a granular call stands for: selector consumed, preset and op/action written. */
function legacyCall(t, args) {
    const selector = (0, tool_manifest_js_1.selectorOf)(t);
    const { [selector ?? ""]: job, ...rest } = args;
    const { tool, op } = (0, tool_manifest_js_1.parseBinding)(typeof t.bind === "string" ? t.bind : t.bind[job]);
    const [base, action] = op === undefined ? [] : op.split(".");
    return {
        tool,
        args: { ...rest, ...t.preset, ...(base !== undefined && { op: base }), ...(action !== undefined && { action }) },
    };
}
