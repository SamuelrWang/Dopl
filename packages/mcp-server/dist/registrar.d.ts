/**
 * The two registration helpers every tool goes through. Gates (`gating.ts`) are called
 * explicitly on both paths, because `registerMetaTool` bypasses `registerTool`'s wrapper.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient, McpCallTally } from "@dopl/client";
import { type RegisterMetaTool, type RegisterTool, type ToolResponse } from "./tools/respond.js";
export { CONTAINER_ARG_DESCRIPTION } from "./workspace-arg.js";
import type { CallerIdentity } from "./tools/identity.js";
import { type Gates } from "./gating.js";
import type { ActiveWorkspaceState, EffectiveWorkspace, WorkspaceDirectory } from "./workspace-directory.js";
/**
 * Spend one credit for `workspaceId`; the refusal, or null to proceed. Charge AFTER `opRefusal` and
 * container resolution (the addressed container's wallet pays), BEFORE the handler, exactly once per
 * call. Fail open except on `allowed === false`: a transient blip must not read as an empty wallet.
 * Called by name from the domain wrapper, `registerMetaTool`'s opt-in and `dopl_search`'s fan-out.
 * `call` is tallied with the charge (legacy retirement counts it); fan-out legs pass none.
 */
export type ChargeCredit = (workspaceId: string, call?: McpCallTally) => Promise<ToolResponse | null>;
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
export declare function createToolRegistrars(deps: RegistrarDeps): ToolRegistrars;
