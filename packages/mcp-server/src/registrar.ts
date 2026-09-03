/**
 * registrar.ts — the two registration helpers every tool goes through. Owns
 * what happens to a tool between "a registrar declared it" and "the SDK
 * publishes it"; `server.ts` boots the session.
 *
 * ⚠ Gates live in `gating.ts` and BOTH helpers call them EXPLICITLY, because
 * `registerMetaTool` registers straight onto the SDK server and never goes
 * through `registerTool`'s wrapper. Do not fold the gate calls into one wrapper.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { workspaceContext } from "@dopl/client";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import {
  creditsExhausted,
  entitlementDenied,
  type MetaToolOptions,
  type RegisterMetaTool,
  type RegisterTool,
  type ToolResponse,
} from "./tools/respond.js";
import { inlineOr } from "./tools/narration.js";
import {
  acceptsWorkspaceArg,
  ignoredWorkspaceNote,
  WORKSPACE_ARG_DESCRIPTION,
} from "./workspace-arg.js";

// ⚠ Re-exported: `tool-budget.test.ts` and `server.test.ts` read the contract
// through the registrar that injects it, which is where an agent meets it.
export {
  WORKSPACE_ARG_DESCRIPTION,
  WORKSPACE_ARG_OPS,
  acceptsWorkspaceArg,
  workspaceArgTargets,
} from "./workspace-arg.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { Gates } from "./gating.js";
import { appendDoplStatus, withDoplStatus } from "./status-footer.js";
import type {
  ActiveWorkspaceState,
  EffectiveWorkspace,
  WorkspaceDirectory,
} from "./workspace-directory.js";

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
  workspace: z.string().optional().describe(WORKSPACE_ARG_DESCRIPTION),
};
type WorkspaceArgShape = typeof WORKSPACE_ARG_SHAPE;

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
function strictInput<S extends ZodRawShape>(shape: S): z.ZodObject<S> {
  return z.strictObject(shape) as unknown as z.ZodObject<S>;
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
/**
 * Spend one credit for `workspaceId`. Returns the refusal, or null to proceed.
 *
 * ⚠ FAIL OPEN on anything that is not an honest "out of credits" — refusing on a
 * transient loopback blip bricks every agent and reads to the operator as "out
 * of credits" for a workspace that is not.
 *
 * ⚠ ONLY `allowed === false` REFUSES, not "not truthy". A 200 missing `allowed`
 * (proxy error page, shape change, partial response) leaves it undefined, and a
 * truthiness test reads that as a refusal — fail-open for a THROWN error,
 * silently inverted for a malformed answer, which is the more likely of the two.
 * A body that does not say "no" is not a no.
 *
 * ⚠ **ONE CHARGE FUNCTION, THREE EXPLICIT CALL SITES** (2026-08-28). It was
 * private to `createCreditedRunner` while the domain wrapper was the only meter;
 * two more seams now call it BY NAME — `registerMetaTool`'s opt-in charge
 * (`dopl_status`, ruling Q2) and `dopl_search`'s PER-LEG charge (ruling Q3). That
 * is the shape `opRefusal` already has and the shape this module's header
 * demands: explicit at every path, never folded into a wrapper only one of them
 * passes through.
 */
export type ChargeCredit = (workspaceId: string) => Promise<ToolResponse | null>;

function createCharger(client: DoplClient): ChargeCredit {
  return async function charge(
    workspaceId: string,
  ): Promise<ToolResponse | null> {
    try {
      const outcome = await client.consumeCredits(workspaceId);
      return outcome?.allowed === false
        ? creditsExhausted(outcome.upgradeUrl)
        : null;
    } catch (err) {
      console.error(
        `[credits] consume call failed for workspace ${workspaceId}; allowing the tool call: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };
}

function createCreditedRunner(charge: ChargeCredit) {
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
  return async function runWithCredits(
    workspaceId: string | null,
    run: () => Promise<ToolResponse>,
  ): Promise<ToolResponse> {
    const refusal = workspaceId === null ? null : await charge(workspaceId);
    if (refusal) return refusal;
    try {
      return await run();
    } catch (e) {
      const denied = entitlementDenied(e);
      if (denied) return denied;
      throw e;
    }
  };
}

/** Everything one session's registration helpers need to close over. */
export interface RegistrarDeps {
  /** The SDK server both helpers publish onto. */
  server: McpServer;
  /** The loopback client — used HERE only to charge MCP credits. */
  client: DoplClient;
  /** The four gates for this session (see `gating.ts`). */
  gates: Gates;
  /** Membership cache + `workspace=` resolution. */
  directory: WorkspaceDirectory;
  /**
   * The container this CONNECTION is bound to (`X-Workspace-Id`), or null.
   * ⚠ **NULL IS ORDINARY SINCE B13 AND IS NEVER A REFUSAL** — an unbound
   * connection simply names no container, and the server resolves the caller's
   * own when nothing is passed.
   */
  activeWorkspace: ActiveWorkspaceState | null;
  /** That binding rendered footer-ready, or null when there is none. */
  sessionEffective: () => EffectiveWorkspace | null;
  /** The caller identity every footer renders from. */
  caller: CallerIdentity;
}

export interface ToolRegistrars {
  /** The domain-tool path: workspace arg, ALS routing, footer, gates. */
  registerTool: RegisterTool;
  /**
   * The meta-tool path: no workspace arg, session footer, same gates — and an
   * OPT-IN charge (`MetaToolOptions.charged`), which only `dopl_status` takes.
   */
  registerMetaTool: RegisterMetaTool;
  /**
   * ⚠ THE CHARGE, EXPOSED BY NAME so a handler that does N workspaces' work on
   * one call can pay for N (`dopl_search(scope="everywhere")`, ruling Q3). The
   * wrapper has already charged for the RESOLVED workspace by the time a handler
   * runs, so a fan-out charges the ADDITIONAL legs and the totals agree with the
   * work. ⚠ Do not call this from a single-scope handler — that double-charges.
   */
  chargeCredit: ChargeCredit;
}

export function createToolRegistrars(deps: RegistrarDeps): ToolRegistrars {
  const {
    server,
    client,
    gates,
    directory,
    activeWorkspace,
    sessionEffective,
    caller,
  } = deps;
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
  async function billingTarget(): Promise<string | null> {
    if (activeWorkspace) return activeWorkspace.id;
    try {
      return (await directory.getWorkspaceList())[0]?.id ?? null;
    } catch {
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
  function registerTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  ): void {
    if (gates.isSuppressedTool(name)) return;
    // Spread into the published schema so every tool's introspection shows it;
    // stripped again before the handler, whose signature does not know it.
    const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE } as S &
      WorkspaceArgShape;

    type EnhancedArgs = z.infer<z.ZodObject<S & WorkspaceArgShape>>;

    const wrapped = async (args: EnhancedArgs): Promise<ToolResponse> => {
      const { workspace: workspaceRef, ...rest } = args as EnhancedArgs & {
        workspace?: string;
      };
      const innerArgs = rest as unknown as z.infer<z.ZodObject<S>>;

      // ⚠ Both per-call refusals before any work: delete block, then read-only
      // write-scope gate. `op` read ONCE, and it is also the routing key below.
      const op = gates.requestedOp(innerArgs);
      const refusal = gates.opRefusal(name, op);
      if (refusal) return refusal;

      const supplied = typeof workspaceRef === "string" ? workspaceRef.trim() : "";
      if (workspaceRef !== undefined && acceptsWorkspaceArg(name, op)) {
        // ⚠ "provided but blank" (fail closed) must stay distinct from "not
        // provided". A falsy-string test lets a computed-but-empty ref route a
        // write to a container the caller never named.
        if (!supplied) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `The \`workspace\` argument was blank. Pass a container id or slug from \`dopl_workspaces\`, or omit \`workspace=\` entirely to use this connection's container.`,
              },
            ],
          };
        }
        // ⚠ `resolveWorkspaceRef` calls listWorkspaces and can throw on
        // network/auth failure — an uncaught throw surfaces as an opaque MCP
        // framework error.
        let resolved: WorkspaceListItem | null;
        try {
          resolved = await directory.resolveWorkspaceRef(supplied);
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                // ⚠ Loopback origin names where the bytes came from, not who
                // wrote them — a 4xx can echo a rejected field.
                text:
                  `Couldn't validate the \`workspace\` argument (${inlineOr(
                    err instanceof Error ? err.message : String(err),
                    "\`no detail reported\`",
                  )}). Try again, or call without \`workspace=\`.`,
              },
            ],
          };
        }
        if (!resolved) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                // ⚠ Caller's own arg, but a raw backtick still escapes this
                // span and puts the tail into narration.
                text: `Workspace not found: ${inlineOr(supplied, "\`(unreadable ref)\`")}. Call \`dopl_workspaces\` for every container you can reach — workspaces and home channels alike.`,
              },
            ],
          };
        }
        // Handler runs inside the AsyncLocalStorage scope so client.* calls
        // pick up the override in X-Workspace-Id; reverts on scope exit. Footer
        // reports the EFFECTIVE workspace with a `per-call arg` source.
        const effective: EffectiveWorkspace = {
          id: resolved.id,
          slug: resolved.slug,
          name: resolved.name,
          role: resolved.role,
          source: "per-call arg",
        };
        const result = await runWithCredits(resolved.id, () =>
          workspaceContext.run(resolved.id, () => handler(innerArgs)),
        );
        return appendDoplStatus(result, effective, caller);
      }

      // ⚠ NO HONOURED `workspace=`. The call runs in this connection's
      // container, and when the connection names none the SERVER resolves the
      // caller's own — there is no guess to make here and nothing to refuse.
      const ignored =
        workspaceRef === undefined ? null : ignoredWorkspaceNote(op, supplied);
      const result = await runWithCredits(await billingTarget(), () =>
        handler(innerArgs),
      );
      return appendDoplStatus(result, sessionEffective(), caller, ignored);
    };

    server.registerTool(
      name,
      { description, inputSchema: strictInput(enhancedSchema) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrapped as any,
    );
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
  function registerMetaTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
    opts: MetaToolOptions = {},
  ): void {
    if (gates.isSuppressedTool(name)) return;
    const gated = async (
      args: z.infer<z.ZodObject<S>>,
    ): Promise<ToolResponse> => {
      const refusal = gates.opRefusal(name, gates.requestedOp(args));
      if (refusal) return refusal;
      if (!opts.charged) return handler(args);
      // ⚠ WHICH WORKSPACE PAYS, for a tool that targets none — `billingTarget`
      // above, the SAME rule the domain path uses since B13, and its docblock
      // owns both halves (the container-lock reroute and the fail-open hole).
      const billTo = await billingTarget();
      if (billTo) {
        const denied = await chargeCredit(billTo);
        if (denied) return denied;
      }
      return handler(args);
    };
    server.registerTool(
      name,
      { description, inputSchema: strictInput(schema) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withDoplStatus(gated as any, sessionEffective, caller) as any,
    );
  }

  return { registerTool, registerMetaTool, chargeCredit };
}
