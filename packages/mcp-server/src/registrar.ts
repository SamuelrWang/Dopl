/**
 * The two registration helpers every legacy tool goes through, and `registerGranular`, which serves
 * a granular tool by running its bound legacy tool's pipeline. Gates (`gating.ts`) are called
 * explicitly on both legacy paths, because `registerMetaTool` bypasses `registerTool`'s wrapper.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { workspaceContext } from "@dopl/client";
import type { DoplClient, McpCallTally } from "@dopl/client";

import {
  creditsExhausted,
  ok,
  entitlementDenied,
  type MetaToolOptions,
  type RegisterMetaTool,
  type RegisterTool,
  type ToolResponse,
} from "./tools/respond.js";
import { CONTAINER_ARG_DESCRIPTION } from "./workspace-arg.js";
import { resolveCallAddress } from "./container-resolve.js";
import { LEGACY_ONTOLOGY_ARGS } from "./legacy-aliases.js";
import { withToolSet } from "./call-ref.js";
import { granularDescription, granularShape, legacyCall, pulledResource, type LegacyTool } from "./granular.js";
import { resourceText } from "./resources.js";
import {
  ALWAYS_LOAD_META,
  annotationsFor,
  selectorOf,
  servesName,
  type GranularTool,
  type ToolSet,
} from "./tool-manifest.js";

// Re-exported so tests read the injected arg's description through the registrar that injects it.
export { CONTAINER_ARG_DESCRIPTION } from "./workspace-arg.js";
import type { CallerIdentity } from "./tools/identity.js";
import { isWriteOp, type Gates } from "./gating.js";
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
 * The registration config every path publishes. `title` is the tool's own name because Codex copies a
 * tool's `title` into its approval request as `_meta.tool_title`, the only per-tool identity that
 * request carries — the desktop names the call by it (`dopl-desktop-app/main/runtime/codex/
 * server-requests.js › doplElicitation`). Pinned in `tool-title.test.ts` and `granular.test.ts`.
 */
function toolConfig(name: string, description: string, inputSchema: z.ZodObject) {
  return { title: name, description, inputSchema };
}

/**
 * Renamed args (no alias): the refusal names the successor. Keyed by tool: only a tool that
 * accepts the successor may name it.
 */
const RENAMED_ARGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  dopl_agent: { template: "identity" },
  dopl_channel: { template: "identity" },
  dopl_ontology: LEGACY_ONTOLOGY_ARGS,
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
 * `call` is tallied with the charge (legacy retirement counts it); fan-out legs pass none.
 */
export type ChargeCredit = (
  workspaceId: string,
  call?: McpCallTally,
) => Promise<ToolResponse | null>;

function tally(tool: string, op: string | undefined): McpCallTally {
  return { tool, op: op ?? "", write: op !== undefined && isWriteOp(tool, op) };
}

function createCharger(client: DoplClient): ChargeCredit {
  return async function charge(
    workspaceId: string,
    call?: McpCallTally,
  ): Promise<ToolResponse | null> {
    try {
      const outcome = await client.consumeCredits(workspaceId, call);
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
    call: McpCallTally,
    run: () => Promise<ToolResponse>,
  ): Promise<ToolResponse> {
    const refusal = workspaceId === null ? null : await charge(workspaceId, call);
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
  /** Which set owns a name both sets use. Default `legacy`. */
  toolSet?: ToolSet;
}

export interface ToolRegistrars {
  registerTool: RegisterTool;
  /** The meta path: no container arg, same gates and footer, opt-in charge. */
  registerMetaTool: RegisterMetaTool;
  /** A fan-out's additional legs only: the wrapper already charged the resolved workspace. */
  chargeCredit: ChargeCredit;
  /** After every legacy registration: a granular tool runs a registered legacy tool. */
  registerGranular: (tool: GranularTool) => void;
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
    toolSet = "legacy",
  } = deps;
  const chargeCredit = createCharger(client);
  // Every registered legacy tool, including one whose name the active granular set took. `run` is the
  // bare pipeline: each registration opens its own tool-set scope (`call-ref.ts › withToolSet`).
  const legacy = new Map<string, LegacyTool>();
  function publishLegacy(name: string, description: string, shape: ZodRawShape, run: LegacyTool["run"]): void {
    const input = strictInput(shape, name);
    legacy.set(name, { shape, input, run });
    if (!servesName(toolSet, "legacy", name)) return;
    server.registerTool(name, toolConfig(name, description, input), ((args: Record<string, unknown>) =>
      withToolSet(toolSet, () => run(args))) as never);
  }
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
        const result = await runWithCredits(effective.id, tally(name, op), () =>
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

      const result = await runWithCredits(await billingTarget(), tally(name, op), () =>
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

    // The scope encloses handler and footer, so `dopl_search`'s per-leg charges are reported.
    publishLegacy(name, description, enhancedSchema, (args) =>
      withUnmeteredScope(() => wrapped(args as EnhancedArgs)),
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
      const op = gates.requestedOp(args);
      const refusal = gates.opRefusal(name, op);
      if (refusal) return refusal;
      if (!opts.charged) return handler(args);
      const billTo = await billingTarget();
      if (billTo) {
        const denied = await chargeCredit(billTo, tally(name, op));
        if (denied) return denied;
      }
      return handler(args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const framed = withDoplStatus(gated as any, sessionEffective, caller, unmeteredNote);
    publishLegacy(name, description, schema, (args) => withUnmeteredScope(() => framed(args)));
  }

  // No gate of its own: the bound legacy pipeline runs every gate, charge and tally on legacy keys,
  // and `Gates.requestedOp` reads the op/action the binding wrote into the call.
  function registerGranular(t: GranularTool): void {
    if (gates.isSuppressedTool(t.name) || !servesName(toolSet, "granular", t.name)) return;
    const shape = granularShape(t, legacy);
    if (!shape) return;
    server.registerTool(
      t.name,
      {
        ...toolConfig(t.name, granularDescription(t), strictInput(shape, t.name)),
        annotations: annotationsFor(t),
        ...(t.alwaysLoad && { _meta: ALWAYS_LOAD_META }),
      },
      (async (args: Record<string, unknown>) => {
        const invalid = (message: string) =>
          new McpError(ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${t.name}: ${message}`);
        const pulled = pulledResource(t, args);
        if (pulled) {
          const stray = Object.keys(args).filter((k) => k !== selectorOf(t));
          if (stray.length > 0) throw invalid(`${stray.map((k) => `"${k}"`).join(", ")} not taken by this topic`);
          return ok(withToolSet(toolSet, () => resourceText(pulled)));
        }
        const call = legacyCall(t, args);
        const target = legacy.get(call.tool)!;
        // A multi-job row's schema is the union of its jobs; the chosen job's own schema has the last
        // word, so a param that job does not take is refused by name, never passed through.
        const parsed = target.input.safeParse(call.args);
        if (!parsed.success) throw invalid(parsed.error.message);
        // Carried args were validated by this tool's own schema; the legacy one does not know them.
        return withToolSet(toolSet, () => target.run({ ...(parsed.data as Record<string, unknown>), ...call.carried }), t.name);
      }) as never,
    );
  }

  return { registerTool, registerMetaTool, chargeCredit, registerGranular };
}
