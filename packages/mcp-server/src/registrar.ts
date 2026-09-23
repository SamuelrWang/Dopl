/**
 * The two registration helpers every tool goes through. Gates (`gating.ts`) are called
 * explicitly on both paths, because `registerMetaTool` bypasses `registerTool`'s wrapper.
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

// Re-exported so tests read the injected arg's description through the registrar that injects it.
export { CONTAINER_ARG_DESCRIPTION } from "./workspace-arg.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { Gates } from "./gating.js";
import {
  appendDoplStatus,
  requestedFormat,
  withDoplStatus,
} from "./status-footer.js";
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

// The one addressing arg injected into every domain tool: `container` (slug, id or `home`), routed
// via the transport's AsyncLocalStorage override without changing the connection's container.
const WORKSPACE_ARG_SHAPE = {
  container: z.string().optional().describe(CONTAINER_ARG_DESCRIPTION),
};
type WorkspaceArgShape = typeof WORKSPACE_ARG_SHAPE;

/**
 * Unknown keys must be REFUSED, not stripped (`z.strictObject`): a stripped key makes a handler
 * narrate a success for an arg it never saw; the refusal names the key. Requires `registerTool`,
 * not the positional `tool()`, which accepts only a raw shape. Pinned in `strict-args.test.ts`.
 */
function strictInput<S extends ZodRawShape>(shape: S, tool: string): z.ZodObject<S> {
  return z.strictObject(shape, {
    error: (issue) => renamedArgMessage(tool, issue),
  }) as unknown as z.ZodObject<S>;
}

/**
 * Renamed args (no alias): the refusal names the successor. Keyed by tool: only a tool that
 * accepts the successor may name it.
 */
const RENAMED_ARGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  dopl_agent: { template: "identity" },
  dopl_channel: { template: "identity" },
};

function renamedArgMessage(
  tool: string,
  issue: { code?: string; keys?: readonly string[] },
): string | undefined {
  if (issue.code !== "unrecognized_keys" || !issue.keys) return undefined;
  const map = RENAMED_ARGS[tool];
  if (!map) return undefined;
  const renamed = issue.keys.filter((k) => Object.prototype.hasOwnProperty.call(map, k));
  if (renamed.length === 0) return undefined;
  const keys = issue.keys.map((k) => `"${k}"`).join(", ");
  // No quotes in the hint: the SDK JSON-serializes the issue, so they would arrive escaped.
  const hints = renamed.map((k) => `renamed: send ${map[k]}, not ${k}`).join("; ");
  return `Unrecognized key${issue.keys.length === 1 ? "" : "s"}: ${keys} — ${hints}`;
}

/**
 * Spend one credit for `workspaceId`; the refusal, or null to proceed. Charge AFTER `opRefusal` and
 * container resolution (the addressed container's wallet pays), BEFORE the handler, exactly once per
 * call. Fail open except on `allowed === false`: a transient blip must not read as an empty wallet.
 * Called by name from the domain wrapper, `registerMetaTool`'s opt-in and `dopl_search`'s fan-out.
 */
export type ChargeCredit = (workspaceId: string) => Promise<ToolResponse | null>;

function createCharger(client: DoplClient): ChargeCredit {
  return async function charge(
    workspaceId: string,
  ): Promise<ToolResponse | null> {
    try {
      const outcome = await client.consumeCredits(workspaceId);
      if (outcome?.allowed === false) return creditsExhausted(outcome);
      // The consume route failed open (`consume/route.ts › failOpen`): run free, but say so.
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
      // Recorded once per process per reason, not per call.
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
  // Charge, then run. A `null` workspace is nothing to charge — only `billingTarget` produces it.
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
  server: McpServer;
  /** The loopback client — used here only to charge credits. */
  client: DoplClient;
  gates: Gates;
  /** Membership cache + `container=` resolution. */
  directory: WorkspaceDirectory;
  /** The connection's bound container (`X-Workspace-Id`); null is ordinary, never a refusal. */
  activeWorkspace: ActiveWorkspaceState | null;
  /** That binding rendered footer-ready, or null when there is none. */
  sessionEffective: () => EffectiveWorkspace | null;
  caller: CallerIdentity;
}

export interface ToolRegistrars {
  registerTool: RegisterTool;
  /** The meta path: no container arg, same gates and footer, opt-in charge. */
  registerMetaTool: RegisterMetaTool;
  /** A fan-out's additional legs only: the wrapper already charged the resolved workspace. */
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

  /** Which workspace pays when no per-call container was honoured; none listable ⇒ no charge. */
  async function billingTarget(): Promise<string | null> {
    if (activeWorkspace) return activeWorkspace.id;
    try {
      return (await directory.getWorkspaceList())[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  // Injects the `container` arg (honoured only on `WORKSPACE_ARG_OPS`; elsewhere ignored and
  // reported in `_dopl_status`). Signature mirrors the SDK's zod inference for handler arg types.
  function registerTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  ): void {
    if (gates.isSuppressedTool(name)) return;
    // Published in every schema; stripped again before the handler.
    const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE } as S &
      WorkspaceArgShape;

    type EnhancedArgs = z.infer<z.ZodObject<S & WorkspaceArgShape>>;

    const wrapped = async (args: EnhancedArgs): Promise<ToolResponse> => {
      const { container: _c, ...rest } = args as EnhancedArgs & {
        container?: string;
      };
      const innerArgs = rest as unknown as z.infer<z.ZodObject<S>>;

      // Gates before any work; `op` is read once and is also the routing key.
      const op = gates.requestedOp(innerArgs);
      const refusal = gates.opRefusal(name, op);
      if (refusal) return refusal;

      // Read here: the footer is appended after the handler's renderers, which cannot carry it.
      const format = requestedFormat(innerArgs);

      // `container-resolve.ts` owns the address grammar and refusals; this only spends the answer.
      const address = await resolveCallAddress(
        name,
        op,
        { container: _c },
        { directory, activeWorkspace },
      );
      if (address.kind === "refusal") return address.response;

      if (address.kind === "addressed") {
        // Inside the ALS scope, client.* calls carry the override in `X-Workspace-Id`.
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
          // The connection's own binding, which the per-call override did not touch.
          sessionEffective(),
        );
      }

      const result = await runWithCredits(await billingTarget(), () =>
        handler(innerArgs),
      );
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
      { description, inputSchema: strictInput(enhancedSchema, name) },
      // The scope encloses handler and footer, so `dopl_search`'s per-leg charges are reported.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: EnhancedArgs) => withUnmeteredScope(() => wrapped(args))) as any,
    );
  }

  // Meta path: no container arg (account-wide lookups). It bypasses `registerTool`'s wrapper, so its
  // gates are explicit — never add a gate only one path performs. Uncharged by default:
  // `dopl_status` is the one meta tool that pays (`opts.charged`).
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
      const billTo = await billingTarget();
      if (billTo) {
        const denied = await chargeCredit(billTo);
        if (denied) return denied;
      }
      return handler(args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const framed = withDoplStatus(gated as any, sessionEffective, caller, unmeteredNote);
    server.registerTool(
      name,
      { description, inputSchema: strictInput(schema, name) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: any) => withUnmeteredScope(() => framed(args))) as any,
    );
  }

  return { registerTool, registerMetaTool, chargeCredit };
}
