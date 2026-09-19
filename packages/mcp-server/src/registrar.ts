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
import type { DoplClient } from "@dopl/client";

import {
  creditsExhausted,
  entitlementDenied,
  type MetaToolOptions,
  type RegisterMetaTool,
  type RegisterTool,
  type ToolResponse,
} from "./tools/respond.js";
import { CONTAINER_ARG_DESCRIPTION } from "./workspace-arg.js";
import { resolveCallAddress } from "./container-resolve.js";

// ⚠ Re-exported: `tool-budget.test.ts` and `server.test.ts` read the contract
// through the registrar that injects it, which is where an agent meets it.
export {
  CONTAINER_ARG_DESCRIPTION,
  WORKSPACE_ALIAS_DESCRIPTION,
  WORKSPACE_ARG_DESCRIPTION,
  WORKSPACE_ARG_OPS,
  UNADDRESSED_WRITE_REFUSALS,
  acceptsWorkspaceArg,
  refusesUnaddressedWrite,
  workspaceArgTargets,
} from "./workspace-arg.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { Gates } from "./gating.js";
import {
  appendDoplStatus,
  requestedFormat,
  withDoplStatus,
} from "./status-footer.js";
// 🔒 A CALL THAT WAS NOT CHARGED SAYS SO — once in the log, and on the call's own
// `_dopl_status` footer. The fail-open decision below is unchanged; this only makes
// its consequence legible (`credits-unmetered.ts`).
import {
  joinNotes,
  recordUnmetered,
  unmeteredNote,
  withUnmeteredScope,
} from "./credits-unmetered.js";
import type {
  ActiveWorkspaceState,
  EffectiveWorkspace,
  WorkspaceDirectory,
} from "./workspace-directory.js";

/**
 * 🔒 **THE TWO ADDRESSING ARGS INJECTED INTO EVERY DOMAIN TOOL'S SCHEMA** —
 * `container` (R-32, Samuel 2026-09-17) and `workspace`, its deprecated alias.
 * Slug, id or the reserved `home`; routes via the transport's
 * AsyncLocalStorage override, leaving the connection's container unchanged.
 * Const so each description renders verbatim — and identically — in every
 * tool's MCP introspection.
 *
 * ⚠ BOTH ARE INJECTED EVEN WHERE THEY ARE IGNORED, and that is the point of the
 * one-release window: `strictInput` refuses an unknown key, so dropping either
 * from the schema would turn "ignored" into `-32602`, which is the one thing a
 * deprecation window rules out. The alias is the reason the rename is not a
 * wire break; `container-resolve.ts` maps it to the same resolver and says so
 * on the result.
 */
const WORKSPACE_ARG_SHAPE = {
  container: z.string().optional().describe(CONTAINER_ARG_DESCRIPTION),
  // ⚠ NO `.describe()` — see `workspace-arg.ts › WORKSPACE_ALIAS_DESCRIPTION`.
  workspace: z.string().optional(),
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
 * workspace resolution (the ADDRESSED CONTAINER decides which wallet pays),
 * BEFORE the handler.
 *
 * ⚠ NOT in `withWorkspaceAuth` beside `logMcpToolCall` — that fires per
 * LOOPBACK request, and one tool call makes 0..N of them.
 */
/**
 * Spend one credit for `workspaceId`. Returns the refusal, or null to proceed.
 *
 * ⚠ FAIL OPEN on anything that is not an honest "out of credits" — refusing on a
 * transient loopback blip bricks every agent and reads to the operator as an
 * exhausted wallet that is not exhausted.
 *
 * ⚠ ONLY `allowed === false` REFUSES, not "not truthy". A 200 missing `allowed`
 * (proxy error page, shape change, partial response) leaves it undefined, and a
 * truthiness test reads that as a refusal — fail-open for a THROWN error,
 * silently inverted for a malformed answer, which is the more likely of the two.
 * A body that does not say "no" is not a no.
 *
 * ⚠ **THE REFUSAL NAMES THE WALLET THAT STOPPED, SO THE WHOLE OUTCOME GOES TO
 * `creditsExhausted`, NOT ITS URL** (Samuel, 2026-09-07: allocations are
 * per-person and never pooled). A `seat` refusal is the caller's own allocation
 * inside that workspace; a `personal` one is their home space. ⚠ **EITHER ONE
 * CARRIES THE UPGRADE LINK WHEN THE SERVER SENT ONE** — a personal PRO tier
 * exists since 2026-09-08, so "nothing to buy" is `upgradeUrl === ""` and is
 * never inferred from the wallet. A server that sends no `wallet` gets the
 * generic sentence — this layer does not infer one.
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
      // ⚠ THE WHOLE OUTCOME, not just the URL: which WALLET stopped decides the
      // sentence, and the counters + reset date are on the same answer.
      if (outcome?.allowed === false) return creditsExhausted(outcome);
      // 🔒 **`degraded` IS AN ANSWER, NOT AN ERROR, AND IT USED TO VANISH HERE.**
      // The route fails open on any throw (`route.ts › failOpen`) and answers
      // `{ allowed: true, degraded: true }` — so `allowed !== false` let the call
      // run FREE with nothing said. Ship the web ahead of the migration and a
      // `PGRST202` puts the WHOLE estate on that branch. The charge still fails
      // open; it just stops being silent.
      if (outcome?.degraded === true) {
        recordUnmetered(
          "degraded",
          `The consume endpoint answered degraded for workspace ${workspaceId}. ` +
            `Check that the credit RPCs are applied — a signature the schema cache ` +
            `cannot find answers PGRST202, which is the deploy-before-migrate shape.`,
        );
      }
      return null;
    } catch (err) {
      // ⚠ ONCE PER PROCESS PER REASON, not once per CALL. Under a real outage the
      // old per-call line was one error per tool call per agent, which buries the
      // line that says what broke — and a deploy-ordering bug is a STATE, not an
      // event.
      recordUnmetered(
        "consume_failed",
        `Consume call failed for workspace ${workspaceId}; allowing the tool call: ${
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
      const { container: _c, workspace: _w, ...rest } = args as EnhancedArgs & {
        container?: string;
        workspace?: string;
      };
      const innerArgs = rest as unknown as z.infer<z.ZodObject<S>>;

      // ⚠ Both per-call refusals before any work: delete block, then read-only
      // write-scope gate. `op` read ONCE, and it is also the routing key below.
      const op = gates.requestedOp(innerArgs);
      const refusal = gates.opRefusal(name, op);
      if (refusal) return refusal;

      // ⚠ READ ONCE, BESIDE `op`, AND FOR THE SAME REASON (S37/S54,
      // 2026-09-18): the knob is applied inside the renderers and this footer is
      // appended after them, so the handler's own answer cannot carry it here.
      const format = requestedFormat(innerArgs);

      // 🔒 ONE DECISION, ONE PLACE — `container-resolve.ts` owns the grammar,
      // the alias, the blank/not-found refusals and R-32's unaddressed-mint
      // refusal. This wrapper only spends the answer.
      const address = await resolveCallAddress(
        name,
        op,
        { container: _c, workspace: _w },
        { directory, activeWorkspace },
      );
      if (address.kind === "refusal") return address.response;

      if (address.kind === "addressed") {
        // Handler runs inside the AsyncLocalStorage scope so client.* calls
        // pick up the override in X-Workspace-Id; reverts on scope exit. Footer
        // reports the EFFECTIVE container with a `per-call arg` source.
        const { effective } = address;
        const result = await runWithCredits(effective.id, () =>
          workspaceContext.run(effective.id, () => handler(innerArgs)),
        );
        return appendDoplStatus(
          result,
          effective,
          caller,
          joinNotes(address.note, unmeteredNote()),
          format,
          // ⚠ S29b: `effective` is the PER-CALL override and this is the
          // connection's own binding, which the override did not touch. The
          // footer says so rather than letting one flipping line mean both.
          sessionEffective(),
        );
      }

      const result = await runWithCredits(await billingTarget(), () =>
        handler(innerArgs),
      );
      // ⚠ BOTH NOTES, NOT ONE: a dropped address and an unmetered call are
      // independent facts about the same call, and dropping either is a silence.
      return appendDoplStatus(
        result,
        sessionEffective(),
        caller,
        joinNotes(address.note, unmeteredNote()),
        format,
      );
    };

    server.registerTool(
      name,
      { description, inputSchema: strictInput(enhancedSchema) },
      // ⚠ THE SCOPE ENCLOSES THE HANDLER **AND** THE FOOTER, which is what makes
      // `dopl_search`'s PER-LEG charge reportable: it fires deep inside a handler
      // and its return value never reaches `appendDoplStatus`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: EnhancedArgs) => withUnmeteredScope(() => wrapped(args))) as any,
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
    // ⚠ SAME TWO PIECES AS THE DOMAIN PATH — the opt-in charge above is a
    // `chargeCredit` call like any other, so it reports through the same scope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const framed = withDoplStatus(gated as any, sessionEffective, caller, unmeteredNote);
    server.registerTool(
      name,
      { description, inputSchema: strictInput(schema) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: any) => withUnmeteredScope(() => framed(args))) as any,
    );
  }

  return { registerTool, registerMetaTool, chargeCredit };
}
