/**
 * meta-tools.ts — `list_workspaces` and `current_workspace`.
 *
 * Split out of `server.ts` (§2, the 2026-07-20 op-dispatch precedent: the
 * registrar stays thin and the handlers are siblings). These two are the only
 * tools `server.ts` itself authored — every other tool comes from a registrar
 * under `tools/` — so they are the ones that made the registrar fat.
 *
 * They are USER-scoped, not workspace-scoped: a membership lookup does not need
 * a workspace, which is why they register through `registerMetaTool` (no
 * injected `workspace=` arg) and report the session default in their footer.
 * Everything else the domain path enforces — the four gates, `strictInput` —
 * applies to them identically; see `registrar.ts`.
 */
import { type CallerIdentity } from "./tools/identity.js";
import type { RegisterTool } from "./tools/respond.js";
import type { ActiveWorkspaceState, WorkspaceDirectory } from "./workspace-directory.js";
export interface MetaToolDeps {
    directory: WorkspaceDirectory;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
    activeWorkspace: ActiveWorkspaceState | null;
    caller: CallerIdentity;
}
export declare function registerWorkspaceMetaTools(registerMetaTool: RegisterTool, { directory, activeWorkspace, caller }: MetaToolDeps): void;
