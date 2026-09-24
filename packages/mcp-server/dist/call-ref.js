"use strict";
/**
 * EVERY CALL SPELLING AN AGENT READS, rendered for the connection's active tool set (DMP-013 B3).
 * A spelling is named by its manifest key (`channel.read`, `kb.write_file`, `channel.rooms.help`:
 * a binding key without the `dopl_` prefix, `:` as `.`) and rendered from `tool-manifest.ts`, so
 * `dopl_channel(op="read", …)` on a legacy connection is `dopl_read_channel(…)` on a granular one
 * with no second table. `call-spelling.test.ts` bans a hand-written spelling anywhere else in `src`.
 *
 * The active set rides an AsyncLocalStorage scope the registrar opens around every tool call and
 * resource read (`withToolSet`), so a handler, a refusal or a footer renders for ITS connection
 * without the set threaded through a signature. Outside any scope (an import-time constant, a
 * legacy description, a unit test) the set is `legacy`, the default.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withToolSet = withToolSet;
exports.activeToolSet = activeToolSet;
exports.calledAs = calledAs;
exports.legacyOnly = legacyOnly;
exports.bySet = bySet;
exports.callKeys = callKeys;
exports.toolName = toolName;
exports.callRef = callRef;
const node_async_hooks_1 = require("node:async_hooks");
const tool_manifest_js_1 = require("./tool-manifest.js");
const scope = new node_async_hooks_1.AsyncLocalStorage();
/**
 * Run `fn` with `set` active for everything it renders, awaited continuations included. `tool` names
 * the granular call it came through (`dopl_browse_knowledge(action="tree")`); null for a legacy call
 * or a resource read.
 */
function withToolSet(set, fn, tool = null) {
    return scope.run({ set, tool }, fn);
}
function activeToolSet() {
    return scope.getStore()?.set ?? tool_manifest_js_1.TOOL_SETS[0];
}
/**
 * The call being answered, named back to its caller: the granular call it came through, else the
 * legacy op as the caller spelled it — `op="export"`, after `legacy.tool` (`dopl_kb op="grant"`), or
 * as a call (`dopl_kb(op="grant")`).
 */
function calledAs(op, legacy = {}) {
    const granular = scope.getStore()?.tool;
    if (granular)
        return granular;
    const opText = `op="${op}"`;
    if (!legacy.tool)
        return opText;
    return legacy.form === "call" ? `${legacy.tool}(${opText})` : `${legacy.tool} ${opText}`;
}
/**
 * Marks text only a LEGACY call can reach (an answer to a legacy-only arg or op), which keeps its
 * legacy spelling; `call-spelling.test.ts` skips what it wraps. Never for text a granular call reaches.
 */
function legacyOnly(text) {
    return text;
}
/** Prose that differs by set beyond a call spelling (a renamed param, a sentence about ops). */
function bySet(choices) {
    return choices[activeToolSet()];
}
/**
 * Manifest key → every granular tool that runs it (two only for a `preset` binding). Built on first
 * use: `tool-manifest.ts` imports the gates, which import renderers that import this module.
 */
let targets = null;
function targetMap() {
    if (targets)
        return targets;
    const map = new Map();
    for (const tool of tool_manifest_js_1.GRANULAR_TOOLS) {
        const jobs = typeof tool.bind === "string" ? [[null, tool.bind]] : Object.entries(tool.bind);
        for (const [job, binding] of jobs) {
            const key = binding.slice("dopl_".length).replace(":", ".");
            map.set(key, [...(map.get(key) ?? []), { tool, job }]);
        }
    }
    return (targets = map);
}
/** Every key {@link callRef} renders. */
function callKeys() {
    return new Set(targetMap().keys());
}
/** A key's targets; an op without its action (`channel.manage`) names every job under it. */
function targetsOf(key) {
    const found = targetMap().get(key) ?? [...targetMap()].flatMap(([k, t]) => (k.startsWith(`${key}.`) ? t : []));
    if (found.length === 0)
        throw new Error(`callRef: "${key}" is not a manifest key`);
    return found;
}
/** A preset binding (`dopl_request_decision`) is picked when the args carry its preset. */
function pick(targets, args) {
    const unquote = (v) => (typeof v === "string" ? v.replace(/^["']|["']$/g, "") : v);
    const presetMatch = (t) => Object.entries(t.tool.preset ?? {}).every(([k, v]) => unquote(args[k] ?? "") === v);
    return targets.find((t) => t.tool.preset && presetMatch(t)) ?? targets.find((t) => !t.tool.preset);
}
function argText(args, skip = {}) {
    return Object.entries(args)
        .filter(([name]) => !(name in skip))
        .map(([name, value]) => (value === true ? name : `${name}=${value}`));
}
/** The tool `key` names, bare: `dopl_read_channel` (legacy `dopl_channel`); `args` pick a preset tool. */
function toolName(key, args = {}) {
    if (activeToolSet() === "legacy")
        return `dopl_${key.split(".")[0]}`;
    return pick(targetsOf(key), args).tool.name;
}
/**
 * `key` called with `args`, spelled for the active set. An op without its action spells, on a
 * granular connection, every tool under it (`dopl_launch_agent / dopl_manage_session`).
 */
function callRef(key, args = {}, options = {}) {
    const found = targetsOf(key);
    const q = options.quote ?? '"';
    if (activeToolSet() === "legacy") {
        const [tool, op, action] = key.split(".");
        const opText = [`op=${q}${op}${q}`, ...(action === undefined ? [] : [`action=${q}${action}${q}`])];
        const all = [...(op === undefined ? [] : opText), ...argText(args)].join(", ");
        switch (options.form) {
            case "op":
                return [...opText, ...argText(args)].join(" ");
            case "named":
                return [`dopl_${tool}`, ...opText, ...argText(args)].join(" ");
            case "args":
                return all;
            default:
                return `dopl_${tool}(${all})`;
        }
    }
    if (!targetMap().has(key))
        return [...new Set(found.map((t) => t.tool.name))].join(" / ");
    const { tool, job } = pick(found, args);
    const selector = (0, tool_manifest_js_1.selectorOf)(tool);
    const parts = [...(selector && job ? [`${selector}=${q}${job}${q}`] : []), ...argText(args, tool.preset)];
    return `${tool.name}(${parts.join(", ")})`;
}
