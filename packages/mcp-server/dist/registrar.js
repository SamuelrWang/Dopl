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
exports.workspaceArgTargets = exports.refusesUnaddressedWrite = exports.acceptsWorkspaceArg = exports.UNADDRESSED_WRITE_REFUSALS = exports.WORKSPACE_ARG_OPS = exports.CONTAINER_ARG_DESCRIPTION = void 0;
exports.createToolRegistrars = createToolRegistrars;
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
const container_resolve_js_1 = require("./container-resolve.js");
// ⚠ Re-exported: `tool-budget.test.ts` and `server.test.ts` read the contract
// through the registrar that injects it, which is where an agent meets it.
var workspace_arg_js_2 = require("./workspace-arg.js");
Object.defineProperty(exports, "CONTAINER_ARG_DESCRIPTION", { enumerable: true, get: function () { return workspace_arg_js_2.CONTAINER_ARG_DESCRIPTION; } });
Object.defineProperty(exports, "WORKSPACE_ARG_OPS", { enumerable: true, get: function () { return workspace_arg_js_2.WORKSPACE_ARG_OPS; } });
Object.defineProperty(exports, "UNADDRESSED_WRITE_REFUSALS", { enumerable: true, get: function () { return workspace_arg_js_2.UNADDRESSED_WRITE_REFUSALS; } });
Object.defineProperty(exports, "acceptsWorkspaceArg", { enumerable: true, get: function () { return workspace_arg_js_2.acceptsWorkspaceArg; } });
Object.defineProperty(exports, "refusesUnaddressedWrite", { enumerable: true, get: function () { return workspace_arg_js_2.refusesUnaddressedWrite; } });
Object.defineProperty(exports, "workspaceArgTargets", { enumerable: true, get: function () { return workspace_arg_js_2.workspaceArgTargets; } });
const status_footer_js_1 = require("./status-footer.js");
// 🔒 A CALL THAT WAS NOT CHARGED SAYS SO — once in the log, and on the call's own
// `_dopl_status` footer. The fail-open decision below is unchanged; this only makes
// its consequence legible (`credits-unmetered.ts`).
const credits_unmetered_js_1 = require("./credits-unmetered.js");
/**
 * 🔒 **THE ONE ADDRESSING ARG INJECTED INTO EVERY DOMAIN TOOL'S SCHEMA** —
 * `container` (R-32, Samuel 2026-09-17). Slug, id or the reserved `home`;
 * routes via the transport's AsyncLocalStorage override, leaving the
 * connection's container unchanged. Const so each description renders verbatim
 * — and identically — in every tool's MCP introspection.
 *
 * 🔒 **`workspace=` RETIRED HERE ON 2026-09-18, AND THE RETIREMENT IS THE
 * WAVE'S FUNDING.** The alias was published as a bare key for ONE release so a
 * caller that still sent it got its answer instead of a `-32602`; that release
 * shipped, and the key cost 21 chars × 9 schemas ≈ 189 characters PUSHED TO
 * EVERY CLIENT ON EVERY CONNECTION to advertise an argument nobody should have
 * newly adopted. `strictInput` now answers an unknown `workspace` with
 * `-32602 … Unrecognized key: "workspace"`, which NAMES the field — the one
 * outcome a deprecation window rules out, and exactly the outcome a completed
 * deprecation is for.
 */
const WORKSPACE_ARG_SHAPE = {
    container: zod_1.z.string().optional().describe(workspace_arg_js_1.CONTAINER_ARG_DESCRIPTION),
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
            // ⚠ THE WHOLE OUTCOME, not just the URL: which WALLET stopped decides the
            // sentence, and the counters + reset date are on the same answer.
            if (outcome?.allowed === false)
                return (0, respond_js_1.creditsExhausted)(outcome);
            // 🔒 **`degraded` IS AN ANSWER, NOT AN ERROR, AND IT USED TO VANISH HERE.**
            // The route fails open on any throw (`route.ts › failOpen`) and answers
            // `{ allowed: true, degraded: true }` — so `allowed !== false` let the call
            // run FREE with nothing said. Ship the web ahead of the migration and a
            // `PGRST202` puts the WHOLE estate on that branch. The charge still fails
            // open; it just stops being silent.
            if (outcome?.degraded === true) {
                (0, credits_unmetered_js_1.recordUnmetered)("degraded", `The consume endpoint answered degraded for workspace ${workspaceId}. ` +
                    `Check that the credit RPCs are applied — a signature the schema cache ` +
                    `cannot find answers PGRST202, which is the deploy-before-migrate shape.`);
            }
            return null;
        }
        catch (err) {
            // ⚠ ONCE PER PROCESS PER REASON, not once per CALL. Under a real outage the
            // old per-call line was one error per tool call per agent, which buries the
            // line that says what broke — and a deploy-ordering bug is a STATE, not an
            // event.
            (0, credits_unmetered_js_1.recordUnmetered)("consume_failed", `Consume call failed for workspace ${workspaceId}; allowing the tool call: ${err instanceof Error ? err.message : String(err)}`);
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
            const { container: _c, ...rest } = args;
            const innerArgs = rest;
            // ⚠ Both per-call refusals before any work: delete block, then read-only
            // write-scope gate. `op` read ONCE, and it is also the routing key below.
            const op = gates.requestedOp(innerArgs);
            const refusal = gates.opRefusal(name, op);
            if (refusal)
                return refusal;
            // 🔒 ONE DECISION, ONE PLACE — `container-resolve.ts` owns the grammar,
            // the alias, the blank/not-found refusals and R-32's unaddressed-mint
            // refusal. This wrapper only spends the answer.
            const address = await (0, container_resolve_js_1.resolveCallAddress)(name, op, { container: _c }, { directory, activeWorkspace });
            if (address.kind === "refusal")
                return address.response;
            if (address.kind === "addressed") {
                // Handler runs inside the AsyncLocalStorage scope so client.* calls
                // pick up the override in X-Workspace-Id; reverts on scope exit. Footer
                // reports the EFFECTIVE container with a `per-call arg` source.
                const { effective } = address;
                const result = await runWithCredits(effective.id, () => client_1.workspaceContext.run(effective.id, () => handler(innerArgs)));
                return (0, status_footer_js_1.appendDoplStatus)(result, effective, caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()));
            }
            const result = await runWithCredits(await billingTarget(), () => handler(innerArgs));
            // ⚠ BOTH NOTES, NOT ONE: a dropped address and an unmetered call are
            // independent facts about the same call, and dropping either is a silence.
            return (0, status_footer_js_1.appendDoplStatus)(result, sessionEffective(), caller, (0, credits_unmetered_js_1.joinNotes)(address.note, (0, credits_unmetered_js_1.unmeteredNote)()));
        };
        server.registerTool(name, { description, inputSchema: strictInput(enhancedSchema) }, 
        // ⚠ THE SCOPE ENCLOSES THE HANDLER **AND** THE FOOTER, which is what makes
        // `dopl_search`'s PER-LEG charge reportable: it fires deep inside a handler
        // and its return value never reaches `appendDoplStatus`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => wrapped(args))));
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
        // ⚠ SAME TWO PIECES AS THE DOMAIN PATH — the opt-in charge above is a
        // `chargeCredit` call like any other, so it reports through the same scope.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const framed = (0, status_footer_js_1.withDoplStatus)(gated, sessionEffective, caller, credits_unmetered_js_1.unmeteredNote);
        server.registerTool(name, { description, inputSchema: strictInput(schema) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((args) => (0, credits_unmetered_js_1.withUnmeteredScope)(() => framed(args))));
    }
    return { registerTool, registerMetaTool, chargeCredit };
}
