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
exports.createToolRegistrars = createToolRegistrars;
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const narration_js_1 = require("./tools/narration.js");
const status_footer_js_1 = require("./status-footer.js");
/**
 * Optional per-call `workspace` arg injected into every tool schema by
 * `registerTool`. Slug or UUID; routes via the transport's AsyncLocalStorage
 * override, leaving the session default unchanged. Const so its description
 * renders verbatim in every tool's MCP introspection.
 */
const WORKSPACE_ARG_SHAPE = {
    workspace: zod_1.z
        .string()
        .optional()
        .describe("Workspace slug or UUID to target for this single call. Omit to use the session's workspace (see `current_workspace`). REQUIRED on every call when the user belongs to 2+ workspaces — there is no default then, so a no-arg call is refused with the list of choices. Use `list_workspaces` to discover slugs."),
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
/**
 * THE BILLING SEAM FOR ONE TOOL CALL — charge, then run. ⚠ Must stay ONE helper
 * called at exactly the two terminal paths of `registerTool`'s wrapper; that is
 * what makes the per-tool-call charge exactly-once. A separate charge helper
 * means two call sites per path and a future path that remembers one of them.
 *
 * ⚠ ORDERING, non-negotiable: AFTER `gates.opRefusal` (delete refusal stays
 * first and unconditional — a refused delete costs zero round trips), AFTER
 * workspace resolution (credits are per-workspace), BEFORE the handler.
 *
 * ⚠ NOT in `withWorkspaceAuth` beside `logMcpToolCall` — that fires per
 * LOOPBACK request, and one tool call makes 0..N of them.
 */
function createCreditedRunner(client) {
    /**
     * Spend one credit for `workspaceId`. Returns the refusal, or null to proceed.
     *
     * ⚠ FAIL OPEN on anything that is not an honest "out of credits" — refusing
     * on a transient loopback blip bricks every agent and reads to the operator
     * as "out of credits" for a workspace that is not.
     *
     * ⚠ ONLY `allowed === false` REFUSES, not "not truthy". A 200 missing
     * `allowed` (proxy error page, shape change, partial response) leaves it
     * undefined, and a truthiness test reads that as a refusal — fail-open for a
     * THROWN error, silently inverted for a malformed answer, which is the more
     * likely of the two. A body that does not say "no" is not a no.
     */
    async function charge(workspaceId) {
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
    }
    /**
     * Charge one credit, then run the handler. Converts an entitlement denial (403
     * from any write op through @dopl/client) into a tool error; all other errors
     * rethrow unchanged.
     */
    return async function runWithCredits(workspaceId, run) {
        const refusal = await charge(workspaceId);
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
    const runWithCredits = createCreditedRunner(client);
    // Every domain tool funnels through here for two things:
    //   1. `workspace` arg auto-injected. Provided → runs inside a
    //      transport-level AsyncLocalStorage override so client.* requests carry
    //      the right `X-Workspace-Id`. Omitted AND no session default (0/2+
    //      memberships, no pin) → REFUSED rather than guessing a workspace.
    //   2. Mandatory `_dopl_status` footer naming the effective workspace + how
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
            // write-scope gate. `op` read ONCE.
            const refusal = gates.opRefusal(name, gates.requestedOp(innerArgs));
            if (refusal)
                return refusal;
            // ⚠ "provided but blank" (fail closed) must stay distinct from "not
            // provided" (session default). A falsy-string test lets a
            // computed-but-empty ref route a write to the user's REAL workspace.
            if (workspaceRef !== undefined) {
                const ref = typeof workspaceRef === "string" ? workspaceRef.trim() : "";
                if (!ref) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `The \`workspace\` argument was blank. Pass a slug or UUID from \`list_workspaces\`, or omit \`workspace=\` entirely to use the session's active workspace.`,
                            },
                        ],
                    };
                }
                // ⚠ `resolveWorkspaceRef` calls listWorkspaces and can throw on
                // network/auth failure — an uncaught throw surfaces as an opaque MCP
                // framework error.
                let resolved;
                try {
                    resolved = await directory.resolveWorkspaceRef(ref);
                }
                catch (err) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                // ⚠ Loopback origin names where the bytes came from, not who
                                // wrote them — a 4xx can echo a rejected field.
                                text: `Couldn't validate the \`workspace\` argument (${(0, narration_js_1.inlineOr)(err instanceof Error ? err.message : String(err), "`no detail reported`")}). Try again, or call without \`workspace=\` to use the session's active workspace.`,
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
                                text: `Workspace not found: ${(0, narration_js_1.inlineOr)(ref, "`(unreadable ref)`")}. Call \`list_workspaces\` to see workspaces you have access to, or pass a slug or UUID from there.`,
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
            // ⚠ No `workspace=`: use the session default (single membership or header
            // pin), else REFUSE — a 0/2+-membership caller must pass `workspace=`
            // rather than have one guessed.
            if (!activeWorkspace) {
                return directory.noWorkspaceError();
            }
            const result = await runWithCredits(activeWorkspace.id, () => handler(innerArgs));
            return (0, status_footer_js_1.appendDoplStatus)(result, sessionEffective(), caller);
        };
        server.registerTool(name, { description, inputSchema: strictInput(enhancedSchema) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrapped);
    }
    // Meta-tools skip the `workspace` arg — a membership lookup is user-scoped,
    // so ALS routing adds noise without changing behavior. The workspace arg is
    // the ONLY difference between the two paths; everything else applies here too.
    //
    // ⚠ This path registers straight onto the SDK server, bypassing
    // `registerTool`'s wrapper by construction — hence the explicit gate calls
    // below. Never add a gate that only one path performs.
    //
    // ⚠ MCP CREDITS ARE NOT CHARGED HERE, by DECISION: `current_workspace` /
    // `list_workspaces` are how a lost agent finds out where it is, and are
    // user-scoped, so a 0/2+-membership session has no workspace to charge. If
    // ever metered, call the charge EXPLICITLY on both paths as `opRefusal` is —
    // do not move it into the wrapper.
    function registerMetaTool(name, description, schema, handler) {
        if (gates.isSuppressedTool(name))
            return;
        const gated = async (args) => gates.opRefusal(name, gates.requestedOp(args)) ?? handler(args);
        server.registerTool(name, { description, inputSchema: strictInput(schema) }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (0, status_footer_js_1.withDoplStatus)(gated, sessionEffective, caller));
    }
    return { registerTool, registerMetaTool };
}
