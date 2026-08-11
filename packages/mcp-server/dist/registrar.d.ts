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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./tools/respond.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { Gates } from "./gating.js";
import type { ActiveWorkspaceState, EffectiveWorkspace, WorkspaceDirectory } from "./workspace-directory.js";
/** Everything one session's registration helpers need to close over. */
export interface RegistrarDeps {
    /** The SDK server both helpers publish onto. */
    server: McpServer;
    /** The loopback client — used HERE only to charge MCP credits. */
    client: DoplClient;
    /** The four gates for this session (see `gating.ts`). */
    gates: Gates;
    /** Membership cache + `workspace=` resolution + the M-3 refusal. */
    directory: WorkspaceDirectory;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
    activeWorkspace: ActiveWorkspaceState | null;
    /** That default rendered footer-ready, or null when there is none. */
    sessionEffective: () => EffectiveWorkspace | null;
    /** The caller identity every footer renders from. */
    caller: CallerIdentity;
}
export interface ToolRegistrars {
    /** The domain-tool path: workspace arg, ALS routing, footer, gates. */
    registerTool: RegisterTool;
    /** The meta-tool path: no workspace arg, session footer, same gates. */
    registerMetaTool: RegisterTool;
}
export declare function createToolRegistrars(deps: RegistrarDeps): ToolRegistrars;
