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
