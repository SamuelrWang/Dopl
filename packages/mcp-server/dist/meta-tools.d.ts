/**
 * meta-tools.ts — `list_workspaces` and `current_workspace`.
 *
 * ⚠ USER-scoped, not workspace-scoped: a membership lookup needs no workspace,
 * which is why they register through `registerMetaTool` (no injected
 * `workspace=` arg) and report the session default in their footer. Everything
 * else the domain path enforces — the four gates, `strictInput` — applies
 * identically; see `registrar.ts`.
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
