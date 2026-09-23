"use strict";
/**
 * The two registration helpers every tool goes through. Gates (`gating.ts`) are called
 * explicitly on both paths, because `registerMetaTool` bypasses `registerTool`'s wrapper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTAINER_ARG_DESCRIPTION = void 0;
exports.createToolRegistrars = createToolRegistrars;
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
const container_resolve_js_1 = require("./container-resolve.js");
// Re-exported so tests read the injected arg's description through the registrar that injects it.
var workspace_arg_js_2 = require("./workspace-arg.js");
Object.defineProperty(exports, "CONTAINER_ARG_DESCRIPTION", { enumerable: true, get: function () { return workspace_arg_js_2.CONTAINER_ARG_DESCRIPTION; } });
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
 * Renamed args (no alias): the refusal names the successor. Keyed by tool: only a tool that
 * accepts the successor may name it.
 */
const RENAMED_ARGS = {
    dopl_agent: { template: "identity" },
    dopl_channel: { template: "identity" },
};
function renamedArgMessage(tool, issue) {
    if (issue.code !== "unrecognized_keys" || !issue.keys)
        return undefined;
    const map = RENAMED_ARGS[tool];
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
function createCharger(client) {
    return async function charge(workspaceId) {
        try {
            const outcome = await client.consumeCredits(workspaceId);
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
    return async function runWithCredits(workspaceId, run) {
        const refusal = workspaceId === null ? null : await charge(workspaceId);
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
    const { server, client, gates, directory, activeWorkspace, sessionEffective, caller, } = deps;
    const chargeCredit = createCharger(client);
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
                const result = await runWithCredits(effective.id, () => client_1.workspaceContext.run(effective.id, () => handler(innerArgs)));
                return (0, status_footer_js_1.appendDoplStatus)(result, effective, caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()), format, 
                // The connection's own binding, which the per-call override did not touch.
                sessionEffective());
            }
            const result = await runWithCredits(await billingTarget(), () => handler(innerArgs));
            return (0, status_footer_js_1.appendDoplStatus)(result, sessionEffective(), caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()), format);
        };
        server.registerTool(name, { description, inputSchema: strictInput(enhancedSchema, name) }, 
        // The scope encloses handler and footer, so `dopl_search`'s per-leg charges are reported.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => wrapped(args))));
    }
    // Meta path: no container arg (account-wide lookups). It bypasses `registerTool`'s wrapper, so its
    // gates are explicit — never add a gate only one path performs. Uncharged by default:
    // `dopl_status` is the one meta tool that pays (`opts.charged`).
    function registerMetaTool(name, description, schema, handler, opts = {}) {
        if (gates.isSuppressedTool(name))
            return;
        const gated = async (args) => {
            const refusal = gates.opRefusal(name, gates.requestedOp(args));
            if (refusal)
                return refusal;
            if (!opts.charged)
                return handler(args);
            const billTo = await billingTarget();
            if (billTo) {
                const denied = await chargeCredit(billTo);
                if (denied)
                    return denied;
            }
            return handler(args);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const framed = (0, status_footer_js_1.withDoplStatus)(gated, sessionEffective, caller, credits_unmetered_js_1.unmeteredNote);
        server.registerTool(name, { description, inputSchema: strictInput(schema, name) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => framed(args))));
    }
    return { registerTool, registerMetaTool, chargeCredit };
}
