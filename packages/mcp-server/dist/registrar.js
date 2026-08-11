"use strict";
/**
 * registrar.ts — the two registration helpers every tool goes through.
 *
 * Split out of `server.ts` (§2, the layer rule, and the 2026-07-20 op-dispatch
 * precedent: the registrar is schemas + routing, the handlers are siblings).
 * `server.ts` now boots a session — resolve identity, build the gates, wire the
 * ten domain registrars — and this file owns what happens to a tool between
 * "a registrar declared it" and "the SDK publishes it".
 *
 * THE GATES ARE NOT DEFINED HERE, and that is deliberate. They live in
 * `gating.ts` and BOTH helpers below call them explicitly, because
 * `registerMetaTool` registers straight onto the SDK server: it does not go
 * through `registerTool`'s wrapper, so anything gated inside that wrapper would
 * not apply to it. Do not "simplify" this by folding the gate calls back into
 * one wrapper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToolRegistrars = createToolRegistrars;
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const respond_js_1 = require("./tools/respond.js");
const narration_js_1 = require("./tools/narration.js");
const status_footer_js_1 = require("./status-footer.js");
/**
 * Optional per-call `workspace` argument injected into every tool
 * schema by `registerTool`. Either a workspace slug or UUID. When set,
 * the tool call routes to that workspace via the transport's
 * AsyncLocalStorage override; the session default is unchanged.
 *
 * Defined as a const so its description renders verbatim in every
 * tool's MCP introspection — keeps the prompt advice consistent.
 */
const WORKSPACE_ARG_SHAPE = {
    workspace: zod_1.z
        .string()
        .optional()
        .describe("Workspace slug or UUID to target for this single call. Omit to use the session's workspace (see `current_workspace`). REQUIRED on every call when the user belongs to 2+ workspaces — there is no default then, so a no-arg call is refused with the list of choices. Use `list_workspaces` to discover slugs."),
};
/**
 * F-145 — AN UNKNOWN ARGUMENT IS REFUSED, NOT STRIPPED.
 *
 * THE DEFECT. Every tool here was registered with a RAW SHAPE, which the SDK
 * turns into a plain `z.object` and parses with `safeParseAsync`. A plain
 * `z.object` DROPS unknown keys, so `dopl_channel {op:"post", body:"hi",
 * to_agent:"quartz"}` was accepted, `to_agent` vanished before the handler saw
 * `args`, the post landed UNADDRESSED, and `opPost` narrated a success. The
 * route layer already refuses exactly this shape — `schema.ts#removedParam`
 * declares the deleted named-agent params as `z.never()` precisely because "a
 * plain deletion is SILENT: zod strips unknown keys … which is the
 * invisible-delivery failure the addressing contract existed to prevent" — and
 * the MCP layer in front of it had the hole the route had closed.
 *
 * IT WAS REACHABLE, not theoretical: `closedThreadNote` shipped a sentence
 * teaching `to_agent="<handle>"` on every post into a closed thread, so the
 * tool's own output taught the argument its own parser then swallowed.
 *
 * THE FIX IS THE SCHEMA, because copy fixes do not compose — the model can
 * invent a param from a stale blog post, a cached tool list, or its own prior.
 * `z.strictObject` sets zod's catchall to `never`, so an unrecognized key is an
 * `unrecognized_keys` issue that the SDK surfaces as `-32602 … Unrecognized key:
 * "to_agent"` — the field is NAMED, which is what lets the calling agent
 * correct itself instead of believing a delivery that never happened.
 *
 * WHY `registerTool` AND NOT `tool()`. The SDK's positional `tool()` overload
 * only accepts a RAW SHAPE: `isZodRawShapeCompat` returns false for a schema
 * INSTANCE, and the arm below it then reads the object as annotations and
 * throws "expected a Zod schema or ToolAnnotations". The config-object form
 * (`registerTool`) takes a built schema, and `normalizeObjectSchema` passes an
 * object schema through untouched. Verified against the pinned SDK: the
 * published JSON Schema is byte-identical apart from a gained
 * `additionalProperties: false` — no property, description, cap or `required`
 * entry changes — so this narrows what is ACCEPTED and nothing else.
 *
 * COST, stated: a caller that today sends a stray key gets an error where it
 * used to get a silent strip. That is the point, and it is the same trade the
 * route made. It is pinned in `server.test.ts`.
 *
 * APPLIED AT BOTH REGISTRATION HELPERS BELOW — a tool registered through the
 * meta path is no less able to be handed an invented argument.
 */
function strictInput(shape) {
    return zod_1.z.strictObject(shape);
}
/**
 * THE BILLING SEAM FOR ONE TOOL CALL — charge, then run.
 *
 * `runWithEntitlementGuard` used to be the second half of this alone. It was
 * widened rather than joined by a sibling because it is already called at
 * EXACTLY the two terminal paths of `registerTool`'s wrapper and nowhere else,
 * which makes it the only place a per-tool-call charge can be exactly-once.
 * Splitting the charge into its own helper would mean two call sites per path
 * and a future path that remembers one of them.
 *
 * ORDERING, non-negotiable: this runs AFTER `gates.opRefusal` (the §10 delete
 * refusal must stay first and unconditional — a refused delete costs zero
 * round trips) and AFTER workspace resolution (credits are per-workspace),
 * and BEFORE the handler.
 *
 * NOT in `withWorkspaceAuth` beside `logMcpToolCall`: that fires per LOOPBACK
 * request, and one tool call makes 0..N of them.
 */
function createCreditedRunner(client) {
    /**
     * Spend one credit for `workspaceId`. Returns the refusal to hand back, or
     * null to proceed.
     *
     * FAIL OPEN on anything that is not an honest "out of credits". A gate that
     * refused tool calls because a loopback request failed would brick every
     * agent in the product on a transient blip, and the operator would read it
     * as "out of credits" for a workspace that is not. The server side makes the
     * same call and states the same reason (`/api/mcp/credits/consume`).
     *
     * ⚠ ONLY `allowed === false` REFUSES — not "not truthy". A 200 whose body is
     * missing `allowed` (a proxy's JSON error page, a shape change, a partial
     * response) leaves `outcome.allowed` undefined, and `outcome.allowed ? …`
     * read that as a refusal: the fail-open promise held for a THROWN error and
     * silently inverted for a malformed answer, which is the more likely of the
     * two. A body that does not say "no" is not a no.
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
     * Charge one credit, then run the handler, converting an entitlement denial
     * (a 403 thrown by any write op through @dopl/client) into a friendly tool
     * error instead of an opaque framework throw. Every other error rethrows
     * unchanged, preserving existing behavior.
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
    // ── Tool registration helper ─────────────────────────────────────
    // Every call funnels through here so:
    //   1. An optional `workspace` arg is auto-injected on every tool
    //      (M-1). When provided, the call runs inside a transport-level
    //      AsyncLocalStorage override so client.* requests carry the
    //      right `X-Workspace-Id` header. When omitted AND the session has
    //      no default (0/2+ memberships, no pin) the call is refused (M-3)
    //      rather than guessing a workspace.
    //   2. The response gets the mandatory `_dopl_status` footer naming the
    //      effective workspace + how it was chosen (M-4) uniformly.
    // Matches the MCP SDK's own zod-inference signature so handler arg
    // types come through correctly.
    function registerTool(name, description, schema, handler) {
        if (gates.isSuppressedTool(name))
            return;
        // Spread the workspace arg into the published schema so the agent
        // sees it on every tool's introspection without having to author
        // it per-tool. Strip it out before calling the original handler so
        // existing handler signatures keep working.
        const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE };
        const wrapped = async (args) => {
            const { workspace: workspaceRef, ...rest } = args;
            const innerArgs = rest;
            // Both per-call refusals, before any work: §2b's delete block, then the
            // read-only write-scope gate. The `op` is read ONCE here — it used to be
            // pulled out twice, ten lines apart, by two identical expressions.
            const refusal = gates.opRefusal(name, gates.requestedOp(innerArgs));
            if (refusal)
                return refusal;
            // A `workspace` arg was passed on the call. Distinguish "provided
            // but blank" (fail closed) from "not provided" (use session
            // default). Audit fix F-2: an empty/whitespace string used to be
            // falsy and silently fell through to the session default — the
            // user's REAL workspace — so a computed-but-empty ref could route
            // a write to the wrong workspace with no error. Reject it.
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
                // Audit B8: resolveWorkspaceRef calls listWorkspaces, which
                // can throw on network / auth failures. Catch and surface a
                // friendly isError instead of letting the throw propagate
                // (which the MCP framework would expose as an opaque error).
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
                                // The message comes from a failed loopback — our own server, but
                                // that names where the bytes came from, not who wrote them (a
                                // 4xx can echo a rejected field). Same treatment as the channel
                                // await's failure description.
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
                                // Self-inflicted (the caller's own arg), but a raw backtick in it
                                // would still escape this span and put the tail into narration.
                                text: `Workspace not found: ${(0, narration_js_1.inlineOr)(ref, "`(unreadable ref)`")}. Call \`list_workspaces\` to see workspaces you have access to, or pass a slug or UUID from there.`,
                            },
                        ],
                    };
                }
                // Run the handler inside the AsyncLocalStorage scope so any
                // client.* call inside it transparently picks up the override
                // workspace id in its X-Workspace-Id header. Returns to the
                // session default (or no override) the moment this scope exits.
                // The footer reports the EFFECTIVE (resolved) workspace with a
                // `per-call arg` source so the agent can confirm where it landed.
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
            // No `workspace=` arg. Auto-target the session default when there is
            // one (single membership or a header pin); otherwise refuse (M-3) —
            // a 0/2+-membership caller must pass `workspace=` rather than have a
            // workspace guessed for them.
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
    // Meta-tools skip the auto-injected `workspace` arg — a membership
    // lookup is user-scoped, not workspace-scoped, so routing it through
    // ALS adds noise without changing behavior. Their footer reports the
    // session default (if any). Everything ELSE `registerTool` enforces applies
    // here too: the workspace arg is the one difference between the two paths,
    // and the gates are not a property of having one.
    //
    // KNOWN (F-146): this path registers straight onto the SDK server, so it
    // bypasses `registerTool`'s wrapper by construction. That is why the gates
    // are called explicitly on both lines below rather than living in the
    // wrapper. It is inert for today's two meta-tools — neither is hidden,
    // blocked, or carries an `op` — and it is tracked; do not make it worse by
    // adding a gate that only one path performs.
    //
    // MCP CREDITS ARE NOT CHARGED HERE — DECIDED, not inherited from F-146.
    // `current_workspace` and `list_workspaces` are how a lost agent finds out
    // WHERE it is and WHAT it may pass as `workspace=`; charging them would bill
    // an agent for asking which workspace it is in, and an exhausted workspace
    // could not even read the refusal's context. They are also USER-scoped, not
    // workspace-scoped, so on a 0/2+-membership session there is no workspace to
    // charge. If they are ever metered, the charge must be called EXPLICITLY on
    // both paths, exactly as `opRefusal` is — not moved into the wrapper.
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
