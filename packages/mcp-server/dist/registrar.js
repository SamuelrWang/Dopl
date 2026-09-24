"use strict";
/**
 * The two registration helpers every legacy tool goes through, and `registerGranular`, which serves
 * a granular tool by running its bound legacy tool's pipeline. Gates (`gating.ts`) are called
 * explicitly on both legacy paths, because `registerMetaTool` bypasses `registerTool`'s wrapper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTAINER_ARG_DESCRIPTION = void 0;
exports.createToolRegistrars = createToolRegistrars;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
const container_resolve_js_1 = require("./container-resolve.js");
const legacy_aliases_js_1 = require("./legacy-aliases.js");
const call_ref_js_1 = require("./call-ref.js");
const granular_js_1 = require("./granular.js");
const resources_js_1 = require("./resources.js");
const tool_manifest_js_1 = require("./tool-manifest.js");
// Re-exported so tests read the injected arg's description through the registrar that injects it.
var workspace_arg_js_2 = require("./workspace-arg.js");
Object.defineProperty(exports, "CONTAINER_ARG_DESCRIPTION", { enumerable: true, get: function () { return workspace_arg_js_2.CONTAINER_ARG_DESCRIPTION; } });
const gating_js_1 = require("./gating.js");
const status_footer_js_1 = require("./status-footer.js");
const credits_unmetered_js_1 = require("./credits-unmetered.js");
// The one addressing arg injected into every domain tool: `container` (slug, id or `home`), routed
// via the transport's AsyncLocalStorage override without changing the connection's container.
const WORKSPACE_ARG_SHAPE = {
    container: zod_1.z.string().optional().describe(workspace_arg_js_1.CONTAINER_ARG_DESCRIPTION),
};
/**
 * Unknown keys must be REFUSED, not stripped (`z.strictObject`): a stripped key makes a handler
 * narrate a success for an arg it never saw; the refusal names the key. Requires `registerTool`,
 * not the positional `tool()`, which accepts only a raw shape. Pinned in `strict-args.test.ts`.
 */
function strictInput(shape, tool) {
    return zod_1.z.strictObject(shape, {
        error: (issue) => renamedArgMessage(tool, issue),
    });
}
/**
 * The registration config every path publishes. `title` is the tool's own name because Codex copies a
 * tool's `title` into its approval request as `_meta.tool_title`, the only per-tool identity that
 * request carries — the desktop names the call by it (`dopl-desktop-app/main/runtime/codex/
 * server-requests.js › doplElicitation`). Pinned in `tool-title.test.ts` and `granular.test.ts`.
 */
function toolConfig(name, description, inputSchema) {
    return { title: name, description, inputSchema };
}
/**
 * Renamed args (no alias): the refusal names the successor. Keyed by tool: only a tool that
 * accepts the successor may name it.
 */
const RENAMED_ARGS = {
    dopl_agent: { template: "identity" },
    dopl_channel: { template: "identity" },
    dopl_ontology: legacy_aliases_js_1.LEGACY_ONTOLOGY_ARGS,
};
/** A granular tool inherits its bound legacy tools' renames, where it publishes the successor. */
const GRANULAR_RENAMED_ARGS = Object.fromEntries(tool_manifest_js_1.GRANULAR_TOOLS.map((t) => [
    t.name,
    Object.fromEntries((0, tool_manifest_js_1.bindingsOf)(t)
        .flatMap((key) => Object.entries(RENAMED_ARGS[(0, tool_manifest_js_1.parseBinding)(key).tool] ?? {}))
        .filter(([, successor]) => t.params.includes(successor))),
]));
function renamedArgMessage(tool, issue) {
    if (issue.code !== "unrecognized_keys" || !issue.keys)
        return undefined;
    const map = RENAMED_ARGS[tool] ?? GRANULAR_RENAMED_ARGS[tool];
    if (!map)
        return undefined;
    const renamed = issue.keys.filter((k) => Object.prototype.hasOwnProperty.call(map, k));
    if (renamed.length === 0)
        return undefined;
    const keys = issue.keys.map((k) => `"${k}"`).join(", ");
    // No quotes in the hint: the SDK JSON-serializes the issue, so they would arrive escaped.
    const hints = renamed.map((k) => `renamed: send ${map[k]}, not ${k}`).join("; ");
    return `Unrecognized key${issue.keys.length === 1 ? "" : "s"}: ${keys} — ${hints}`;
}
function tally(tool, op) {
    return { tool, op: op ?? "", write: op !== undefined && (0, gating_js_1.isWriteOp)(tool, op) };
}
function createCharger(client) {
    return async function charge(workspaceId, call) {
        try {
            const outcome = await client.consumeCredits(workspaceId, call);
            if (outcome?.allowed === false)
                return (0, respond_js_1.creditsExhausted)(outcome);
            // The consume route failed open (`consume/route.ts › failOpen`): run free, but say so.
            if (outcome?.degraded === true) {
                (0, credits_unmetered_js_1.recordUnmetered)("degraded", `The consume endpoint answered degraded for workspace ${workspaceId}. ` +
                    `Check that the credit RPCs are applied — a signature the schema cache ` +
                    `cannot find answers PGRST202, which is the deploy-before-migrate shape.`);
            }
            return null;
        }
        catch (err) {
            // Recorded once per process per reason, not per call.
            (0, credits_unmetered_js_1.recordUnmetered)("consume_failed", `Consume call failed for workspace ${workspaceId}; allowing the tool call: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    };
}
function createCreditedRunner(charge) {
    // Charge, then run. A `null` workspace is nothing to charge — only `billingTarget` produces it.
    return async function runWithCredits(workspaceId, call, run) {
        const refusal = workspaceId === null ? null : await charge(workspaceId, call);
        if (refusal)
            return refusal;
        try {
            return await run();
        }
        catch (e) {
            const denied = (0, respond_js_1.entitlementDenied)(e);
            if (denied)
                return denied;
            throw e;
        }
    };
}
function createToolRegistrars(deps) {
    const { server, client, gates, directory, activeWorkspace, sessionEffective, caller, toolSet = "legacy", } = deps;
    const chargeCredit = createCharger(client);
    // Every registered legacy tool, including one whose name the active granular set took. `run` is the
    // bare pipeline: each registration opens its own tool-set scope (`call-ref.ts › withToolSet`).
    const legacy = new Map();
    function publishLegacy(name, description, shape, run) {
        const input = strictInput(shape, name);
        legacy.set(name, { shape, input, run });
        if (!(0, tool_manifest_js_1.servesName)(toolSet, "legacy", name))
            return;
        server.registerTool(name, toolConfig(name, description, input), ((args) => (0, call_ref_js_1.withToolSet)(toolSet, () => run(args))));
    }
    const runWithCredits = createCreditedRunner(chargeCredit);
    /** Which workspace pays when no per-call container was honoured; none listable ⇒ no charge. */
    async function billingTarget() {
        if (activeWorkspace)
            return activeWorkspace.id;
        try {
            return (await directory.getWorkspaceList())[0]?.id ?? null;
        }
        catch {
            return null;
        }
    }
    // Injects the `container` arg (honoured only on `WORKSPACE_ARG_OPS`; elsewhere ignored and
    // reported in `_dopl_status`). Signature mirrors the SDK's zod inference for handler arg types.
    function registerTool(name, description, schema, handler) {
        if (gates.isSuppressedTool(name))
            return;
        // Published in every schema; stripped again before the handler.
        const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE };
        const wrapped = async (args) => {
            const { container: _c, ...rest } = args;
            const innerArgs = rest;
            // Gates before any work; `op` is read once and is also the routing key.
            const op = gates.requestedOp(innerArgs);
            const refusal = gates.opRefusal(name, op);
            if (refusal)
                return refusal;
            // Read here: the footer is appended after the handler's renderers, which cannot carry it.
            const format = (0, status_footer_js_1.requestedFormat)(innerArgs);
            // `container-resolve.ts` owns the address grammar and refusals; this only spends the answer.
            const address = await (0, container_resolve_js_1.resolveCallAddress)(name, op, { container: _c }, { directory, activeWorkspace });
            if (address.kind === "refusal")
                return address.response;
            if (address.kind === "addressed") {
                // Inside the ALS scope, client.* calls carry the override in `X-Workspace-Id`.
                const { effective } = address;
                const result = await runWithCredits(effective.id, tally(name, op), () => client_1.workspaceContext.run(effective.id, () => handler(innerArgs)));
                return (0, status_footer_js_1.appendDoplStatus)(result, effective, caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()), format, 
                // The connection's own binding, which the per-call override did not touch.
                sessionEffective());
            }
            const result = await runWithCredits(await billingTarget(), tally(name, op), () => handler(innerArgs));
            return (0, status_footer_js_1.appendDoplStatus)(result, sessionEffective(), caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()), format);
        };
        // The scope encloses handler and footer, so `dopl_search`'s per-leg charges are reported.
        publishLegacy(name, description, enhancedSchema, (args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => wrapped(args)));
    }
    // Meta path: no container arg (account-wide lookups). It bypasses `registerTool`'s wrapper, so its
    // gates are explicit — never add a gate only one path performs. Uncharged by default:
    // `dopl_status` is the one meta tool that pays (`opts.charged`).
    function registerMetaTool(name, description, schema, handler, opts = {}) {
        if (gates.isSuppressedTool(name))
            return;
        const gated = async (args) => {
            const op = gates.requestedOp(args);
            const refusal = gates.opRefusal(name, op);
            if (refusal)
                return refusal;
            if (!opts.charged)
                return handler(args);
            const billTo = await billingTarget();
            if (billTo) {
                const denied = await chargeCredit(billTo, tally(name, op));
                if (denied)
                    return denied;
            }
            return handler(args);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const framed = (0, status_footer_js_1.withDoplStatus)(gated, sessionEffective, caller, credits_unmetered_js_1.unmeteredNote);
        publishLegacy(name, description, schema, (args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => framed(args)));
    }
    // No gate of its own: the bound legacy pipeline runs every gate, charge and tally on legacy keys,
    // and `Gates.requestedOp` reads the op/action the binding wrote into the call.
    function registerGranular(t) {
        if (gates.isSuppressedTool(t.name) || !(0, tool_manifest_js_1.servesName)(toolSet, "granular", t.name))
            return;
        const shape = (0, granular_js_1.granularShape)(t, legacy);
        if (!shape)
            return;
        server.registerTool(t.name, {
            ...toolConfig(t.name, (0, granular_js_1.granularDescription)(t), strictInput(shape, t.name)),
            annotations: (0, tool_manifest_js_1.annotationsFor)(t),
            ...(t.alwaysLoad && { _meta: tool_manifest_js_1.ALWAYS_LOAD_META }),
        }, (async (args) => {
            const invalid = (message) => new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${t.name}: ${message}`);
            const selector = (0, tool_manifest_js_1.selectorOf)(t);
            const pulled = (0, granular_js_1.pulledResource)(t, args);
            if (pulled) {
                const stray = Object.keys(args).filter((k) => k !== selector);
                if (stray.length > 0)
                    throw invalid(`${stray.map((k) => `"${k}"`).join(", ")} not taken by this topic`);
                return (0, respond_js_1.ok)((0, call_ref_js_1.withToolSet)(toolSet, () => (0, resources_js_1.resourceText)(pulled)));
            }
            const call = (0, granular_js_1.legacyCall)(t, args);
            const target = legacy.get(call.tool);
            // A multi-job row's schema is the union of its jobs; the chosen job's own schema has the last
            // word, so a param that job does not take is refused by name, never passed through.
            const parsed = target.input.safeParse(call.args);
            if (!parsed.success)
                throw invalid(parsed.error.message);
            // Carried args were validated by this tool's own schema; the legacy one does not know them.
            // The call is named back with its job, so a refusal says which of the tool's jobs it was.
            const calledAs = selector ? `${t.name}(${selector}="${String(args[selector])}")` : t.name;
            const run = () => target.run({ ...parsed.data, ...call.carried });
            return (0, call_ref_js_1.withToolSet)(toolSet, run, calledAs);
        }));
    }
    return { registerTool, registerMetaTool, chargeCredit, registerGranular };
}
