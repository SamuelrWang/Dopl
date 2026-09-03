"use strict";
/**
 * registrar.ts — the two registration helpers every tool goes through. Owns
 * what happens to a tool between "a registrar declared it" and "the SDK
 * publishes it"; `server.ts` boots the session.
 *
 * ⚠ Gates live in `gating.ts` and BOTH helpers call them EXPLICITLY, because
 * `registerMetaTool` registers straight onto the SDK server and never goes
 * through `registerTool`'s wrapper. Do not fold the gate calls into one wrapper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceArgTargets = exports.acceptsWorkspaceArg = exports.WORKSPACE_ARG_OPS = exports.WORKSPACE_ARG_DESCRIPTION = void 0;
exports.createToolRegistrars = createToolRegistrars;
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const narration_js_1 = require("./tools/narration.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
// ⚠ Re-exported: `tool-budget.test.ts` and `server.test.ts` read the contract
// through the registrar that injects it, which is where an agent meets it.
var workspace_arg_js_2 = require("./workspace-arg.js");
Object.defineProperty(exports, "WORKSPACE_ARG_DESCRIPTION", { enumerable: true, get: function () { return workspace_arg_js_2.WORKSPACE_ARG_DESCRIPTION; } });
Object.defineProperty(exports, "WORKSPACE_ARG_OPS", { enumerable: true, get: function () { return workspace_arg_js_2.WORKSPACE_ARG_OPS; } });
Object.defineProperty(exports, "acceptsWorkspaceArg", { enumerable: true, get: function () { return workspace_arg_js_2.acceptsWorkspaceArg; } });
Object.defineProperty(exports, "workspaceArgTargets", { enumerable: true, get: function () { return workspace_arg_js_2.workspaceArgTargets; } });
const status_footer_js_1 = require("./status-footer.js");
/**
 * Optional per-call `workspace` arg injected into every domain tool's schema by
 * `registerTool`. Slug or UUID; routes via the transport's AsyncLocalStorage
 * override, leaving the connection's container unchanged. Const so its
 * description renders verbatim — and identically — in every tool's MCP
 * introspection.
 *
 * ⚠ IT IS INJECTED EVEN WHERE IT IS IGNORED, and that is the point of the
 * one-release window: `strictInput` refuses an unknown key, so a schema without
 * it would turn "ignored" into `-32602`, which is the one thing B13 rules out.
 */
const WORKSPACE_ARG_SHAPE = {
    workspace: zod_1.z.string().optional().describe(workspace_arg_js_1.WORKSPACE_ARG_DESCRIPTION),
};
/**
 * ⚠ AN UNKNOWN ARGUMENT MUST BE REFUSED, NOT STRIPPED. A raw shape becomes a
 * plain `z.object`, which DROPS unknown keys — an invented param (e.g. a
 * removed addressing arg) then vanishes before the handler sees `args` and the
 * handler narrates a success for a delivery that never happened. Copy fixes do
 * not compose: a model can invent a param from a stale blog post or its own
 * prior. `z.strictObject` sets the catchall to `never`, so the SDK surfaces
 * `-32602 … Unrecognized key: "<name>"` — NAMING the field is what lets the
 * calling agent correct itself.
 *
 * ⚠ Requires `registerTool`, NOT the positional `tool()`: `tool()` accepts only
 * a RAW SHAPE (`isZodRawShapeCompat` is false for a schema INSTANCE, and the
 * next arm reads the object as annotations and throws). Published JSON Schema
 * is byte-identical apart from a gained `additionalProperties: false`.
 *
 * Applied at BOTH registration helpers below. Pinned in `server.test.ts`.
 */
function strictInput(shape) {
    return zod_1.z.strictObject(shape);
}
function createCharger(client) {
    return async function charge(workspaceId) {
        try {
            const outcome = await client.consumeCredits(workspaceId);
            return outcome?.allowed === false
                ? (0, respond_js_1.creditsExhausted)(outcome.upgradeUrl)
                : null;
        }
        catch (err) {
            console.error(`[credits] consume call failed for workspace ${workspaceId}; allowing the tool call: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    };
}
function createCreditedRunner(charge) {
    /**
     * Charge one credit, then run the handler. Converts an entitlement denial (403
     * from any write op through @dopl/client) into a tool error; all other errors
     * rethrow unchanged.
     *
     * ⚠ **`null` IS "NOTHING TO CHARGE", NOT "FREE BY DEFAULT"** (B13). It reaches
     * here only from `billingTarget`, whose docblock owns the fail-open decision;
     * folding a second skip-the-charge path in anywhere else is how a tool call
     * stops being metered exactly once.
     */
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
    /**
     * WHICH WORKSPACE PAYS when no per-call `workspace=` was honoured. ⚠ ONE
     * RULE FOR BOTH REGISTRATION PATHS since B13 — the domain path used to refuse
     * instead of answering this, and two rules is how a meta tool and a domain
     * tool come to bill different workspaces for the same connection.
     *
     * ⚠ NO LISTABLE WORKSPACE ⇒ NO CHARGE, fail-open and stated. A caller whose
     * container the SERVER resolves is exactly the caller this server cannot name
     * one for, and refusing them would break the path B13 exists to open.
     */
    async function billingTarget() {
        if (activeWorkspace)
            return activeWorkspace.id;
        try {
            return (await directory.getWorkspaceList())[0]?.id ?? null;
        }
        catch {
            // A metering target is not worth failing a call over.
            return null;
        }
    }
    // Every domain tool funnels through here for three things:
    //   1. `workspace` arg auto-injected. HONOURED on the ops in
    //      `WORKSPACE_ARG_OPS` — the call then runs inside a transport-level
    //      AsyncLocalStorage override so client.* requests carry the right
    //      `X-Workspace-Id`. IGNORED everywhere else, and never refused (B13).
    //   2. ⚠ THE IGNORE IS REPORTED, not swallowed — `_dopl_status` names the op
    //      that dropped it, which is what makes a one-release window observable.
    //   3. Mandatory `_dopl_status` footer naming the effective workspace + how
    //      it was chosen.
    // Signature mirrors the MCP SDK's zod inference so handler arg types resolve.
    function registerTool(name, description, schema, handler) {
        if (gates.isSuppressedTool(name))
            return;
        // Spread into the published schema so every tool's introspection shows it;
        // stripped again before the handler, whose signature does not know it.
        const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE };
        const wrapped = async (args) => {
            const { workspace: workspaceRef, ...rest } = args;
            const innerArgs = rest;
            // ⚠ Both per-call refusals before any work: delete block, then read-only
            // write-scope gate. `op` read ONCE, and it is also the routing key below.
            const op = gates.requestedOp(innerArgs);
            const refusal = gates.opRefusal(name, op);
            if (refusal)
                return refusal;
            const supplied = typeof workspaceRef === "string" ? workspaceRef.trim() : "";
            if (workspaceRef !== undefined && (0, workspace_arg_js_1.acceptsWorkspaceArg)(name, op)) {
                // ⚠ "provided but blank" (fail closed) must stay distinct from "not
                // provided". A falsy-string test lets a computed-but-empty ref route a
                // write to a container the caller never named.
                if (!supplied) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `The \`workspace\` argument was blank. Pass a container id or slug from \`dopl_workspaces\`, or omit \`workspace=\` entirely to use this connection's container.`,
                            },
                        ],
                    };
                }
                // ⚠ `resolveWorkspaceRef` calls listWorkspaces and can throw on
                // network/auth failure — an uncaught throw surfaces as an opaque MCP
                // framework error.
                let resolved;
                try {
                    resolved = await directory.resolveWorkspaceRef(supplied);
                }
                catch (err) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                // ⚠ Loopback origin names where the bytes came from, not who
                                // wrote them — a 4xx can echo a rejected field.
                                text: `Couldn't validate the \`workspace\` argument (${(0, narration_js_1.inlineOr)(err instanceof Error ? err.message : String(err), "\`no detail reported\`")}). Try again, or call without \`workspace=\`.`,
                            },
                        ],
                    };
                }
                if (!resolved) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                // ⚠ Caller's own arg, but a raw backtick still escapes this
                                // span and puts the tail into narration.
                                text: `Workspace not found: ${(0, narration_js_1.inlineOr)(supplied, "\`(unreadable ref)\`")}. Call \`dopl_workspaces\` for every container you can reach — workspaces and home channels alike.`,
                            },
                        ],
                    };
                }
                // Handler runs inside the AsyncLocalStorage scope so client.* calls
                // pick up the override in X-Workspace-Id; reverts on scope exit. Footer
                // reports the EFFECTIVE workspace with a `per-call arg` source.
                const effective = {
                    id: resolved.id,
                    slug: resolved.slug,
                    name: resolved.name,
                    role: resolved.role,
                    source: "per-call arg",
                };
                const result = await runWithCredits(resolved.id, () => client_1.workspaceContext.run(resolved.id, () => handler(innerArgs)));
                return (0, status_footer_js_1.appendDoplStatus)(result, effective, caller);
            }
            // ⚠ NO HONOURED `workspace=`. The call runs in this connection's
            // container, and when the connection names none the SERVER resolves the
            // caller's own — there is no guess to make here and nothing to refuse.
            const ignored = workspaceRef === undefined ? null : (0, workspace_arg_js_1.ignoredWorkspaceNote)(op, supplied);
            const result = await runWithCredits(await billingTarget(), () => handler(innerArgs));
            return (0, status_footer_js_1.appendDoplStatus)(result, sessionEffective(), caller, ignored);
        };
        server.registerTool(name, { description, inputSchema: strictInput(enhancedSchema) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrapped);
    }
    // Meta-tools skip the `workspace` arg — an account-wide lookup is user-scoped,
    // so ALS routing adds noise without changing behavior. The workspace arg is
    // the ONLY difference between the two paths; everything else applies here too.
    //
    // ⚠ This path registers straight onto the SDK server, bypassing
    // `registerTool`'s wrapper by construction — hence the explicit gate calls
    // below. Never add a gate that only one path performs.
    //
    // ⚠ MCP CREDITS ARE NOT CHARGED HERE BY DEFAULT, by DECISION: `dopl_workspaces`
    // is how a lost agent finds out where it is, and it is user-scoped.
    //
    // ⚠ **ONE TOOL OPTS IN, AND THE CALL IS EXPLICIT AND LOCAL** (Samuel's ruling
    // Q2 (b), 2026-08-28; `dopl_status` is the one since B13 retired `dopl_home`).
    // It reads content-adjacent data across the whole account, so it pays like a
    // domain tool — but it cannot use the domain path, which injects a `workspace=`
    // arg this tool exists to make unnecessary. The charge is therefore written
    // HERE, by name, exactly as `opRefusal` is on both paths, rather than by
    // routing this file's two registration helpers through one shared wrapper. A
    // blanket charge on this path would meter the orientation tool and delete the
    // decision above.
    function registerMetaTool(name, description, schema, handler, opts = {}) {
        if (gates.isSuppressedTool(name))
            return;
        const gated = async (args) => {
            const refusal = gates.opRefusal(name, gates.requestedOp(args));
            if (refusal)
                return refusal;
            if (!opts.charged)
                return handler(args);
            // ⚠ WHICH WORKSPACE PAYS, for a tool that targets none — `billingTarget`
            // above, the SAME rule the domain path uses since B13, and its docblock
            // owns both halves (the container-lock reroute and the fail-open hole).
            const billTo = await billingTarget();
            if (billTo) {
                const denied = await chargeCredit(billTo);
                if (denied)
                    return denied;
            }
            return handler(args);
        };
        server.registerTool(name, { description, inputSchema: strictInput(schema) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (0, status_footer_js_1.withDoplStatus)(gated, sessionEffective, caller));
    }
    return { registerTool, registerMetaTool, chargeCredit };
}
